const { globalShortcut } = require('electron');
const { setSetting } = require('./settings');
const { toggleWindow, getWindow } = require('./window');
const {
  parseHotkey,
  toAccelerator,
  isSafeGlobalHotkey,
  matchesUiohookHotkey,
  resolveUiohookKey,
} = require('./hotkey-logic');

let uiohookModule = null;
let useUiohook = false;
let currentHotkey = 'Ctrl+Shift+M';
let isRegistered = false;

/**
 * Why the most recent registration attempt failed. Read by updateHotkey so the
 * UI can say something more useful than "failed".
 * One of: null | 'unsafe' | 'unsupported-key' | 'in-use'.
 */
let lastFailureReason = null;

/**
 * Which mechanism is currently active - 'uiohook', 'globalShortcut' or null.
 * Exposed for diagnostics.
 */
let registrationMethod = null;

/**
 * Register the hotkey with uiohook-napi.
 *
 * Preferred, because uiohook listens at the OS level without consuming the
 * keystroke, so Ctrl+Shift+M still reaches whatever app has focus.
 *
 * @returns {boolean} true when uiohook is now listening
 */
function registerWithUiohook(hotkeyStr, parsed) {
  try {
    if (!uiohookModule) {
      uiohookModule = require('uiohook-napi');
    }
  } catch (error) {
    useUiohook = false;
    console.warn('[Hotkey] uiohook-napi unavailable, falling back to Electron globalShortcut:', error.message);
    return false;
  }

  const { uIOhook, UiohookKey } = uiohookModule;
  if (typeof uIOhook?.on !== 'function') {
    useUiohook = false;
    console.warn('[Hotkey] uiohook-napi did not expose an emitter; falling back to globalShortcut');
    return false;
  }

  const keycode = resolveUiohookKey(parsed.key, UiohookKey);
  if (keycode === undefined) {
    useUiohook = false;
    lastFailureReason = 'unsupported-key';
    console.warn(`[Hotkey] uiohook has no keycode for "${parsed.key}"`);
    return false;
  }

  // uIOhook is a process-wide singleton - always detach before re-attaching.
  uIOhook.removeAllListeners('keydown');
  uIOhook.on('keydown', (event) => {
    if (matchesUiohookHotkey(parsed, event, UiohookKey)) {
      // Intentionally no preventDefault: the keystroke passes through to the
      // focused application, which is the whole point of using uiohook.
      toggleWindow();
    }
  });

  uIOhook.start();
  useUiohook = true;
  console.log(`[Hotkey] Registered via uiohook: ${hotkeyStr}`);
  return true;
}

/**
 * Register the hotkey with Electron's globalShortcut.
 *
 * Fallback path. Note that this consumes the accelerator system-wide while
 * registered - it will not reach other applications.
 *
 * @returns {boolean} true when the accelerator was claimed
 */
function registerWithElectron(hotkeyStr) {
  try {
    const accelerator = toAccelerator(hotkeyStr);
    if (!accelerator) {
      lastFailureReason = 'unsupported-key';
      console.error(`[Hotkey] Cannot build an accelerator from "${hotkeyStr}"`);
      return false;
    }

    const success = globalShortcut.register(accelerator, () => {
      toggleWindow();
    });

    if (success) {
      console.log(`[Hotkey] Registered via Electron globalShortcut: ${accelerator}`);
      return true;
    }

    lastFailureReason = 'in-use';
    console.error(`[Hotkey] Failed to register: ${accelerator} (may be in use)`);
    return false;
  } catch (error) {
    lastFailureReason = 'in-use';
    console.error('[Hotkey] Electron globalShortcut error:', error.message);
    return false;
  }
}

/**
 * Register the global hotkey.
 *
 * Reports success honestly: isRegistered is only true when a mechanism
 * actually claimed the hotkey, so updateHotkey's revert path really fires.
 *
 * @returns {boolean}
 */
function registerHotkey(hotkeyStr) {
  if (!hotkeyStr) hotkeyStr = 'Ctrl+Shift+M';
  currentHotkey = hotkeyStr;
  lastFailureReason = null;
  registrationMethod = null;

  // Unregister existing first
  unregisterHotkey();

  const parsed = parseHotkey(hotkeyStr);
  if (!isSafeGlobalHotkey(parsed)) {
    // A bare character would fire on every matching keystroke in every app,
    // in either mechanism. Refuse rather than silently hijack typing.
    lastFailureReason = 'unsafe';
    isRegistered = false;
    console.warn(`[Hotkey] Refusing "${hotkeyStr}": global hotkeys need a modifier key or a function key`);
    return false;
  }

  let success = registerWithUiohook(hotkeyStr, parsed);
  if (success) {
    registrationMethod = 'uiohook';
  } else {
    success = registerWithElectron(hotkeyStr);
    registrationMethod = success ? 'globalShortcut' : null;
  }

  isRegistered = success;
  if (!success && !lastFailureReason) lastFailureReason = 'in-use';
  return isRegistered;
}

/**
 * Unregister the global hotkey.
 */
function unregisterHotkey() {
  if (useUiohook && uiohookModule?.uIOhook) {
    try {
      uiohookModule.uIOhook.stop();
      uiohookModule.uIOhook.removeAllListeners('keydown');
      console.log('[Hotkey] uiohook unregistered');
    } catch (error) {
      console.warn('[Hotkey] uiohook unregister error:', error.message);
    }
    useUiohook = false;
  }

  try {
    globalShortcut.unregisterAll();
  } catch (error) {
    console.warn('[Hotkey] Electron unregister error:', error.message);
  }

  isRegistered = false;
  registrationMethod = null;
}

/**
 * Update the hotkey (unregister old, register new).
 *
 * On failure the previous hotkey is re-registered and the reason is returned,
 * so the settings UI can tell the user what went wrong instead of claiming
 * success.
 *
 * @param {string} newHotkey
 * @returns {{success: boolean, hotkey: string, reason: string|null}}
 */
function updateHotkey(newHotkey) {
  if (!newHotkey) {
    return { success: false, hotkey: currentHotkey, reason: 'invalid' };
  }

  const oldHotkey = currentHotkey;
  currentHotkey = newHotkey;

  unregisterHotkey();
  const success = registerHotkey(newHotkey);

  if (success) {
    setSetting('hotkey', newHotkey);
    const win = getWindow();
    if (win) {
      win.webContents.send('hotkey:changed', newHotkey);
    }
    return { success: true, hotkey: newHotkey, reason: null };
  }

  const reason = lastFailureReason || 'in-use';

  // Revert to the hotkey that was working before.
  currentHotkey = oldHotkey;
  registerHotkey(oldHotkey);

  return { success: false, hotkey: oldHotkey, reason };
}

/**
 * Get the current hotkey
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

/**
 * Diagnostic: which mechanism is holding the hotkey right now.
 */
function getRegistrationInfo() {
  return { hotkey: currentHotkey, registered: isRegistered, method: registrationMethod };
}

module.exports = {
  registerHotkey,
  unregisterHotkey,
  updateHotkey,
  getHotkey,
  isHotkeyRegistered,
  getHotkeyDisplay,
  getRegistrationInfo,
  parseHotkey,
  toAccelerator,
};
