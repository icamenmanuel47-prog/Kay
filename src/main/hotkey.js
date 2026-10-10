const { globalShortcut, app } = require('electron');
const { getSetting, setSetting } = require('./settings');
const { showWindow, hideWindow, toggleWindow, getWindow } = require('./window');

let uiohook = null;
let useUiohook = false;
let currentHotkey = 'Ctrl+Shift+M';
let isRegistered = false;

/**
 * Parse hotkey string to uiohook format
 * e.g., "Ctrl+Shift+M" -> { ctrl: true, shift: true, key: 'm' }
 */
function parseHotkey(hotkeyStr) {
  const parts = hotkeyStr.toLowerCase().split('+');
  const result = { ctrl: false, alt: false, shift: false, meta: false, key: '' };

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === 'ctrl' || trimmed === 'control') result.ctrl = true;
    else if (trimmed === 'alt') result.alt = true;
    else if (trimmed === 'shift') result.shift = true;
    else if (trimmed === 'meta' || trimmed === 'cmd' || trimmed === 'command') result.meta = true;
    else result.key = trimmed;
  }

  return result;
}

/**
 * Convert hotkey to Electron accelerator format
 */
function toAccelerator(hotkeyStr) {
  const parts = hotkeyStr.split('+').map(p => p.trim());
  const key = parts.pop();
  const mods = parts.map(p => {
    const lower = p.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') return 'Control';
    if (lower === 'alt') return 'Alt';
    if (lower === 'shift') return 'Shift';
    if (lower === 'meta' || lower === 'cmd' || lower === 'command') return 'Command';
    return p;
  });
  return [...mods, key.toUpperCase()].join('+');
}

/**
 * Register hotkey using uiohook-napi (doesn't swallow keys)
 */
function registerWithUiohook(hotkeyStr) {
  try {
    if (!uiohook) {
      uiohook = require('uiohook-napi');
    }

    const parsed = parseHotkey(hotkeyStr);

    // Remove existing listener if any
    if (useUiohook) {
      uiohook.removeAllListeners('keydown');
    }

    uiohook.on('keydown', (e) => {
      // Check if this matches our hotkey
      const match =
        (!parsed.ctrl || e.ctrlKey) &&
        (!parsed.alt || e.altKey) &&
        (!parsed.shift || e.shiftKey) &&
        (!parsed.meta || e.metaKey) &&
        e.key.toLowerCase() === parsed.key.toLowerCase();

      if (match) {
        // Don't prevent default - let the key pass through
        toggleWindow();
      }
    });

    uiohook.start();
    useUiohook = true;
    console.log(`[Hotkey] Registered via uiohook: ${hotkeyStr}`);
    return true;
  } catch (error) {
    console.warn('[Hotkey] uiohook registration failed, falling back to Electron globalShortcut:', error.message);
    useUiohook = false;
    if (uiohook) {
      try {
        uiohook.stop();
      } catch (e) {}
      uiohook = null;
    }
    return false;
  }
}

/**
 * Register hotkey using Electron's globalShortcut (fallback)
 */
function registerWithElectron(hotkeyStr) {
  try {
    const accelerator = toAccelerator(hotkeyStr);
    const success = globalShortcut.register(accelerator, () => {
      toggleWindow();
    });

    if (success) {
      console.log(`[Hotkey] Registered via Electron globalShortcut: ${accelerator}`);
      return true;
    } else {
      console.error(`[Hotkey] Failed to register: ${accelerator} (may be in use)`);
      return false;
    }
  } catch (error) {
    console.error('[Hotkey] Electron globalShortcut error:', error.message);
    return false;
  }
}

/**
 * Register the global hotkey
 */
function registerHotkey(hotkeyStr) {
  if (!hotkeyStr) hotkeyStr = 'Ctrl+Shift+M';
  currentHotkey = hotkeyStr;

  // Unregister existing first
  unregisterHotkey();

  // Try uiohook first (preferred - doesn't swallow keys)
  const uiohookSuccess = registerWithUiohook(hotkeyStr);

  if (!uiohookSuccess) {
    // Fallback to Electron's globalShortcut
    registerWithElectron(hotkeyStr);
  }

  isRegistered = true;
  return isRegistered;
}

/**
 * Unregister the global hotkey
 */
function unregisterHotkey() {
  if (useUiohook && uiohook) {
    try {
      uiohook.stop();
      uiohook.removeAllListeners('keydown');
      useUiohook = false;
      console.log('[Hotkey] uiohook unregistered');
    } catch (error) {
      console.warn('[Hotkey] uiohook unregister error:', error.message);
    }
  }

  try {
    globalShortcut.unregisterAll();
    console.log('[Hotkey] Electron globalShortcut unregistered all');
  } catch (error) {
    console.warn('[Hotkey] Electron unregister error:', error.message);
  }

  isRegistered = false;
}

/**
 * Update the hotkey (unregister old, register new)
 */
function updateHotkey(newHotkey) {
  if (!newHotkey) return false;

  const oldHotkey = currentHotkey;
  currentHotkey = newHotkey;

  unregisterHotkey();
  const success = registerHotkey(newHotkey);

  if (success) {
    setSetting('hotkey', newHotkey);
    // Notify renderer
    const win = getWindow();
    if (win) {
      win.webContents.send('hotkey:changed', newHotkey);
    }
  } else {
    // Revert on failure
    currentHotkey = oldHotkey;
    registerHotkey(oldHotkey);
  }

  return success;
}

/**
 * Get current hotkey
 */
function getHotkey() {
  return currentHotkey;
}

/**
 * Check if hotkey is registered
 */
function isHotkeyRegistered() {
  return isRegistered;
}

/**
 * Get hotkey display string for UI
 */
function getHotkeyDisplay() {
  return currentHotkey;
}

module.exports = {
  registerHotkey,
  unregisterHotkey,
  updateHotkey,
  getHotkey,
  isHotkeyRegistered,
  getHotkeyDisplay,
  parseHotkey,
  toAccelerator,
};