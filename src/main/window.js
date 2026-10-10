const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { getSetting, setSetting } = require('./settings');
const { getIsQuitting } = require('./state');

let mainWindow = null;
let isWindowVisible = false;

// move/resize fire on every pixel of a drag. Persisting each one would write
// the settings file, notify the tray and send IPC continuously for a value
// that only matters once the drag finishes.
const SAVE_BOUNDS_DELAY_MS = 300;
let boundsTimer = null;
let pendingBounds = null;

function createWindow() {
  const settings = require('./settings').getSettings();
  const bounds = settings.windowBounds || { width: 500, height: 700 };
  const opacity = settings.windowOpacity || 0.95;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Ensure window is on screen
  let x = bounds.x;
  let y = bounds.y;
  if (x === undefined || y === undefined || x < 0 || y < 0 || x > screenWidth - 100 || y > screenHeight - 100) {
    x = Math.round((screenWidth - bounds.width) / 2);
    y = Math.round((screenHeight - bounds.height) / 2);
  }

  mainWindow = new BrowserWindow({
    x,
    y,
    width: Math.max(400, Math.min(bounds.width, screenWidth - 100)),
    height: Math.max(500, Math.min(bounds.height, screenHeight - 100)),
    minWidth: 400,
    minHeight: 500,
    maxWidth: screenWidth,
    maxHeight: screenHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: settings.alwaysOnTop !== false,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    show: false,
    opacity,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
  });

  // Load the renderer
  const isDev = process.argv.includes('--dev');
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Prevent navigation
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });

  // Handle window state changes
  mainWindow.on('close', (e) => {
    if (!getIsQuitting()) {
      e.preventDefault();
      hideWindow();
    }
  });

  mainWindow.on('move', saveBounds);
  mainWindow.on('resize', saveBounds);

  // Handle theme changes
  ipcMain.on('theme:changed', (_, theme) => {
    setSetting('theme', theme);
  });

  return mainWindow;
}

/**
 * Record the window position, debounced by SAVE_BOUNDS_DELAY_MS.
 */
function saveBounds() {
  if (!mainWindow) return;
  pendingBounds = mainWindow.getBounds();
  if (boundsTimer !== null) return;
  boundsTimer = setTimeout(flushPendingBounds, SAVE_BOUNDS_DELAY_MS);
}

/**
 * Write any debounced window position immediately.
 * Called when the window hides and on quit so the last position is never lost.
 *
 * @returns {boolean} whether a write happened
 */
function flushPendingBounds() {
  if (boundsTimer !== null) {
    clearTimeout(boundsTimer);
    boundsTimer = null;
  }
  if (!pendingBounds) return false;

  const bounds = pendingBounds;
  pendingBounds = null;
  require('./settings').setSetting('windowBounds', bounds);
  return true;
}

function getWindow() {
  return mainWindow;
}

function showWindow() {
  if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
    isWindowVisible = true;
    mainWindow.webContents.send('window:shown');
  }
}

function hideWindow() {
  if (mainWindow && mainWindow.isVisible()) {
    // Persist the final position now rather than leaving it to the debounce.
    flushPendingBounds();
    mainWindow.hide();
    isWindowVisible = false;
    mainWindow.webContents.send('window:hidden');
  }
}

function toggleWindow() {
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      hideWindow();
    } else {
      showWindow();
    }
  }
}

function setWindowOpacity(opacity) {
  if (mainWindow) {
    const clampedOpacity = Math.max(0.3, Math.min(1, opacity));
    mainWindow.setOpacity(clampedOpacity);
    require('./settings').setSetting('windowOpacity', clampedOpacity);
  }
}

function setAlwaysOnTop(flag) {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(flag);
    require('./settings').setSetting('alwaysOnTop', flag);
  }
}

function isWindowOnTop() {
  return mainWindow ? mainWindow.isAlwaysOnTop() : true;
}

// IPC handlers for window controls
function setupWindowIpc() {
  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
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
    return newState;
  });

  ipcMain.handle('window:set-opacity', (_, opacity) => {
    setWindowOpacity(opacity);
  });

  ipcMain.handle('window:get-bounds', () => {
    return mainWindow ? mainWindow.getBounds() : null;
  });

  ipcMain.handle('window:set-bounds', (_, bounds) => {
    if (mainWindow) mainWindow.setBounds(bounds);
  });

  ipcMain.handle('window:is-always-on-top', () => {
    return isWindowOnTop();
  });
}

module.exports = {
  createWindow,
  getWindow,
  showWindow,
  hideWindow,
  toggleWindow,
  setWindowOpacity,
  setAlwaysOnTop,
  isWindowOnTop,
  flushPendingBounds,
  setupWindowIpc,
};