const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { setupTray } = require('./tray');
const { createWindow, getWindow, showWindow, hideWindow, toggleWindow } = require('./window');
const { registerHotkey, unregisterHotkey, updateHotkey } = require('./hotkey');
const { loadSettings, saveSettings, getSettings, setSetting, decryptApiKey } = require('./settings');
const { setupUpdater } = require('./updater');
const { setupConversations } = require('./conversations');
const { setupOpenRouter } = require('./openrouter');
const { setupIpc } = require('./ipc');
const { setIsQuitting, getIsQuitting } = require('./state');

let settings = null;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  const win = getWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

// Security: Prevent navigation to external URLs
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== 'file://') {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

app.whenReady().then(async () => {
  // Load settings first
  settings = await loadSettings();

  // Create the main window (hidden initially)
  await createWindow();

  // Setup system tray
  setupTray();

  // Register global hotkey
  const hotkey = settings.hotkey || 'Ctrl+Shift+M';
  registerHotkey(hotkey);

  // Setup auto-updater
  setupUpdater();

  // Setup IPC handlers
  setupConversations();
  setupOpenRouter();
  setupIpc();

  // Show window if "on" state saved
  if (settings.isOn) {
    showWindow();
  }

  // Check for updates on startup (silent)
  const { autoUpdater } = require('electron-updater');
  if (settings.checkUpdatesOnStartup) {
    autoUpdater.checkForUpdates().catch(() => {});
  }
});

app.on('window-all-closed', () => {
  if (!getIsQuitting()) {
    // On macOS, keep app running in tray
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }
});

app.on('before-quit', () => {
  setIsQuitting(true);
  unregisterHotkey();
  // Persist any throttled writes rather than losing them on exit.
  try {
    require('./conversations').flushPendingAssistantUpdates();
    require('./window').flushPendingBounds();
  } catch (error) {
    console.warn('[App] Failed to flush pending writes on quit:', error.message);
  }
});

app.on('activate', () => {
  const win = getWindow();
  if (win && !win.isVisible()) {
    showWindow();
  }
});

// Handle protocol links (for deep linking if needed)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('kay', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('kay');
}