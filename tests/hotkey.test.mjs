import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseHotkey,
  toAccelerator,
  isSafeGlobalHotkey,
  matchesHotkey,
  matchesUiohookHotkey,
  resolveUiohookKey,
} from '../src/main/hotkey-logic.js';

// A slice of uiohook-napi's real UiohookKey table. Kept as a fixture so the
// suite never has to load the native module (it must run in CI too).
const UiohookKey = {
  Escape: 1,
  '1': 2,
  A: 30,
  M: 50,
  Space: 57,
  Enter: 28,
  F5: 63,
  ArrowUp: 57416,
};

// ---------------------------------------------------------------------------
// parseHotkey
// ---------------------------------------------------------------------------

test('Hotkey: parses the default combo', () => {
  assert.deepEqual(parseHotkey('Ctrl+Shift+M'), {
    ctrl: true, alt: false, shift: true, meta: false, key: 'M',
  });
});

test('Hotkey: normalises modifier aliases', () => {
  assert.deepEqual(parseHotkey('Control+Option+Command+K'), {
    ctrl: true, alt: true, shift: false, meta: true, key: 'K',
  });
  assert.equal(parseHotkey('ctrl+m').ctrl, true);
  assert.equal(parseHotkey('cmd+k').meta, true);
});

test('Hotkey: tolerates whitespace and lowercased keys', () => {
  assert.deepEqual(parseHotkey(' Ctrl + Shift + m '), {
    ctrl: true, alt: false, shift: true, meta: false, key: 'm',
  });
});

test('Hotkey: keeps the space bar instead of trimming it away', () => {
  assert.equal(parseHotkey('Ctrl+ ').key, 'Space');
  assert.equal(parseHotkey('Space').key, 'Space');
});

test('Hotkey: handles missing and malformed input', () => {
  assert.deepEqual(parseHotkey(''), { ctrl: false, alt: false, shift: false, meta: false, key: '' });
  assert.deepEqual(parseHotkey(null), { ctrl: false, alt: false, shift: false, meta: false, key: '' });
  assert.deepEqual(parseHotkey(undefined), { ctrl: false, alt: false, shift: false, meta: false, key: '' });
  assert.deepEqual(parseHotkey(42), { ctrl: false, alt: false, shift: false, meta: false, key: '' });
  assert.equal(parseHotkey('Ctrl++M').key, 'M');
});

// ---------------------------------------------------------------------------
// toAccelerator
// ---------------------------------------------------------------------------

test('Hotkey: builds an Electron accelerator', () => {
  assert.equal(toAccelerator('Ctrl+Shift+M'), 'Control+Shift+M');
  assert.equal(toAccelerator('Ctrl+Alt+Delete'), 'Control+Alt+Delete');
});

test('Hotkey: translates DOM arrow names into Electron keys', () => {
  assert.equal(toAccelerator('Ctrl+ArrowUp'), 'Control+Up');
  assert.equal(toAccelerator('Alt+ArrowLeft'), 'Alt+Left');
});

test('Hotkey: spells Meta per platform', () => {
  assert.equal(toAccelerator('Meta+K', 'win32'), 'Super+K');
  assert.equal(toAccelerator('Meta+K', 'linux'), 'Super+K');
  assert.equal(toAccelerator('Meta+K', 'darwin'), 'Command+K');
});

test('Hotkey: returns empty for a hotkey with no key part', () => {
  assert.equal(toAccelerator('Ctrl+Shift'), '');
  assert.equal(toAccelerator(''), '');
});

// ---------------------------------------------------------------------------
// isSafeGlobalHotkey
// ---------------------------------------------------------------------------

test('Hotkey: a bare letter is never a safe global hotkey', () => {
  assert.equal(isSafeGlobalHotkey(parseHotkey('A')), false);
  assert.equal(isSafeGlobalHotkey(parseHotkey('m')), false);
  assert.equal(isSafeGlobalHotkey(parseHotkey('Space')), false);
  assert.equal(isSafeGlobalHotkey(parseHotkey('ArrowUp')), false);
  assert.equal(isSafeGlobalHotkey(parseHotkey('')), false);
});

test('Hotkey: modifiers and function keys are safe globally', () => {
  assert.equal(isSafeGlobalHotkey(parseHotkey('Ctrl+Shift+M')), true);
  assert.equal(isSafeGlobalHotkey(parseHotkey('Alt+Space')), true);
  assert.equal(isSafeGlobalHotkey(parseHotkey('F5')), true);
  assert.equal(isSafeGlobalHotkey(parseHotkey('F24')), true);
  assert.equal(isSafeGlobalHotkey(parseHotkey('Ctrl+A')), true);
});

// ---------------------------------------------------------------------------
// matchesHotkey (DOM-style events)
// ---------------------------------------------------------------------------

