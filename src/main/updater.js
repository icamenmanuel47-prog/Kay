const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');
const { getWindow } = require('./window');
const { getSetting } = require('./settings');

function setupUpdater() {
  // Configure auto-updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Disable default logger (we'll handle our own)
  autoUpdater.logger = require('electron-log');
  autoUpdater.logger.transports.file.level = 'info';

  // Events
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
    notifyRenderer('checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    notifyRenderer('available', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[Updater] No update available');
    notifyRenderer('not-available', info);
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err);
    notifyRenderer('error', { message: err.message });
  });

  autoUpdater.on('download-progress', (progress) => {
    notifyRenderer('progress', progress);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded');
    notifyRenderer('downloaded', info);
  });
}

function notifyRenderer(event, data = {}) {
  const win = getWindow();
  if (win) {
    win.webContents.send('updater:' + event, data);
  }
}

// Check for updates.
//
// Returns a result rather than only firing events, so callers can tell the
// user what happened - the renderer never subscribed to the updater event
// channels, which is why a manual check used to end in silence.
//
// @param {boolean} manual true when triggered by the user
// @returns {Promise<{success: boolean, error?: string, updateAvailable?: boolean, version?: string}>}
async function checkForUpdates(manual = false) {
  try {
    const result = await autoUpdater.checkForUpdates();
    const updateInfo = result?.updateInfo;
    const available = !!(
      updateInfo
      && updateInfo.version
      && updateInfo.version !== autoUpdater.currentVersion
    );
    return { success: true, updateAvailable: available, version: updateInfo?.version };
  } catch (error) {
    if (manual) {
      notifyRenderer('error', { message: error.message });
    }
    console.warn('[Updater] checkForUpdates failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Download update
async function downloadUpdate() {
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    console.error('[Updater] Download failed:', error);
    notifyRenderer('error', { message: error.message });
    throw error;
  }
}

// Install update and quit
function installUpdate() {
  autoUpdater.quitAndInstall(false, true);
}

// Get current version
function getCurrentVersion() {
  const { app } = require('electron');
  return app.getVersion();
}

module.exports = {
  setupUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getCurrentVersion,
  autoUpdater,
};