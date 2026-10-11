/**
 * Kay - Settings Module
 * Handles settings modal: tabs, forms, API key, hotkey recorder, theme, opacity
 */

import { $, $$, createElement, clearElement, parseHotkey, showToast, debounce } from './utils.js';

// kayAPI is exposed via contextBridge on window object by preload
const kayAPI = window.kayAPI;

// ============================================================================
// State
// ============================================================================

let isHotkeyRecording = false;
let currentSettings = null;
let defaultSystemPrompt = `You are a tutor for a civil engineering student, with deep expertise in Structural Theory (statics, determinacy, internal forces, shear and moment diagrams, trusses, frames, deflections, influence lines, indeterminate structures) and related engineering subjects. For every problem: (1) list the given data and state all assumptions, including sign conventions and support conditions, (2) name the relevant principles and formulas, (3) solve step by step, showing every substitution with units, (4) check equilibrium, units, and the reasonableness of the result, (5) state the final answer clearly. If the problem is ambiguous, the diagram is unclear, or you are not sure, say so instead of guessing. Use LaTeX for all math.`;

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
  modal: null,
  modalContent: null,
  closeBtn: null,
  saveBtn: null,
  tabs: {},
  panels: {},
  // General
  hotkeyInput: null,
  recordHotkeyBtn: null,
  currentHotkeyDisplay: null,
  launchAtStartup: null,
  showNotifications: null,
  // API
  apiKeyInput: null,
  toggleApiKeyVisibility: null,
  saveApiKeyBtn: null,
  deleteApiKeyBtn: null,
  apiKeyStatus: null,
  defaultModelSelect: null,
  systemPromptInput: null,
  resetSystemPromptBtn: null,
  // Appearance
  themeRadios: null,
  settingsOpacitySlider: null,
  settingsOpacityValue: null,
  alwaysOnTop: null,
  // Advanced
  checkUpdatesBtn: null,
  currentVersion: null,
  openDataFolderBtn: null,
  resetAllDataBtn: null,
  encryptionStatus: null,
};

// ============================================================================
// Initialization
// ============================================================================

export async function initSettings() {
  cacheElements();
  bindEvents();
  await loadSettings();

  // Return public API for window attachment
  return {
    openModal,
    closeModal,
    isOpen,
  };
}

function cacheElements() {
  elements.modal = $('#settingsModal');
  elements.modalContent = $('#settingsModalContent');
  elements.openBtn = $('#settingsBtn');
  elements.closeBtn = $('#closeSettingsBtn');
  elements.saveBtn = $('#saveSettingsBtn');

  // Tabs
  elements.tabs = {
    general: $('[data-tab="general"]'),
    api: $('[data-tab="api"]'),
    appearance: $('[data-tab="appearance"]'),
    advanced: $('[data-tab="advanced"]'),
  };

  elements.panels = {
    general: $('#tab-general'),
    api: $('#tab-api'),
    appearance: $('#tab-appearance'),
    advanced: $('#tab-advanced'),
  };

  // General
  elements.hotkeyInput = $('#hotkeyInput');
  elements.recordHotkeyBtn = $('#recordHotkeyBtn');
  elements.currentHotkeyDisplay = $('#currentHotkeyDisplay');
  elements.launchAtStartup = $('#launchAtStartup');
  elements.showNotifications = $('#showNotifications');

  // API
  elements.apiKeyInput = $('#apiKeyInput');
  elements.toggleApiKeyVisibility = $('#toggleApiKeyVisibility');
  elements.saveApiKeyBtn = $('#saveApiKeyBtn');
  elements.deleteApiKeyBtn = $('#deleteApiKeyBtn');
  elements.apiKeyStatus = $('#apiKeyStatus');
  elements.defaultModelSelect = $('#defaultModelSelect');
  elements.systemPromptInput = $('#systemPromptInput');
  elements.resetSystemPromptBtn = $('#resetSystemPromptBtn');

  // Appearance
  elements.themeRadios = $$('input[name="theme"]');
  elements.settingsOpacitySlider = $('#settingsOpacitySlider');
  elements.settingsOpacityValue = $('#settingsOpacityValue');
  elements.alwaysOnTop = $('#alwaysOnTop');

  // Advanced
  elements.checkUpdatesBtn = $('#checkUpdatesBtn');
  elements.currentVersion = $('#currentVersion');
  elements.openDataFolderBtn = $('#openDataFolderBtn');
  elements.resetAllDataBtn = $('#resetAllDataBtn');
  elements.encryptionStatus = $('#encryptionStatus');
}

