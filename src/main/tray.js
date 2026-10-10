const { app, Tray, Menu, nativeImage, BrowserWindow } = require('electron');
const path = require('path');
const { showWindow, hideWindow, getWindow, toggleWindow } = require('./window');
const { getSettings, setSetting } = require('./settings');
const { registerHotkey, unregisterHotkey, updateHotkey } = require('./hotkey');
const { autoUpdater } = require('electron-updater');

let tray = null;
let isOn = false;

function createTrayIcon() {
  // Try to load custom icon, fallback to default
  let iconPath = path.join(__dirname, '..', '..', 'build', 'icon.ico');
  let icon = nativeImage.createFromPath(iconPath);

  // If icon doesn't exist, create a simple fallback using base64 PNG
  if (icon.isEmpty()) {
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

  // Update tray menu when settings change
  const { ipcMain } = require('electron');
  ipcMain.on('settings:changed', () => {
    tray.setContextMenu(buildMenu());
  });

  ipcMain.on('hotkey:changed', () => {
    tray.setContextMenu(buildMenu());
  });

  return tray;
}

function toggleOnOff() {
  isOn = !isOn;
  setSetting('isOn', isOn);

  if (isOn) {
    showWindow();
    const settings = getSettings();
    registerHotkey(settings.hotkey);
  } else {
    hideWindow();
    unregisterHotkey();
  }

  // Update tray menu
  if (tray) {
    tray.setContextMenu(buildMenu());
  }

  // Notify renderer
  const win = getWindow();
  if (win) {
    win.webContents.send('app:state-changed', { isOn });
  }
}

function checkForUpdates(manual = false) {
  autoUpdater.checkForUpdates().catch((error) => {
    if (manual) {
      const win = getWindow();
      if (win) {
        win.webContents.send('updater:error', error.message);
      }
    }
  });
}

function getTray() {
  return tray;
}

function setTrayState(on) {
  isOn = on;
  if (tray) {
    tray.setContextMenu(buildMenu());
  }
}

module.exports = {
  setupTray,
  getTray,
  toggleOnOff,
  checkForUpdates,
  setTrayState,
};