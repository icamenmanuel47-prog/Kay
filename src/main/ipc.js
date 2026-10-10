const { ipcMain, dialog, shell, app } = require('electron');
const fs = require('fs');
const { getSettings, getSettingsForRenderer, onSettingsChanged, setSetting, getApiKey, setApiKey, deleteApiKey, getHotkey, isEncryptionAvailable, resetSettings } = require('./settings');
const { updateHotkey } = require('./hotkey');
const { hideWindow, getWindow, setWindowOpacity, setAlwaysOnTop, isWindowOnTop } = require('./window');
const { toggleOnOff, checkForUpdates } = require('./tray');
const { CONVERSATIONS_DIR } = require('./conversations');

function setupIpc() {
  // Forward main-process settings changes to the renderer (masked). The preload
  // layer has always exposed onSettingsChanged(), but nothing ever sent the
  // event, so listeners registered against it never fired.
  onSettingsChanged(() => {
    const win = getWindow();
    if (win) {
      win.webContents.send('settings:changed', getSettingsForRenderer());
    }
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
    checkForUpdates(manual);
    return { success: true };
  });

  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  ipcMain.handle('app:open-external', (_, url) => {
    shell.openExternal(url);
  });

  // Open data folder
  ipcMain.handle('app:open-data-folder', () => {
    const userDataPath = app.getPath('userData');
    shell.openPath(userDataPath);
    return { success: true };
  });

  // Reset all data
  ipcMain.handle('app:reset-all-data', () => {
    try {
      // Reset settings (clears store and API key)
      resetSettings();

      // Delete conversations directory
      if (fs.existsSync(CONVERSATIONS_DIR)) {
        fs.rmSync(CONVERSATIONS_DIR, { recursive: true, force: true });
      }

      // Reset app state
      setSetting('isOn', false);

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
    setSetting(key, value);
    return { success: true };
  });

  ipcMain.handle('settings:get-api-key', () => {
    const key = getApiKey();
    return { apiKey: key || '' };
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

  ipcMain.handle('window:set-opacity', (_, opacity) => {
    setWindowOpacity(opacity);
    return { opacity };
  });

  ipcMain.handle('window:get-bounds', () => {
    const win = getWindow();
    return win ? win.getBounds() : null;
  });

  ipcMain.handle('window:set-bounds', (_, bounds) => {
    const win = getWindow();
    if (win) win.setBounds(bounds);
  });

  ipcMain.handle('window:is-always-on-top', () => {
    return { alwaysOnTop: isWindowOnTop() };
  });

  // Launch at startup
  ipcMain.handle('app:set-launch-at-startup', (_, enabled) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
    });
    setSetting('launchAtStartup', enabled);
    return { success: true };
  });

  ipcMain.handle('app:get-launch-at-startup', () => {
    const settings = app.getLoginItemSettings();
    return { enabled: settings.openAtLogin };
  });

  // Dialog helpers
  ipcMain.handle('dialog:show-save', async (_, options) => {
    const win = getWindow();
    const result = await dialog.showSaveDialog(win, options);
    return result;
  });

  ipcMain.handle('dialog:show-open', async (_, options) => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, options);
    return result;
  });

  ipcMain.handle('dialog:show-message-box', async (_, options) => {
    const win = getWindow();
    const result = await dialog.showMessageBox(win, options);
    return result;
  });
}

module.exports = { setupIpc };