function bindEvents() {
  // Modal open/close
  elements.openBtn?.addEventListener('click', openModal);
  elements.closeBtn?.addEventListener('click', closeModal);
  elements.saveBtn?.addEventListener('click', saveAndClose);
  elements.modal?.addEventListener('click', (e) => {
    if (e.target === elements.modal) closeModal();
  });

  // Tab switching
  Object.entries(elements.tabs).forEach(([key, tab]) => {
    tab?.addEventListener('click', () => switchTab(key));
  });

  // General: Hotkey recording
  elements.recordHotkeyBtn?.addEventListener('click', toggleHotkeyRecording);
  elements.hotkeyInput?.addEventListener('keydown', handleHotkeyKeydown);
  elements.hotkeyInput?.addEventListener('blur', () => {
    if (isHotkeyRecording) stopHotkeyRecording();
  });

  // General: Launch at startup
  elements.launchAtStartup?.addEventListener('change', (e) => {
    kayAPI.app.setLaunchAtStartup(e.target.checked);
  });

  // General: Notifications (this toggle had no listener at all - it was read
  // on load and never persisted, and nothing consumed the setting either)
  elements.showNotifications?.addEventListener('change', (e) => {
    if (currentSettings) currentSettings.showNotifications = e.target.checked;
    kayAPI.settings.set('showNotifications', e.target.checked);
  });

  // API: API Key visibility toggle
  elements.toggleApiKeyVisibility?.addEventListener('click', toggleApiKeyVisibility);

  // API: Save/Delete API key
  elements.saveApiKeyBtn?.addEventListener('click', saveApiKey);
  elements.deleteApiKeyBtn?.addEventListener('click', deleteApiKey);

  // API: Default model select
  elements.defaultModelSelect?.addEventListener('change', (e) => {
    kayAPI.settings.set('defaultModel', e.target.value);
  });

  // API: System prompt - persist edits as they are typed. There was no
  // listener here at all, so a user-edited prompt was silently discarded;
  // only "Reset to Default" ever reached disk.
  elements.systemPromptInput?.addEventListener('input', debounce(saveSystemPrompt, 600));
  elements.resetSystemPromptBtn?.addEventListener('click', resetSystemPrompt);

  // Appearance: Theme
  elements.themeRadios?.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        kayAPI.settings.set('theme', e.target.value);
      }
    });
  });

  // Appearance: Opacity
  elements.settingsOpacitySlider?.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    elements.settingsOpacityValue.textContent = `${value}%`;
    kayAPI.window.setOpacity(value / 100);
    kayAPI.settings.set('windowOpacity', value / 100);
  });

  // Appearance: Always on top - set to the checkbox's value. Toggling used to
  // invert whatever the window happened to be, so a single desync made the
  // checkbox and the real state disagree permanently.
  elements.alwaysOnTop?.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    kayAPI.window.setAlwaysOnTop(enabled).then(result => {
      if (currentSettings) currentSettings.alwaysOnTop = result.alwaysOnTop;
    }).catch((error) => {
      console.error('[Settings] Always on top failed:', error);
      e.target.checked = !enabled; // revert the visual state
    });
  });

  // Advanced: Updates
  elements.checkUpdatesBtn?.addEventListener('click', async () => {
    showToast('Checking for updates...', 'info');
    try {
      const result = await kayAPI.app.checkUpdates(true);
      if (!result?.success) {
        showToast(result?.error || 'Update check failed', 'error');
      } else if (result.updateAvailable) {
        showToast(`Update available: ${result.version}`, 'success');
      } else {
        showToast('Kay is up to date', 'success');
      }
    } catch (error) {
      showToast('Update check failed', 'error');
    }
  });

  // Advanced: Data management
  elements.openDataFolderBtn?.addEventListener('click', openDataFolder);
  elements.resetAllDataBtn?.addEventListener('click', resetAllData);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.modal?.classList.contains('visible')) {
      closeModal();
    }
  });
}

