/**
 * Settings: real tests against src/main/settings.js.
 *
 * Loads the actual module through the Electron shim (see
 * helpers/electron-shim.mjs) against a throwaway userData directory. The
 * previous suite asserted against a hand-written `defaultSettings` object that
 * did not match the real defaults at all, plus two inline reimplementations of
 * validation logic the module does not contain.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { installElectronShim } from './helpers/electron-shim.mjs';

const nodeRequire = createRequire(import.meta.url);

const shim = installElectronShim();
const settings = nodeRequire('../src/main/settings.js');

test.after(() => shim.cleanup());

const settingsFile = () => path.join(shim.userData, 'kay-settings.json');
const readStore = () => JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

test('Settings: defaults are applied for keys the store has never seen', async () => {
  const loaded = await settings.loadSettings();

  assert.equal(loaded.hotkey, 'Ctrl+Shift+M');
  assert.equal(loaded.theme, 'system');
  assert.equal(loaded.windowOpacity, 0.95);
  assert.equal(loaded.defaultModel, 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assert.equal(loaded.showNotifications, true);
  assert.equal(loaded.maxConversationHistory, 100);
  assert.equal(loaded.isOn, false);
  assert.deepEqual(loaded.favoriteModels, []);
});

test('Settings: getSetting reads values and falls back to undefined', () => {
  assert.equal(settings.getSetting('theme'), 'system');
  assert.equal(settings.getSetting('definitely-not-a-key'), undefined);
});

// ---------------------------------------------------------------------------
// API key handling
// ---------------------------------------------------------------------------

test('Settings: the API key is stored encrypted, not as plaintext', () => {
  const plaintext = 'sk-or-v1-abc123';

  settings.setApiKey(plaintext);
  const stored = readStore();

  assert.notEqual(stored.apiKey, plaintext, 'key must not be written to disk in the clear');
  assert.equal(stored.apiKey, Buffer.from(plaintext, 'utf8').toString('base64'));
  // Main keeps the decrypted value in memory for the request path.
  assert.equal(settings.getApiKey(), plaintext);
});

test('Settings: getSettingsForRenderer never exposes the real key', async () => {
  settings.setApiKey('sk-or-v1-abc123');
  await settings.loadSettings();

  const forRenderer = settings.getSettingsForRenderer();

  assert.equal(forRenderer.hasApiKey, true);
  assert.equal(forRenderer.apiKey, '***');
  assert.ok(!JSON.stringify(forRenderer).includes('sk-or-v1-abc123'),
    'no part of the renderer payload may contain the key');
  // Regression: the settings dialog showed a hardcoded wrong version.
  assert.equal(forRenderer.version, '0.0.0-test');
});

test('Settings: hasApiKey is false and apiKey null when unset', async () => {
  settings.deleteApiKey();
  await settings.loadSettings();

  const forRenderer = settings.getSettingsForRenderer();
  assert.equal(forRenderer.hasApiKey, false);
  assert.equal(forRenderer.apiKey, null);
  assert.equal(settings.getApiKey(), null);
});

test('Settings: setSetting("apiKey") routes through encryption too', () => {
  settings.setSetting('apiKey', 'sk-direct-999');

  assert.equal(readStore().apiKey, Buffer.from('sk-direct-999', 'utf8').toString('base64'));
  assert.equal(settings.getApiKey(), 'sk-direct-999');
});

// ---------------------------------------------------------------------------
// Change notifications
// ---------------------------------------------------------------------------

test('Settings: the first change in a burst is announced immediately', async () => {
  // Earlier tests write settings; let any in-flight coalescing window close
  // so this one starts from a clean timer.
  await new Promise((resolve) => setTimeout(resolve, 150));

  const seen = [];
  const unsubscribe = settings.onSettingsChanged((change) => seen.push(change.key));

  settings.setSetting('theme', 'dark');

  assert.deepEqual(seen, ['theme']);
  unsubscribe();
});

test('Settings: onSettingsChanged returns a working unsubscribe', async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));

  const seen = [];
  const unsubscribe = settings.onSettingsChanged((change) => seen.push(change.key));

  settings.setSetting('theme', 'light');
  unsubscribe();
  settings.setSetting('theme', 'system');

  assert.deepEqual(seen, ['theme']);
});

test('Settings: notifications collapse a burst into one trailing event', async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));

  const seen = [];
  const unsubscribe = settings.onSettingsChanged((change) => seen.push(change.key));

  // Three writes inside the notify window: one immediate, one trailing.
  settings.setSetting('windowOpacity', 0.9);
  settings.setSetting('windowOpacity', 0.8);
  settings.setSetting('alwaysOnTop', false);

  assert.equal(seen.length, 1, 'only the first should fire synchronously');

  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(seen.length, 2, 'the rest of the burst coalesces into one');
  unsubscribe();
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

test('Settings: resetSettings clears the key and restores defaults', async () => {
  settings.setApiKey('sk-to-be-wiped');
  settings.setSetting('theme', 'dark');

  const reset = await settings.resetSettings();

  assert.equal(reset.theme, 'system', 'theme should be back to the default');
  assert.equal(settings.getApiKey(), null, 'in-memory key should be cleared');
  // A clear() restores the default schema, where apiKey is null.
  assert.equal(readStore().apiKey, null, 'stored key should be back to the default');
});

// ---------------------------------------------------------------------------
// Hotkey
// ---------------------------------------------------------------------------

test('Settings: setHotkey persists and getHotkey reads it back', () => {
  settings.setHotkey('Ctrl+Alt+K');

  assert.equal(settings.getHotkey(), 'Ctrl+Alt+K');
  assert.equal(readStore().hotkey, 'Ctrl+Alt+K');
});

test('Settings: a reset restores the default hotkey', async () => {
  settings.setHotkey('Ctrl+Alt+K');
  await settings.resetSettings();

  assert.equal(settings.getHotkey(), 'Ctrl+Shift+M');
});
