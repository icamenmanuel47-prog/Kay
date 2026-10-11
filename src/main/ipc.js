const { ipcMain, shell, app } = require('electron');
const fs = require('fs');
const { getSettings, getSettingsForRenderer, onSettingsChanged, setSetting, setApiKey, deleteApiKey, getHotkey, isEncryptionAvailable, resetSettings } = require('./settings');
const { updateHotkey, unregisterHotkey } = require('./hotkey');
const { hideWindow, getWindow, setWindowOpacity, setAlwaysOnTop, isWindowOnTop, resizeWindow, sendToRenderer } = require('./window');
const { toggleOnOff } = require('./tray');
const { checkForUpdates } = require('./updater');
const { CONVERSATIONS_DIR } = require('./conversations');
const { classifyNavigation } = require('./navigation');

// Keys the renderer may write through settings:set, each with a validator.
// Anything else is rejected rather than silently stored. The list is
// deliberately minimal - it is exactly what the settings UI edits today.
// Reserved state that only the main process may own (isOn, apiKey, hotkey,
// windowBounds, favoriteModels, launchAtStartup) is not writable from here,
// so a renderer-side bug can no longer overwrite the on/off state, fling the
// window somewhere, or clobber settings that another IPC handler is the
// source of truth for.
const SETTABLE_SETTINGS = {
  theme: (v) => typeof v === 'string' && ['light', 'dark', 'system'].includes(v),
  windowOpacity: (v) => Number.isFinite(v) && v >= 0.3 && v <= 1,
  defaultModel: (v) => typeof v === 'string' && v.length > 0 && v.length <= 200,
  systemPrompt: (v) => typeof v === 'string' && v.length <= 20000,
  showNotifications: (v) => typeof v === 'boolean',
};

