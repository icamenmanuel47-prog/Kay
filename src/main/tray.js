const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { showWindow, hideWindow, getWindow, toggleWindow } = require('./window');
const { getAppIcon } = require('./app-icon');
const { getSettings, setSetting, onSettingsChanged } = require('./settings');
const { registerHotkey, unregisterHotkey } = require('./hotkey');
const { checkForUpdates } = require('./updater');

let tray = null;
let isOn = false;

function createTrayIcon() {
  // Shared loader; see app-icon.js for why this cannot be createFromPath.
  let icon = getAppIcon();

  // If icon doesn't exist, create a simple fallback using base64 PNG
  if (icon === null) {
    // 16x16 blue circle PNG (base64)
    const fallbackBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAADhSURBVDhPY/z//z8DJQAggJiQOe/fv2fv3r1Pnjz58ePHw4cPH378+PH79+/fv3///v379+/fv3/////AQYAJ8tAfsJtTQgAAAABJRU5ErkJggg==';
    icon = nativeImage.createFromDataURL(`data:image/png;base64,${fallbackBase64}`);
  }

  return icon.resize({ width: 16, height: 16 });
}

function buildMenu() {
  const settings = getSettings();
  isOn = settings.isOn;

  const template = [
    {
      label: isOn ? 'Turn Off' : 'Turn On',
      type: 'normal',
      click: () => toggleOnOff(),
    },
    { type: 'separator' },
    {
      label: isOn ? 'Hide Window' : 'Show Window',
      type: 'normal',
      enabled: isOn,
      click: () => {
        const win = getWindow();
        if (win && win.isVisible()) {
          hideWindow();
        } else {
          showWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Settings',
      type: 'normal',
      click: () => {
        const win = getWindow();
        if (win) {
          win.webContents.send('open-settings');
          if (!win.isVisible()) showWindow();
        }
      },
    },
    {
      label: 'Check for Updates',
      type: 'normal',
      click: () => checkForUpdates(true),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      type: 'normal',
      click: () => {
        app.quit();
      },
    },
  ];

  return Menu.buildFromTemplate(template);
}

function setupTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Kay - Personal Assistant');
  tray.setContextMenu(buildMenu());

  // Double-click to toggle window
  tray.on('double-click', () => {
    if (isOn) {
      toggleWindow();
    }
  });

  // Rebuild the menu whenever settings change. This used to listen on a
  // 'settings:changed' IPC channel that nothing ever sent, so the labels went
  // stale as soon as Kay was toggled from the app instead of the tray.
  onSettingsChanged(() => {
    if (tray) tray.setContextMenu(buildMenu());
  });

  return tray;
}

/**
 * The single implementation of on/off.
 *
 * Reads the next state from settings rather than flipping a local flag, so the
 * tray menu, the window and the persisted state can never disagree with each
 * other. ipc.js delegates here instead of reimplementing it.
 *
 * @returns {boolean} the new on/off state
 */
function toggleOnOff() {
  const settings = getSettings();
  const newState = !settings.isOn;

  // Persisting emits settings-changed, which rebuilds the tray menu.
  setSetting('isOn', newState);
  isOn = newState;

  if (newState) {
    showWindow();
    registerHotkey(settings.hotkey);
  } else {
    hideWindow();
    unregisterHotkey();
  }

  // Notify renderer
  const win = getWindow();
  if (win) {
    win.webContents.send('app:state-changed', { isOn: newState });
  }

  return newState;
}

function getTray() {
  return tray;
}

module.exports = {
  setupTray,
  getTray,
  toggleOnOff,
};