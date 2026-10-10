const Store = require('electron-store');
const { safeStorage, app } = require('electron');
const path = require('path');

const DEFAULT_SETTINGS = {
  // App state
  isOn: false,
  hotkey: 'Ctrl+Shift+M',

  // Window
  windowBounds: null,
  windowOpacity: 0.95,
  theme: 'system', // 'light', 'dark', 'system'
  alwaysOnTop: true,

  // OpenRouter
  apiKey: null, // encrypted
  defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  favoriteModels: [],

  // System prompt
  systemPrompt: `You are a tutor for a civil engineering student, with deep expertise in Structural Theory (statics, determinacy, internal forces, shear and moment diagrams, trusses, frames, deflections, influence lines, indeterminate structures) and related engineering subjects. For every problem: (1) list the given data and state all assumptions, including sign conventions and support conditions, (2) name the relevant principles and formulas, (3) solve step by step, showing every substitution with units, (4) check equilibrium, units, and the reasonableness of the result, (5) state the final answer clearly. If the problem is ambiguous, the diagram is unclear, or you are not sure, say so instead of guessing. Use LaTeX for all math.`,

  // Behavior
  launchAtStartup: false,
  checkUpdatesOnStartup: true,
  showNotifications: true,

  // Advanced
  maxConversationHistory: 100,
  streamResponses: true,
};

// Store configuration
const store = new Store({
  name: 'kay-settings',
  defaults: DEFAULT_SETTINGS,
  encryptionKey: null, // We'll handle encryption manually for API key
  watch: true,
});

// In-memory cache for decrypted API key
let decryptedApiKey = null;

/**
 * Encrypt a string using Electron's safeStorage (DPAPI on Windows)
 */
function encryptString(str) {
  if (!str) return null;
  try {
    return safeStorage.encryptString(str).toString('base64');
  } catch (error) {
    console.error('Encryption failed:', error);
    return null;
  }
}

/**
 * Decrypt a string using Electron's safeStorage
 */
function decryptString(encrypted) {
  if (!encrypted) return null;
  try {
    const buffer = Buffer.from(encrypted, 'base64');
    return safeStorage.decryptString(buffer);
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
}

/**
 * Load settings from store
 */
async function loadSettings() {
  const settings = store.store;
  // Decrypt API key if present
  if (settings.apiKey) {
    decryptedApiKey = decryptString(settings.apiKey);
  }
  return settings;
}

/**
 * Save settings to store
 */
function saveSettings() {
  store.save();
}

/**
 * Get all settings (with decrypted API key)
 */
function getSettings() {
  const settings = { ...store.store };
  if (settings.apiKey) {
    settings.apiKey = decryptedApiKey;
  }
  return settings;
}

/**
 * Get a specific setting
 */
function getSetting(key) {
  if (key === 'apiKey') {
    return decryptedApiKey;
  }
  return store.get(key);
}

/**
 * Set a specific setting
 */
function setSetting(key, value) {
  if (key === 'apiKey') {
    const encrypted = encryptString(value);
    store.set('apiKey', encrypted);
    decryptedApiKey = value;
  } else {
    store.set(key, value);
  }
  return true;
}

/**
 * Get the decrypted API key
 */
function getApiKey() {
  return decryptedApiKey;
}

/**
 * Set the API key (encrypts it)
 */
function setApiKey(key) {
  const encrypted = encryptString(key);
  store.set('apiKey', encrypted);
  decryptedApiKey = key;
  return true;
}

/**
 * Delete the API key
 */
function deleteApiKey() {
  store.delete('apiKey');
  decryptedApiKey = null;
  return true;
}

/**
 * Get the current hotkey
 */
function getHotkey() {
  return store.get('hotkey') || 'Ctrl+Shift+M';
}

/**
 * Set the hotkey
 */
function setHotkey(hotkey) {
  store.set('hotkey', hotkey);
  return true;
}

/**
 * Check if safeStorage is available
 */
function isEncryptionAvailable() {
  return safeStorage.isEncryptionAvailable();
}

/**
 * Reset all settings to defaults
 */
function resetSettings() {
  store.clear();
  decryptedApiKey = null;
  return loadSettings();
}

module.exports = {
  loadSettings,
  saveSettings,
  getSettings,
  getSetting,
  setSetting,
  getApiKey,
  setApiKey,
  deleteApiKey,
  getHotkey,
  setHotkey,
  isEncryptionAvailable,
  resetSettings,
  encryptString,
  decryptString,
  DEFAULT_SETTINGS,
};