// ============================================================================
// Modal Control
// ============================================================================

export function openModal() {
  elements.modal?.classList.add('visible');
  elements.modalContent?.focus();
  loadSettings(); // Refresh on open
}

export function closeModal() {
  elements.modal?.classList.remove('visible');
  stopHotkeyRecording();
}

function saveAndClose() {
  // Other settings save in real time; flush any pending prompt edit (the
  // debounce may not have fired yet) before the modal goes away.
  saveSystemPrompt();
  closeModal();
}

function switchTab(tabName) {
  // Update tabs
  Object.entries(elements.tabs).forEach(([key, tab]) => {
    tab?.classList.toggle('active', key === tabName);
  });

  // Update panels
  Object.entries(elements.panels).forEach(([key, panel]) => {
    panel?.classList.toggle('active', key === tabName);
  });
}

// ============================================================================
// Settings Loading
// ============================================================================

async function loadSettings() {
  try {
    const result = await kayAPI.settings.get();
    if (!result) return;

    currentSettings = result;

    // Update hotkey display
    updateHotkeyDisplay(result.hotkey);

    // General
    elements.launchAtStartup.checked = result.launchAtStartup || false;
    elements.showNotifications.checked = result.showNotifications !== false;

    // API
    elements.apiKeyInput.value = result.hasApiKey ? '••••••••••••••••' : '';
    updateApiKeyStatus(result.hasApiKey);
    populateModelSelect(result.defaultModel);

    // System prompt
    elements.systemPromptInput.value = result.systemPrompt || defaultSystemPrompt;

    // Appearance
    setThemeRadio(result.theme || 'system');
    elements.alwaysOnTop.checked = result.alwaysOnTop !== false;

    // Advanced
    elements.currentVersion.textContent = result.version || 'dev';

    // Encryption status
    const encryptionAvailable = await kayAPI.settings.encryptionAvailable();
    updateEncryptionStatus(encryptionAvailable);

  } catch (error) {
    console.error('[Settings] Load failed:', error);
    showToast('Failed to load settings', 'error');
  }
}

function updateHotkeyDisplay(hotkey) {
  elements.currentHotkeyDisplay.textContent = hotkey;
  elements.hotkeyInput.value = hotkey;
}

function updateApiKeyStatus(hasKey) {
  if (hasKey) {
    elements.apiKeyStatus.textContent = 'API key is set';
    elements.apiKeyStatus.className = 'setting-status success';
  } else {
    elements.apiKeyStatus.textContent = 'No API key set';
    elements.apiKeyStatus.className = 'setting-status';
  }
}

function populateModelSelect(selectedModel) {
  if (!elements.defaultModelSelect) return;

  // The dropdown had no <option>s at all - it was permanently empty and its
  // change listener could never fire. Populate it from the same model list
  // the chat picker uses.
  kayAPI.chat.getModels().then(result => {
    const models = result?.models || [];
    if (models.length === 0) return; // keep whatever is currently selected

    const previous = selectedModel || elements.defaultModelSelect.value;
    clearElement(elements.defaultModelSelect);

    [...models]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(model => {
        const option = createElement('option', { value: model.id },
          `${model.name}${model.isFree ? ' (free)' : ''}`);
        elements.defaultModelSelect.appendChild(option);
      });

    if (previous) elements.defaultModelSelect.value = previous;
  }).catch(error => {
    console.error('[Settings] Model list unavailable:', error);
  });
}

