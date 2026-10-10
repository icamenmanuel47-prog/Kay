/**
 * Kay - the app icon, loaded so it works both unpacked and packaged.
 *
 * `nativeImage.createFromPath` is not an option in a packaged build: the file
 * lives inside app.asar, and nativeImage does its own file I/O outside Node's
 * fs layer, so it cannot see into the archive. It logged
 * "Failed to load image from path ... app.asar\build\icon.ico" on every launch
 * and left the tray showing a generic fallback circle.
 *
 * `nativeImage.createFromBuffer` *is* asar-safe, because fs.readFileSync
 * transparently serves asar content - but it can only decode PNG and JPEG, not
 * .ico (verified: reading the .ico buffer yields an empty image, while the same
 * bytes converted to PNG decode fine). Hence src/main/icon.png, converted from
 * build/icon.ico, which electron-builder still uses for the .exe and installer
 * icons.
 */
const { nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ICON_PATH = path.join(__dirname, 'icon.png');

/** undefined until the first attempt, then a NativeImage or null. */
let icon;

/**
 * @returns {Electron.NativeImage|null} the app icon, or null if unavailable
 *   (callers must treat null as "fall back to the default icon").
 */
function getAppIcon() {
  if (icon !== undefined) return icon;

  try {
    const image = nativeImage.createFromBuffer(fs.readFileSync(ICON_PATH));
    icon = image.isEmpty() ? null : image;
  } catch (error) {
    console.warn('[Icon] Could not read app icon:', error.message);
    icon = null;
  }
  return icon;
}

module.exports = { getAppIcon, ICON_PATH };
