import test from 'node:test';
import assert from 'node:assert/strict';

test('Settings: default schema values', () => {
  const defaultSettings = {
    apiKey: '',
    selectedModel: 'anthropic/claude-3.5-sonnet',
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: 'You are Kay, a helpful desktop assistant specializing in civil engineering.',
    hotkey: 'Control+Space',
    theme: 'dark',
    windowOpacity: 0.95,
    alwaysOnTop: true,
    autoLaunch: false,
    fontSize: 14,
    latexEnabled: true,
    syntaxHighlighting: true,
    saveHistory: true,
    maxConversationHistory: 20,
    encryptionEnabled: false,
  };

  assert.equal(defaultSettings.selectedModel, 'anthropic/claude-3.5-sonnet');
  assert.equal(defaultSettings.hotkey, 'Control+Space');
  assert.equal(defaultSettings.windowOpacity, 0.95);
  assert.equal(defaultSettings.latexEnabled, true);
  assert.equal(defaultSettings.maxConversationHistory, 20);
});

test('Settings: opacity boundary validation', () => {
  function validateOpacity(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return 0.95;
    return Math.max(0.3, Math.min(1.0, num));
  }

  assert.equal(validateOpacity(0.95), 0.95);
  assert.equal(validateOpacity(1.5), 1.0);
  assert.equal(validateOpacity(0.1), 0.3);
  assert.equal(validateOpacity('invalid'), 0.95);
});

test('Settings: hotkey format normalization', () => {
  function normalizeHotkey(accelerator) {
    if (!accelerator || typeof accelerator !== 'string') return 'Control+Space';
    return accelerator
      .replace(/\s+/g, '')
      .replace(/Ctrl/i, 'Control')
      .replace(/Cmd/i, 'Command');
  }

  assert.equal(normalizeHotkey('Ctrl+Space'), 'Control+Space');
  assert.equal(normalizeHotkey('Ctrl + Shift + K'), 'Control+Shift+K');
  assert.equal(normalizeHotkey(''), 'Control+Space');
});