function setThemeRadio(theme) {
  elements.themeRadios?.forEach(radio => {
    radio.checked = radio.value === theme;
  });
}

function updateEncryptionStatus(available) {
  if (elements.encryptionStatus) {
    if (available) {
      elements.encryptionStatus.textContent = '✓ Encryption available (Windows DPAPI) - API key is securely encrypted';
      elements.encryptionStatus.className = 'setting-status success';
    } else {
      elements.encryptionStatus.textContent = '⚠ Encryption not available - API key will be stored in plain text';
      elements.encryptionStatus.className = 'setting-status warning';
    }
  }
}

// ============================================================================
// Hotkey Recording
// ============================================================================

function toggleHotkeyRecording() {
  if (isHotkeyRecording) {
    stopHotkeyRecording();
  } else {
    startHotkeyRecording();
  }
}

function startHotkeyRecording() {
  isHotkeyRecording = true;
  elements.hotkeyInput.value = 'Press keys...';
  elements.hotkeyInput.classList.add('recording');
  elements.recordHotkeyBtn.textContent = 'Cancel';
  elements.hotkeyInput.focus();

  // Listen for keydown globally
  document.addEventListener('keydown', handleGlobalHotkey);
}

function stopHotkeyRecording() {
  isHotkeyRecording = false;
  elements.hotkeyInput.classList.remove('recording');
  elements.recordHotkeyBtn.textContent = 'Record';

  if (currentSettings?.hotkey) {
    elements.hotkeyInput.value = currentSettings.hotkey;
  }

  document.removeEventListener('keydown', handleGlobalHotkey);
}

function handleGlobalHotkey(event) {
  if (!isHotkeyRecording) return;

  // A bare letter can never be a *global* hotkey - the main process would fire
  // it every time that key is pressed in any application - so keep recording
  // instead of submitting it. Function keys are the modifier-less exception.
  const hasModifier = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
  const isFunctionKey = /^f([1-9]|1[0-9]|2[0-4])$/i.test(event.key);
  if (!hasModifier && !isFunctionKey) return;

  const hotkey = parseHotkey(event);
  if (hotkey && hotkey !== 'Ctrl' && hotkey !== 'Alt' && hotkey !== 'Shift' && hotkey !== 'Meta') {
    event.preventDefault();
    elements.hotkeyInput.value = hotkey;
    applyHotkey(hotkey);
    stopHotkeyRecording();
  }
}

/**
 * Turn a failure reason from the main process into something worth showing.
 */
function describeHotkeyFailure(reason) {
  switch (reason) {
    case 'unsafe':
      return 'Hotkeys need a modifier key (Ctrl, Alt, Shift) or a function key';
    case 'unsupported-key':
      return "That key can't be used as a global hotkey";
    case 'in-use':
      return 'Hotkey may be in use by another app';
    case 'invalid':
      return 'Invalid hotkey';
    default:
      return 'Failed to set hotkey';
  }
}

function handleHotkeyKeydown(event) {
  if (!isHotkeyRecording) return;

  // Allow Escape to cancel
  if (event.key === 'Escape') {
    event.preventDefault();
    stopHotkeyRecording();
    return;
  }

  // Prevent default for modifier keys during recording
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
    event.preventDefault();
  }
}

async function applyHotkey(hotkey) {
  try {
    const result = await kayAPI.settings.setHotkey(hotkey);
    if (result.success) {
      currentSettings.hotkey = hotkey;
      updateHotkeyDisplay(hotkey);
      showToast('Hotkey updated', 'success');
    } else {
      showToast(describeHotkeyFailure(result.reason), 'error');
      // Revert
      elements.hotkeyInput.value = currentSettings.hotkey;
    }
  } catch (error) {
    console.error('[Settings] Hotkey apply failed:', error);
    showToast('Failed to set hotkey', 'error');
  }
}

// ============================================================================
// API Key Handling
// ============================================================================

let apiKeyVisible = false;

