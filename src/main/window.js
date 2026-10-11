const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { getIsQuitting } = require('./state');
const { getAppIcon } = require('./app-icon');

let mainWindow = null;

// move/resize fire on every pixel of a drag. Persisting each one would write
// the settings file, notify the tray and send IPC continuously for a value
// that only matters once the drag finishes.
const SAVE_BOUNDS_DELAY_MS = 300;
let boundsTimer = null;
let pendingBounds = null;

// Minimum window dimensions. Duplicated in renderer/scripts/window-resize.js,
// which enforces them during the drag; resizeWindow() re-enforces them at the
// IPC boundary so the renderer cannot talk the window smaller than this.
const MIN_WIDTH = 400;
const MIN_HEIGHT = 500;

function createWindow() {
  const settings = require('./settings').getSettings();
  const bounds = settings.windowBounds || { width: 500, height: 700 };
  const opacity = settings.windowOpacity || 0.95;
  const appIcon = getAppIcon();

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
    // Spread rather than assigning `icon: getAppIcon()` outright: if the key
    // is present but not an image, Electron warns "Argument must be a file
    // path or a NativeImage". Omitted, it falls back to the exe's own icon.
    ...(appIcon ? { icon: appIcon } : {}),
  });

  // Load the renderer. A failed load is worth surfacing instead of leaving an
  // invisible, apparently-alive window behind.
  const isDev = process.argv.includes('--dev');
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
    .catch((error) => console.error('[Window] Failed to load renderer:', error));
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // NOTE: navigation and window.open are guarded centrally in index.js via
  // web-contents-created, using the tested classifier in navigation.js. An
  // earlier local will-navigate guard here allowed *any* file:// URL and only
  // worked while the stricter listener also happened to be installed.

  // Handle window state changes
  mainWindow.on('close', (e) => {
    if (!getIsQuitting()) {
      e.preventDefault();
      hideWindow();
    }
  });

  mainWindow.on('move', saveBounds);
  mainWindow.on('resize', saveBounds);

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
    sendToRenderer('window:shown');
  }
}

function hideWindow() {
  if (mainWindow && mainWindow.isVisible()) {
    // Persist the final position now rather than leaving it to the debounce.
    flushPendingBounds();
    mainWindow.hide();
    sendToRenderer('window:hidden');
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

/**
 * Send an IPC event to the renderer, safely.
 *
 * Every send in the main process used an ad-hoc `getWindow()` + null check,
 * which still threw "Object has been destroyed" when the window existed but
 * was mid-destruction - tray and hotkey events fire at any point, including
 * during shutdown. One helper makes that guard uniform.
 */
function sendToRenderer(channel, ...args) {
  if (
    mainWindow
    && !mainWindow.isDestroyed()
    && !mainWindow.webContents.isDestroyed()
  ) {
    mainWindow.webContents.send(channel, ...args);
  }
}

/**
 * Resize the window to the given dimensions, keeping its current position.
 *
 * The renderer's resize handle sends only {width, height}, so the handler
 * must merge that with the live bounds - passing a partial rect to setBounds
 * is platform-dependent, and trusting renderer-supplied x/y would let a
 * compromised renderer fling the window off-screen. Size is clamped to the
 * display's work area.
 */
function resizeWindow(width, height) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;

  const current = mainWindow.getBounds();
  const clamp = (value, fallback, min, max) => {
    const numeric = Number(value);
    const n = Number.isFinite(numeric) ? Math.round(numeric) : fallback;
    return Math.max(min, Math.min(max, n));
  };

  const display = screen.getDisplayMatching(current);
  const area = display.workArea;

  const next = {
    x: current.x,
    y: current.y,
    width: clamp(width, current.width, MIN_WIDTH, area.width),
    height: clamp(height, current.height, MIN_HEIGHT, area.height),
  };

  // Keep at least the top-left corner inside the work area, so a window
  // resized on one display cannot end up stranded off another.
  next.x = Math.min(Math.max(next.x, area.x), area.x + area.width - next.width);
  next.y = Math.min(Math.max(next.y, area.y), area.y + area.height - next.height);

  mainWindow.setBounds(next);
  return next;
}

function setWindowOpacity(opacity) {
  if (mainWindow) {
    const numeric = Number(opacity);
    if (!Number.isFinite(numeric)) return;
    const clampedOpacity = Math.max(0.3, Math.min(1, numeric));
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

// NOTE: the window:* IPC handlers live in ipc.js. This file used to register a
// second, identical set here; it was never called, and invoking it would have
// thrown "Attempted to register a second handler".

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
  resizeWindow,
  sendToRenderer,
};