function setupIpc() {
  // Forward main-process settings changes to the renderer (masked). The preload
  // layer has always exposed onSettingsChanged(), but nothing ever sent the
  // event, so listeners registered against it never fired.
  onSettingsChanged(() => {
    sendToRenderer('settings:changed', getSettingsForRenderer());
  });

  // App state
  ipcMain.handle('app:get-state', () => {
    const settings = getSettings();
    return {
      isOn: settings.isOn,
      hotkey: settings.hotkey,
      version: app.getVersion(),
    };
  });

  ipcMain.handle('app:toggle-on-off', () => {
    // Delegate to tray.js: one implementation of on/off, so the tray menu,
    // window and persisted state cannot drift apart (they used to).
    return { isOn: toggleOnOff() };
  });

  ipcMain.handle('app:check-updates', async (_, manual = false) => {
    // Awaited so the UI gets a real answer instead of a permanent "checking".
    return await checkForUpdates(manual);
  });

  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  ipcMain.handle('app:open-external', async (_, url) => {
    // Renderer-supplied URL: only http(s) is ever handed to the OS shell.
    const { openExternal } = classifyNavigation(url);
    if (!openExternal) {
      return { success: false, error: 'Blocked URL' };
    }
    try {
      await shell.openExternal(openExternal);
      return { success: true };
    } catch (error) {
      console.error('[IPC] openExternal failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Open data folder
  ipcMain.handle('app:open-data-folder', async () => {
    try {
      // openPath resolves with an error string rather than rejecting; either
      // way the user gets an answer instead of a silently missing folder.
      const error = await shell.openPath(app.getPath('userData'));
      return error
        ? { success: false, error }
        : { success: true };
    } catch (error) {
      console.error('[IPC] open-data-folder failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Reset all data
  ipcMain.handle('app:reset-all-data', () => {
    try {
      // Stop everything that survives a settings reset first: the global
      // hotkey and the visible window, so the app does not come back
      // half-configured after the restart.
      unregisterHotkey();
      hideWindow();

      // Reset settings (clears store and API key)
      resetSettings();

      // Delete conversations directory
      if (fs.existsSync(CONVERSATIONS_DIR)) {
        fs.rmSync(CONVERSATIONS_DIR, { recursive: true, force: true });
      }

      // Reset app state
      setSetting('isOn', false);

      // The sidebar still lists the deleted conversations until told otherwise
      sendToRenderer('conversations:list-changed');

      return { success: true };
    } catch (error) {
      console.error('[IPC] Reset all data failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Settings
  ipcMain.handle('settings:get', () => {
    // Never crosses IPC with a decrypted API key - see settings.js.
    return getSettingsForRenderer();
  });

  ipcMain.handle('settings:set', (_, key, value) => {
    // Validate both the key and the value. setSetting() used to accept
    // anything, so a renderer-side typo silently created a junk setting, and
    // reserved keys (apiKey, windowBounds, hotkey) were writable from there.
    const validate = SETTABLE_SETTINGS[key];
    if (!validate) {
      console.warn(`[IPC] Rejected settings:set for non-writable key: ${String(key).slice(0, 50)}`);
      return { success: false, error: `Setting "${key}" is not writable from the renderer` };
    }
    if (!validate(value)) {
      return { success: false, error: `Invalid value for setting "${key}"` };
    }
    setSetting(key, value);
    return { success: true };
  });

  ipcMain.handle('settings:set-api-key', (_, key) => {
    if (key && key.trim()) {
      setApiKey(key.trim());
      return { success: true };
    } else {
      deleteApiKey();
      return { success: true, deleted: true };
    }
  });

  ipcMain.handle('settings:delete-api-key', () => {
    deleteApiKey();
    return { success: true };
  });

  ipcMain.handle('settings:get-hotkey', () => {
    return { hotkey: getHotkey() };
  });

  ipcMain.handle('settings:set-hotkey', (_, hotkey) => {
    // updateHotkey returns { success, hotkey, reason } - pass the reason through
    // so the settings UI can say what actually went wrong.
    const result = updateHotkey(hotkey);
    return { success: result.success, hotkey: result.hotkey, reason: result.reason };
  });

  ipcMain.handle('settings:encryption-available', () => {
    return { available: isEncryptionAvailable() };
  });

  // Window controls
  ipcMain.handle('window:minimize', () => {
    const win = getWindow();
    if (win) win.minimize();
  });

  ipcMain.handle('window:close', () => {
    hideWindow();
  });

  ipcMain.handle('window:hide', () => {
    hideWindow();
  });

  ipcMain.handle('window:toggle-always-on-top', () => {
    const newState = !isWindowOnTop();
    setAlwaysOnTop(newState);
    return { alwaysOnTop: newState };
  });

  // Set-to-a-value, as opposed to toggling. applySettings() in the renderer
  // calls this on startup; it previously called a method the preload never
  // exposed, so "always on top" was silently never applied from settings.
  ipcMain.handle('window:set-always-on-top', (_, flag) => {
    const enabled = flag === true;
    setAlwaysOnTop(enabled);
    return { alwaysOnTop: enabled };
  });

  ipcMain.handle('window:set-opacity', (_, opacity) => {
    // Mirror the clamp in setWindowOpacity so the renderer never believes an
    // opacity the window does not actually have.
    const numeric = Number(opacity);
    const clamped = Number.isFinite(numeric) ? Math.max(0.3, Math.min(1, numeric)) : 0.95;
    setWindowOpacity(clamped);
    return { opacity: clamped };
  });

  ipcMain.handle('window:get-bounds', () => {
    const win = getWindow();
    return win ? win.getBounds() : null;
  });

  ipcMain.handle('window:set-bounds', (_, bounds) => {
    // Validate and clamp. Passing the renderer's object straight to
    // setBounds() was platform-dependent (a partial rect could drop x/y and
    // snap the window to the origin) and accepted unbounded values.
    const result = resizeWindow(bounds?.width, bounds?.height);
    return result ? { success: true, bounds: result } : { success: false };
  });

  ipcMain.handle('window:is-always-on-top', () => {
    return { alwaysOnTop: isWindowOnTop() };
  });

  // Launch at startup
  ipcMain.handle('app:set-launch-at-startup', (_, enabled) => {
    const want = enabled === true;
    try {
      app.setLoginItemSettings({
        openAtLogin: want,
        openAsHidden: true,
      });
    } catch (error) {
      console.error('[IPC] setLoginItemSettings failed:', error);
      return { success: false, error: error.message };
    }

    // Read back what the OS actually applied instead of assuming it worked -
    // on some setups (e.g. a non-admin user on Windows) it silently does not.
    const applied = app.getLoginItemSettings().openAtLogin === want;
    setSetting('launchAtStartup', applied);
    return applied
      ? { success: true }
      : { success: false, error: 'The OS rejected the login-item change' };
  });

  ipcMain.handle('app:get-launch-at-startup', () => {
    const settings = app.getLoginItemSettings();
    return { enabled: settings.openAtLogin };
  });
}

module.exports = { setupIpc };