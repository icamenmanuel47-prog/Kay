/**
 * Minimal Electron shim for unit-testing the main-process modules.
 *
 * The main modules `require('electron')` at load time, which makes them
 * un-loadable under plain `node --test`. Rather than reimplementing the logic
 * under test (which is what the old suites did - they asserted against local
 * copies of functions and so could never catch a regression), this patches the
 * module loader so the *real* code runs against a stubbed Electron API and a
 * throwaway userData directory.
 *
 * Usage:
 *   const shim = installElectronShim();
 *   const conversations = require('../../src/main/conversations.js');
 *   ...
 *   shim.cleanup();
 */

import Module, { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ESM files have no `require`, but the cache we need to purge is require's.
const nodeRequire = createRequire(import.meta.url);

/**
 * @param {object} [overrides] fields to replace on the default Electron stub
 * @returns {{electron: object, ipcHandlers: Map<string, Function>, userData: string, cleanup: () => void}}
 */
export function installElectronShim(overrides = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kay-test-'));

  /** channel -> handler, so tests can drive ipcMain.handle-registered channels */
  const ipcHandlers = new Map();

  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

  /**
   * Stand-in for electron-store.
   *
   * electron-store is constructed at module load with `watch: true`, which
   * installs an fs watcher that nothing in the tests ever stops - removing the
   * temp directory at teardown then trips "EPERM: operation not permitted,
   * watch". Stubbing the *dependency* (not the logic under test) keeps
   * settings.js running for real while staying deterministic, and still
   * persists to disk so tests can assert what was actually written.
   */
  class StoreShim {
    constructor(options = {}) {
      this.path = path.join(userData, `${options.name || 'config'}.json`);
      this.defaults = options.defaults || {};
      this.data = { ...this.defaults };
      if (fs.existsSync(this.path)) {
        try {
          this.data = { ...this.defaults, ...JSON.parse(fs.readFileSync(this.path, 'utf8')) };
        } catch { /* corrupt file: start from defaults, like the real store */ }
      }
    }

    get store() { return { ...this.data }; }

    get(key, fallback) {
      const value = this.data[key];
      return value === undefined ? fallback : value;
    }

    set(key, value) {
      this.data[key] = value;
      this.persist();
    }

    delete(key) {
      delete this.data[key];
      this.persist();
    }

    clear() {
      this.data = { ...this.defaults };
      this.persist();
    }

    save() { this.persist(); }

    persist() {
      fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    }
  }

  const electron = {
    app: {
      getPath: () => userData,
      getVersion: () => '0.0.0-test',
      getName: () => 'Kay',
      setLoginItemSettings: () => {},
      getLoginItemSettings: () => ({ openAtLogin: false }),
      setAppLogsPath: () => {},
      setAsDefaultProtocolClient: () => {},
      requestSingleInstanceLock: () => true,
      whenReady: async () => {},
      on: () => {},
      quit: () => {},
      exit: () => {},
    },
    ipcMain: {
      handle: (channel, fn) => ipcHandlers.set(channel, fn),
      on: (channel, fn) => ipcHandlers.set(channel, fn),
      removeHandler: (channel) => ipcHandlers.delete(channel),
    },
    BrowserWindow: class BrowserWindow {},
    dialog: {
      showSaveDialog: async () => ({ canceled: true }),
      showOpenDialog: async () => ({ canceled: true }),
      showMessageBox: async () => ({ response: 0 }),
      showErrorBox: () => {},
    },
    shell: {
      openPath: async () => '',
      openExternal: async () => {},
      showItemInFolder: () => {},
    },
    Notification: class Notification {
      static isSupported() { return false; }
      show() {}
    },
    // The renderer is destroyed in tests; sendToRenderer must be a no-op.
    BrowserWindowStub: null,
    screen: {
      getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 }, workArea }),
      getDisplayMatching: () => ({ workArea }),
    },
    globalShortcut: {
      register: () => true,
      unregister: () => {},
      unregisterAll: () => {},
      isRegistered: () => false,
    },
    safeStorage: {
      // DPAPI is unavailable off-Windows and in tests; fall back to a plain
      // reversible transform so the encrypt/decrypt code paths still run.
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (buffer) => Buffer.from(buffer).toString('utf8'),
    },
    Tray: class Tray {
      constructor() {}
      setContextMenu() {}
      setToolTip() {}
      destroy() {}
    },
    Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }) },
    ...overrides,
  };

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electron;
    if (request === 'electron-store') return StoreShim;
    return originalLoad.apply(this, arguments);
  };

  /**
   * Drop every main-process module from the require cache so the next test
   * gets a clean one (fresh caches, fresh temp directory).
   */
  function resetMainModules() {
    for (const key of Object.keys(nodeRequire.cache)) {
      if (key.includes(`${path.sep}src${path.sep}main${path.sep}`)) {
        delete nodeRequire.cache[key];
      }
    }
    ipcHandlers.clear();
  }

  return {
    electron,
    ipcHandlers,
    userData,
    resetMainModules,
    cleanup() {
      Module._load = originalLoad;
      resetMainModules();
      fs.rmSync(userData, { recursive: true, force: true });
    },
  };
}

/**
 * Convenience: createRequire bound to the caller's location, so tests can
 * require() the CommonJS main modules from an ESM test file.
 */
export { createRequire };
