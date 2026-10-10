/**
 * Kay - Hotkey parsing and matching.
 *
 * This module is deliberately free of Electron imports so it can be unit tested
 * under plain `node --test`. Everything that touches Electron (globalShortcut,
 * uiohook-napi, the tray, the window) stays in hotkey.js.
 */

/**
 * Modifier aliases, all normalised to the four canonical flags.
 */
const MODIFIER_NAMES = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
  win: 'meta',
};

/**
 * Keys where the DOM `event.key` value differs from what we want to display
 * and round-trip. Looked up with the already-lowercased token.
 */
const KEY_ALIASES = {
  ' ': 'Space',
  esc: 'Escape',
  del: 'Delete',
  ins: 'Insert',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
};

/**
 * `event.key` -> Electron accelerator names. Electron does not understand the
 * `Arrow*` spelling the DOM hands us, and single characters must be uppercased.
 */
const ACCELERATOR_KEYS = {
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  ' ': 'Space',
  space: 'Space',
  enter: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  capslock: 'CapsLock',
};

/**
 * Parse a hotkey string such as "Ctrl+Shift+M" into its parts.
 *
 * @param {string} hotkeyStr
 * @returns {{ctrl: boolean, alt: boolean, shift: boolean, meta: boolean, key: string}}
 */
function parseHotkey(hotkeyStr) {
  const parsed = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  if (typeof hotkeyStr !== 'string' || !hotkeyStr) return parsed;

  for (const rawPart of hotkeyStr.split('+')) {
    // The renderer sends the space bar as the literal " " character
    // (event.key is " " for it), which would otherwise be lost to trimming.
    if (rawPart === ' ') {
      parsed.key = 'Space';
      continue;
    }

    const lowered = rawPart.trim().toLowerCase();
    if (!lowered) continue;

    const modifier = MODIFIER_NAMES[lowered];
    if (modifier) {
      parsed[modifier] = true;
    } else {
      parsed.key = KEY_ALIASES[lowered] || rawPart.trim();
    }
  }

  return parsed;
}

/**
 * Convert a hotkey string into an Electron accelerator, e.g. "Ctrl+Shift+M"
 * -> "Control+Shift+M".
 *
 * @param {string} hotkeyStr
 * @param {string} [platform] for the Meta key spelling (Command on macOS, Super elsewhere)
 * @returns {string} empty string when the hotkey has no key part
 */
function toAccelerator(hotkeyStr, platform = process.platform) {
  const parsed = parseHotkey(hotkeyStr);
  if (!parsed.key) return '';

  const modifiers = [];
  if (parsed.ctrl) modifiers.push('Control');
  if (parsed.alt) modifiers.push('Alt');
  if (parsed.shift) modifiers.push('Shift');
  if (parsed.meta) modifiers.push(platform === 'darwin' ? 'Command' : 'Super');

  const lowered = parsed.key.toLowerCase();
  const key = ACCELERATOR_KEYS[lowered]
    || (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);

  return [...modifiers, key].join('+');
}

/**
 * A hotkey that would be usable as a *global* hotkey.
 *
 * A bare character (e.g. "A") can never be one: a global listener would fire
 * every time that key is pressed in any application. Function keys are the
 * one acceptable modifier-less option.
 *
 * @param {{key: string, ctrl: boolean, alt: boolean, shift: boolean, meta: boolean}} parsed
 * @returns {boolean}
 */
function isSafeGlobalHotkey(parsed) {
  if (!parsed || !parsed.key) return false;
  if (parsed.ctrl || parsed.alt || parsed.shift || parsed.meta) return true;
  return /^f([1-9]|1[0-9]|2[0-4])$/i.test(parsed.key);
}

/**
 * Canonical spelling for a key name. The DOM reports the space bar as the
 * literal " " while we store it as "Space", so both sides must be normalised
 * before they can be compared.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeKeyName(value) {
  const name = String(value ?? '');
  return name === ' ' ? 'Space' : name;
}

/**
 * Exact-match a parsed hotkey against a DOM-style KeyboardEvent.
 *
 * "Exact" matters: requiring only that the listed modifiers are *present*
 * would make "Ctrl+Shift+M" fire on Ctrl+Shift+Alt+M, and would let a
 * modifier-less hotkey fire on every matching keystroke.
 *
 * @param {{key: string, ctrl: boolean, alt: boolean, shift: boolean, meta: boolean}} parsed
 * @param {{key?: string, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean}} event
 * @returns {boolean}
 */
function matchesHotkey(parsed, event) {
  if (!parsed || !parsed.key || !event) return false;

  if (!!event.ctrlKey !== !!parsed.ctrl) return false;
  if (!!event.altKey !== !!parsed.alt) return false;
  if (!!event.shiftKey !== !!parsed.shift) return false;
  if (!!event.metaKey !== !!parsed.meta) return false;

  return normalizeKeyName(event.key).toLowerCase() === normalizeKeyName(parsed.key).toLowerCase();
}

/**
 * Map a key name onto a uiohook keycode.
 *
 * uiohook-napi's keydown event carries a numeric `keycode`, not a DOM `key`
 * string, so this lookup is what makes matching possible at all.
 *
 * @param {string} key e.g. "m", "F5", "ArrowUp", "Space"
 * @param {Record<string, number>} keyTable the exported `UiohookKey` map
 * @returns {number|undefined} undefined when uiohook has no code for the key
 */
function resolveUiohookKey(key, keyTable) {
  if (!key || !keyTable) return undefined;

  const candidates = [];
  if (key.length === 1) {
    // Letters and digits are stored under their uppercased form ("M", "1").
    candidates.push(key.toUpperCase(), key.toLowerCase(), key);
  } else {
    candidates.push(key);
  }

  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(keyTable, candidate)) {
      return keyTable[candidate];
    }
  }

  // Fall back to a case-insensitive scan so "arrowup" finds "ArrowUp".
  const wanted = key.toLowerCase();
  const match = Object.keys(keyTable).find((name) => name.toLowerCase() === wanted);
  return match === undefined ? undefined : keyTable[match];
}

/**
 * Exact-match a parsed hotkey against a uiohook keydown event.
 *
 * @param {{key: string, ctrl: boolean, alt: boolean, shift: boolean, meta: boolean}} parsed
 * @param {{keycode?: number, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean}} event
 * @param {Record<string, number>} keyTable the exported `UiohookKey` map
 * @returns {boolean}
 */
function matchesUiohookHotkey(parsed, event, keyTable) {
  if (!parsed || !parsed.key || !event) return false;

  if (!!event.ctrlKey !== !!parsed.ctrl) return false;
  if (!!event.altKey !== !!parsed.alt) return false;
  if (!!event.shiftKey !== !!parsed.shift) return false;
  if (!!event.metaKey !== !!parsed.meta) return false;

  const expected = resolveUiohookKey(parsed.key, keyTable);
  return expected !== undefined && event.keycode === expected;
}

module.exports = {
  parseHotkey,
  toAccelerator,
  isSafeGlobalHotkey,
  matchesHotkey,
  matchesUiohookHotkey,
  resolveUiohookKey,
};