test('Hotkey: requires an exact modifier set, not just presence', () => {
  const parsed = parseHotkey('Ctrl+Shift+M');

  assert.equal(matchesHotkey(parsed, { key: 'M', ctrlKey: true, shiftKey: true }), true);
  // The event reports uppercase because Shift is held - must still match.
  assert.equal(matchesHotkey(parsed, { key: 'm', ctrlKey: true, shiftKey: true }), true);

  // Extra modifier the hotkey never asked for.
  assert.equal(matchesHotkey(parsed, { key: 'M', ctrlKey: true, shiftKey: true, altKey: true }), false);
  // Missing a required modifier.
  assert.equal(matchesHotkey(parsed, { key: 'M', ctrlKey: true }), false);
  assert.equal(matchesHotkey(parsed, { key: 'M', shiftKey: true }), false);
  // Right key, wrong letter.
  assert.equal(matchesHotkey(parsed, { key: 'K', ctrlKey: true, shiftKey: true }), false);
});

test('Hotkey: never matches without a key part', () => {
  assert.equal(matchesHotkey(parseHotkey('Ctrl+'), { key: '', ctrlKey: true }), false);
  assert.equal(matchesHotkey(parseHotkey('Ctrl+M'), null), false);
  assert.equal(matchesHotkey(parseHotkey('Ctrl+M'), undefined), false);
});

test('Hotkey: a modifier-less hotkey only fires on the bare key', () => {
  const parsed = parseHotkey('Space');
  assert.equal(matchesHotkey(parsed, { key: ' ' }), true);
  assert.equal(matchesHotkey(parsed, { key: ' ', ctrlKey: true }), false);
});

// ---------------------------------------------------------------------------
// resolveUiohookKey / matchesUiohookHotkey
// ---------------------------------------------------------------------------

test('Hotkey: resolves letters, digits and named keys to uiohook keycodes', () => {
  assert.equal(resolveUiohookKey('m', UiohookKey), UiohookKey.M);
  assert.equal(resolveUiohookKey('M', UiohookKey), UiohookKey.M);
  assert.equal(resolveUiohookKey('1', UiohookKey), UiohookKey['1']);
  assert.equal(resolveUiohookKey('F5', UiohookKey), UiohookKey.F5);
  assert.equal(resolveUiohookKey('ArrowUp', UiohookKey), UiohookKey.ArrowUp);
  assert.equal(resolveUiohookKey('Space', UiohookKey), UiohookKey.Space);
  // Case-insensitive fallback for named keys.
  assert.equal(resolveUiohookKey('arrowup', UiohookKey), UiohookKey.ArrowUp);
  assert.equal(resolveUiohookKey('escape', UiohookKey), UiohookKey.Escape);
});

test('Hotkey: returns undefined for keys uiohook does not know', () => {
  assert.equal(resolveUiohookKey('MediaPlayPause', UiohookKey), undefined);
  assert.equal(resolveUiohookKey('', UiohookKey), undefined);
  assert.equal(resolveUiohookKey('m', null), undefined);
  assert.equal(resolveUiohookKey(undefined, UiohookKey), undefined);
});

test('Hotkey: matches uiohook events by keycode with exact modifiers', () => {
  const parsed = parseHotkey('Ctrl+Shift+M');
  const keyEvent = { keycode: UiohookKey.M, ctrlKey: true, shiftKey: true };

  assert.equal(matchesUiohookHotkey(parsed, keyEvent, UiohookKey), true);

  // Extra modifier -> no match.
  assert.equal(
    matchesUiohookHotkey(parsed, { ...keyEvent, altKey: true }, UiohookKey),
    false,
  );
  // Missing modifier -> no match.
  assert.equal(
    matchesUiohookHotkey(parsed, { keycode: UiohookKey.M, ctrlKey: true }, UiohookKey),
    false,
  );
  // Right modifiers, wrong key -> no match.
  assert.equal(
    matchesUiohookHotkey(parsed, { keycode: UiohookKey.A, ctrlKey: true, shiftKey: true }, UiohookKey),
    false,
  );
  // Unresolvable key -> never matches, rather than throwing.
  assert.equal(
    matchesUiohookHotkey(parseHotkey('Ctrl+MediaPlayPause'), { keycode: 1, ctrlKey: true }, UiohookKey),
    false,
  );
});

test('Hotkey: uiohook matching never throws on malformed events', () => {
  const parsed = parseHotkey('Ctrl+Shift+M');
  assert.equal(matchesUiohookHotkey(parsed, {}, UiohookKey), false);
  assert.equal(matchesUiohookHotkey(parsed, null, UiohookKey), false);
  assert.equal(matchesUiohookHotkey(parsed, { keycode: UiohookKey.M }, null), false);
});
