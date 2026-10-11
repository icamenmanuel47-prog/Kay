const { app, shell } = require('electron');
const path = require('path');
const { setupTray } = require('./tray');
const { createWindow, getWindow, showWindow } = require('./window');
const { registerHotkey, unregisterHotkey, getLastFailureReason } = require('./hotkey');
const { loadSettings } = require('./settings');
const { setupUpdater } = require('./updater');
const { setupConversations } = require('./conversations');
const { setupOpenRouter } = require('./openrouter');
const { setupIpc } = require('./ipc');
const { setIsQuitting, getIsQuitting } = require('./state');
const { classifyNavigation } = require('./navigation');

let settings = null;

// An unhandled rejection usually means a bug, but it should never take the
// whole app down mid-conversation - and with no handler at all, Node's
// default is to print and exit.
process.on('uncaughtException', (error) => {
  console.error('[App] Uncaught exception:', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('[App] Unhandled rejection:', reason);
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  const win = getWindow();
  if (!win) return;

  // Honour the on/off state. Showing the window unconditionally desynced the
  // tray menu, which would still read "Turn On" while a window was visible.
  if (!settings || !settings.isOn) {
    require('./tray').toggleOnOff();
    return;
  }

  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// Security: Prevent navigation to external URLs
// (Logic lives in navigation.js so it can be unit tested - and because the
// old `origin !== 'file://'` comparison never matched anything.)
const rendererDir = path.join(__dirname, '..', 'renderer');

app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const { preventNavigation, openExternal } = classifyNavigation(navigationUrl, { allowedDir: rendererDir });
    if (preventNavigation) event.preventDefault();
    if (openExternal) shell.openExternal(openExternal).catch((error) => {
      console.warn('[App] openExternal failed:', error.message);
    });
  });

  contents.setWindowOpenHandler(({ url }) => {
    const { openExternal } = classifyNavigation(url, { allowedDir: rendererDir });
    if (openExternal) {
      shell.openExternal(openExternal).catch((error) => {
        console.warn('[App] openExternal failed:', error.message);
      });
    }
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

  // Register the global hotkey only when the app is on. Turning the app off
  // unregisters it, so registering it unconditionally at startup made a
  // restart disagree with the state the user had chosen.
  if (settings.isOn) {
    const hotkey = settings.hotkey || 'Ctrl+Shift+M';
    if (!registerHotkey(hotkey)) {
      console.warn(`[App] Startup hotkey registration failed (${getLastFailureReason()}): ${hotkey}`);
    }
  }

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

  // Startup update checks are deliberately not run: auto-update needs a
  // published release source, which is not configured. The Settings button
  // still checks on demand.
}).catch((error) => {
  // A failure here used to be invisible - the app simply never appeared.
  console.error('[App] Startup failed:', error);
  try {
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'Kay failed to start',
      `${error.message}\n\nSee the console output for details.`
    );
  } catch (dialogError) {
    console.error('[App] Could not show the startup error dialog:', dialogError);
  }
  app.quit();
});

// A crashed renderer must not leave an alive-looking, empty window behind.
app.on('render-process-gone', (event, details) => {
  console.error(`[App] Renderer process gone (${details.reason})`);
  const win = getWindow();
  if (win && !win.isDestroyed() && details.reason !== 'clean-exit') {
    win.webContents.reload();
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
  // macOS: honour the on/off state here too, for the same reason as
  // second-instance.
  if (!settings || !settings.isOn) return;
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