function toggleApiKeyVisibility() {
  apiKeyVisible = !apiKeyVisible;
  elements.apiKeyInput.type = apiKeyVisible ? 'text' : 'password';

  const eyeIcon = elements.toggleApiKeyVisibility.querySelector('.eye-icon');
  const eyeOffIcon = elements.toggleApiKeyVisibility.querySelector('.eye-off-icon');

  if (eyeIcon) eyeIcon.style.display = apiKeyVisible ? 'none' : 'block';
  if (eyeOffIcon) eyeOffIcon.style.display = apiKeyVisible ? 'block' : 'none';
}

async function saveApiKey() {
  const key = elements.apiKeyInput.value.trim();

  if (key === '••••••••••••••••' || key === '') {
    showToast('Enter a valid API key', 'warning');
    return;
  }

  try {
    const result = await kayAPI.settings.setApiKey(key);
    if (result.success) {
      showToast('API key saved', 'success');
      elements.apiKeyInput.value = '••••••••••••••••';
      updateApiKeyStatus(true);
      apiKeyVisible = false;
      elements.apiKeyInput.type = 'password';
      // Reload models with new key
      kayAPI.chat.getModels();
    } else {
      showToast('Failed to save API key', 'error');
    }
  } catch (error) {
    console.error('[Settings] Save API key failed:', error);
    showToast('Failed to save API key', 'error');
  }
}

async function deleteApiKey() {
  if (!confirm('Delete your API key?')) return;

  try {
    const result = await kayAPI.settings.deleteApiKey();
    if (result.success) {
      showToast('API key deleted', 'success');
      elements.apiKeyInput.value = '';
      updateApiKeyStatus(false);
    }
  } catch (error) {
    console.error('[Settings] Delete API key failed:', error);
    showToast('Failed to delete API key', 'error');
  }
}

let systemPromptSaveTimer = null;

function saveSystemPrompt() {
  if (systemPromptSaveTimer) {
    clearTimeout(systemPromptSaveTimer);
    systemPromptSaveTimer = null;
  }
  if (!elements.systemPromptInput || !currentSettings) return;

  const value = elements.systemPromptInput.value;
  if (value === (currentSettings.systemPrompt || defaultSystemPrompt)) return;

  currentSettings.systemPrompt = value;
  kayAPI.settings.set('systemPrompt', value);
}

function resetSystemPrompt() {
  if (!confirm('Reset system prompt to default?')) return;

  if (systemPromptSaveTimer) {
    clearTimeout(systemPromptSaveTimer);
    systemPromptSaveTimer = null;
  }
  elements.systemPromptInput.value = defaultSystemPrompt;
  if (currentSettings) currentSettings.systemPrompt = defaultSystemPrompt;
  kayAPI.settings.set('systemPrompt', defaultSystemPrompt);
  showToast('System prompt reset', 'success');
}

// ============================================================================
// Advanced Actions
// ============================================================================

async function openDataFolder() {
  try {
    const result = await kayAPI.app.openDataFolder();
    if (!result.success) {
      showToast('Failed to open data folder', 'error');
    }
  } catch (error) {
    console.error('[Settings] Open data folder failed:', error);
    showToast('Failed to open data folder', 'error');
  }
}

async function resetAllData() {
  if (!confirm('This will delete ALL conversations, settings, and API key. This cannot be undone. Continue?')) return;

  if (!confirm('Are you absolutely sure?')) return;

  try {
    const result = await kayAPI.app.resetAllData();
    if (result.success) {
      showToast('All data has been reset. Restart the app.', 'success');
      // Close modal and quit app
      closeModal();
      setTimeout(() => kayAPI.app.quit(), 1000);
    } else {
      showToast(result.error || 'Failed to reset data', 'error');
    }
  } catch (error) {
    console.error('[Settings] Reset failed:', error);
    showToast('Failed to reset data', 'error');
  }
}

// ============================================================================
// Public API
// ============================================================================

export function isOpen() {
  return elements.modal?.classList.contains('visible') || false;
}

export default {
  init: initSettings,
  openModal,
  closeModal,
  isOpen,
};