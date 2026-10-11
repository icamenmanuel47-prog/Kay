const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');
const { sendToRenderer } = require('./window');
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
  sendToRenderer('updater:' + event, data);
}

// electron-updater needs app-update.yml, which electron-builder only writes
// into a packaged build. Under `electron .` the check would throw a confusing
// "no published versions" error, so name the situation instead.
function isPackaged() {
  try {
    const { app } = require('electron');
    return app.isPackaged === true;
  } catch {
    return false;
  }
}

// Check for updates.
//
// Returns a result rather than only firing events, so callers can tell the
// user what happened - the renderer never subscribed to the updater event
// channels, which is why a manual check used to end in silence.
//
// When an update exists it is downloaded in the background straight away;
// autoInstallOnAppQuit then applies it on the next quit, so the user only
// ever needs one click. Progress and completion arrive as updater:* events.
//
// @param {boolean} manual true when triggered by the user
// @returns {Promise<{success: boolean, error?: string, updateAvailable?: boolean, version?: string, downloading?: boolean}>}
async function checkForUpdates(manual = false) {
  if (!isPackaged()) {
    const error = 'Updates can only be checked from the installed app.';
    if (manual) notifyRenderer('error', { message: error });
    return { success: false, error };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    const updateInfo = result?.updateInfo;
    const available = !!(
      updateInfo
      && updateInfo.version
      && updateInfo.version !== autoUpdater.currentVersion
    );

    if (available) {
      // Deliberately not awaited: downloading can take a while and the caller
      // only needs to know an update exists. Failures surface through the
      // updater:error event and this promise's own catch.
      autoUpdater.downloadUpdate().catch((error) => {
        console.warn('[Updater] Background download failed:', error.message);
        notifyRenderer('error', { message: `Download failed: ${error.message}` });
      });
    }

    return {
      success: true,
      updateAvailable: available,
      version: updateInfo?.version,
      downloading: available,
    };
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