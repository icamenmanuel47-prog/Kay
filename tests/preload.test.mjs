import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file so the suite runs on any machine, including CI.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD_PATH = path.join(ROOT, 'src', 'preload', 'index.js');
const MAIN_DIR = path.join(ROOT, 'src', 'main');
const RENDERER_SCRIPTS_DIR = path.join(ROOT, 'src', 'renderer', 'scripts');

const jsFilesIn = (dir) =>
  fs.readdirSync(dir).filter((name) => name.endsWith('.js'));

test('Preload: exposes complete kayAPI interface required by renderer', () => {
  const preloadCode = fs.readFileSync(PRELOAD_PATH, 'utf-8');

  // Check window methods
  const windowMethods = ['minimize', 'close', 'hide', 'toggleAlwaysOnTop', 'setAlwaysOnTop', 'setOpacity', 'getBounds', 'setBounds', 'isAlwaysOnTop'];
  for (const m of windowMethods) {
    assert.ok(preloadCode.includes(`${m}:`), `kayAPI.window missing method: ${m}`);
  }

  // Check settings methods
  const settingsMethods = ['get', 'set', 'setApiKey', 'deleteApiKey', 'getHotkey', 'setHotkey', 'encryptionAvailable', 'isEncryptionAvailable'];
  for (const m of settingsMethods) {
    assert.ok(preloadCode.includes(`${m}:`), `kayAPI.settings missing method: ${m}`);
  }

  // The renderer must never be able to read the key back out.
  assert.ok(!preloadCode.includes('getApiKey:'), 'kayAPI.settings must not expose getApiKey');
  assert.ok(!preloadCode.includes("'settings:get-api-key'"), 'preload must not call settings:get-api-key');

  // Check conversations methods
  const convMethods = ['list', 'get', 'create', 'update', 'delete', 'export', 'search'];
  for (const m of convMethods) {
    assert.ok(preloadCode.includes(`${m}:`), `kayAPI.conversations missing method: ${m}`);
  }

  // Check chat methods
  const chatMethods = ['streamMessage', 'cancelStream', 'getModels', 'setFavoriteModel'];
  for (const m of chatMethods) {
    assert.ok(preloadCode.includes(`${m}:`), `kayAPI.chat missing method: ${m}`);
  }

  // Non-streaming send was dead code: the renderer only ever streams.
  assert.ok(!preloadCode.includes('sendMessage:'), 'kayAPI.chat must not expose sendMessage');
  assert.ok(!preloadCode.includes("'chat:send'"), 'preload must not call chat:send');

  // Check app methods
  const appMethods = ['toggleOnOff', 'getState', 'checkUpdates', 'quit', 'openExternal', 'openDataFolder', 'resetAllData', 'setLaunchAtStartup', 'getLaunchAtStartup'];
  for (const m of appMethods) {
    assert.ok(preloadCode.includes(`${m}:`), `kayAPI.app missing method: ${m}`);
  }

  // Check event listeners
  const listenerMethods = [
    'onStreamChunk', 'onStreamEnd', 'onStreamError', 'onModelList',
    'onSettingsChanged', 'onHotkeyChanged', 'onConversationListChanged',
    'onOpenSettings', 'onAppStateChanged', 'onWindowShown', 'onWindowHidden', 'onUpdaterEvent',
    'removeAllListeners',
  ];
  for (const m of listenerMethods) {
    assert.ok(preloadCode.includes(`${m}:`), `kayAPI missing event listener: ${m}`);
  }
});

test('Preload: every invoked channel has a main-process handler', () => {
  const preloadCode = fs.readFileSync(PRELOAD_PATH, 'utf8');

  const invoked = new Set(
    [...preloadCode.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]),
  );
  assert.ok(invoked.size > 20, 'should have found the preload IPC surface');

  const handled = new Set();
  for (const file of jsFilesIn(MAIN_DIR)) {
    const source = fs.readFileSync(path.join(MAIN_DIR, file), 'utf8');
    for (const match of source.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)) {
      handled.add(match[1]);
    }
  }

  const unhandled = [...invoked].filter((channel) => !handled.has(channel)).sort();
  assert.deepEqual(unhandled, [], 'preload invokes channels nothing in main handles');
});

test('Preload: every kayAPI method the renderer calls is really exposed', () => {
  const preloadCode = fs.readFileSync(PRELOAD_PATH, 'utf8');

  // Guards against the renderer calling a method the preload never defined,
  // which throws "kayAPI.<group>.<method> is not a function" at runtime.
  // Name-based rather than structural, so it cannot prove the method sits in
  // the right group - but it reliably catches a method that is absent.
  const used = new Set();
  for (const file of jsFilesIn(RENDERER_SCRIPTS_DIR)) {
    const source = fs.readFileSync(path.join(RENDERER_SCRIPTS_DIR, file), 'utf8');
    for (const match of source.matchAll(/\bkayAPI\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      used.add(`${match[1]}.${match[2]}`);
    }
  }
  assert.ok(used.size > 10, 'should have found renderer kayAPI call sites');

  const missing = [...used]
    .filter((ref) => !preloadCode.includes(`${ref.split('.')[1]}:`))
    .sort();

  assert.deepEqual(missing, [], 'renderer calls kayAPI methods the preload does not expose');
});

test('Preload: listener allowlist matches channels main actually sends', () => {
  const preloadCode = fs.readFileSync(PRELOAD_PATH, 'utf8');

  // The preload's removeAllListeners()/onUpdaterEvent() are restricted to
  // LISTENER_CHANNELS. An entry that main never sends is a silent dead
  // subscription; a channel main sends that is missing from the list can
  // never be detached. Catch both directions.
  const listBlock = preloadCode.match(/const LISTENER_CHANNELS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(listBlock, 'preload should declare LISTENER_CHANNELS');

  const allowed = new Set(
    [...listBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
  );
  assert.ok(allowed.size > 0);

  const sent = new Set();
  for (const file of jsFilesIn(MAIN_DIR)) {
    const source = fs.readFileSync(path.join(MAIN_DIR, file), 'utf8');
    // Skip prefix literals like `'updater:' + event` - handled below.
    for (const match of source.matchAll(/sendToRenderer\(\s*'([^']+)'/g)) {
      if (!match[1].endsWith(':')) sent.add(match[1]);
    }
    for (const match of source.matchAll(/webContents\.send\(\s*'([^']+)'/g)) {
      sent.add(match[1]);
    }
  }
  // updater.js builds its channel as 'updater:' + event.
  for (const event of ['checking', 'available', 'not-available', 'error', 'progress', 'downloaded']) {
    sent.add(`updater:${event}`);
  }

  const deadEntries = [...allowed].filter((channel) => !sent.has(channel)).sort();
  assert.deepEqual(deadEntries, [],
    'LISTENER_CHANNELS contains channels nothing in main ever sends');

  // Anything main sends that the preload cannot subscribe to is unreachable.
  const unreachable = [...sent].filter((channel) => !allowed.has(channel)).sort();
  assert.deepEqual(unreachable, [],
    'main sends channels the preload listener allowlist does not cover');
});

