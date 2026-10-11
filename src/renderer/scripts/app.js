/**
 * Kay - Main Application Bootstrap
 * Initializes all modules, wires global event listeners, manages app state
 */

import * as utils from './utils.js';
import { initSidebar } from './sidebar.js';
import { initChat } from './chat.js';
import { initSettings } from './settings.js';
import { initWindowResize, cleanupWindowResize } from './window-resize.js';

// kayAPI is exposed via contextBridge on window object by preload
const kayAPI = window.kayAPI;

// ============================================================================
// Global State
// ============================================================================

let isInitialized = false;
let cleanupFunctions = [];

// ============================================================================
// Initialization
// ============================================================================

export async function initApp() {
  if (isInitialized) return;

  try {
    console.log('[Kay] Initializing app...');

    // 1. Initialize utilities
    utils.initToasts();

    // 2. Load initial settings and apply
    await applyInitialSettings();

    // 3. Initialize modules
    window.sidebar = await initSidebar();
    window.chat = await initChat();
    window.settings = await initSettings();
    initWindowResize();

    // 4. Wire global event listeners
    wireGlobalListeners();

    // 5. Wire header buttons (theme toggle, minimize to tray)
    wireHeaderButtons();

    // 5. Set up window event listeners
    setupWindowEvents();

    // 6. Check if app should be shown (from tray/toggle)
    await checkInitialWindowState();

    // 7. Focus input
    focusInput();

    isInitialized = true;
    console.log('[Kay] App initialized successfully');

  } catch (error) {
    console.error('[Kay] Initialization failed:', error);
    utils.showToast('Failed to initialize app', 'error');
  }
}

// ============================================================================
// Settings & Theme
// ============================================================================

async function applyInitialSettings() {
  try {
    const settings = await kayAPI.settings.get();
    if (!settings) return;

    // Apply theme
    applyTheme(settings.theme || 'system');

    // Apply opacity
    if (settings.windowOpacity) {
      kayAPI.window.setOpacity(settings.windowOpacity);
    }

    // Apply always on top - both states. The old code only ever applied
    // `true`, so a stored `false` was never honoured after a restart.
    kayAPI.window.setAlwaysOnTop(settings.alwaysOnTop !== false);

  } catch (error) {
    console.error('[App] Apply settings failed:', error);
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

function wireHeaderButtons() {
  // Theme button: cycle light -> dark -> system. The settings modal radios
  // stay in sync through the settings:changed round trip. This button
  // previously had no handler at all - clicking it did nothing.
  document.getElementById('themeBtn')?.addEventListener('click', async () => {
    try {
      const settings = await kayAPI.settings.get();
      const current = settings?.theme || 'system';
      const next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
      await kayAPI.settings.set('theme', next);
      utils.showToast(next === 'system' ? 'Theme: system default' : `Theme: ${next}`, 'info');
    } catch (error) {
      console.error('[App] Theme toggle failed:', error);
    }
  });

  // Minimize button: hide to tray. Also previously dead.
  document.getElementById('minimizeBtn')?.addEventListener('click', () => {
    kayAPI.window.hide();
  });
}

// ============================================================================
// Global Event Listeners
// ============================================================================

function wireGlobalListeners() {
  // Conversation list changes
  kayAPI.onConversationListChanged(() => {
    window.sidebar?.refresh();
  });

  // Settings changes
  kayAPI.onSettingsChanged(async (settings) => {
    if (settings.theme) applyTheme(settings.theme);
    if (settings.windowOpacity !== undefined) {
      // Handled by chat module opacity slider sync
    }
    if (settings.hotkey) {
      // Handled by chat module hotkey badge update
    }
    if (settings.defaultModel) {
      // Handled by chat module
    }
    if (settings.systemPrompt) {
      // Handled by chat module
    }
  });

  // Hotkey changes
  kayAPI.onHotkeyChanged((hotkey) => {
    // Handled by chat module
  });

  // Stream events (handled by chat module)

  // Model list (handled by chat module)

  // App state changes (on/off from tray)
  kayAPI.onAppStateChanged((state) => {
    console.log('[App] State changed from tray:', state);
  });

  // Open settings from tray
  kayAPI.onOpenSettings(() => {
    window.settings?.openModal();
  });

  // Window shown/hidden
  kayAPI.onWindowShown(() => {
    focusInput();
  });

  kayAPI.onWindowHidden(() => {
    // Window hidden
  });

  // Cleanup on unload
  window.addEventListener('beforeunload', cleanup);
}

function setupWindowEvents() {
  // Handle window focus/blur for potential optimizations
  window.addEventListener('focus', () => {
    // App gained focus
  });

  window.addEventListener('blur', () => {
    // App lost focus - could pause streaming, etc.
  });

  // Handle visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // App minimized/hidden
    } else {
      // App visible again
      window.chat?.focusInput?.();
    }
  });
}

async function checkInitialWindowState() {
  try {
    const state = await kayAPI.app.getState();
    if (state.isOn) {
      // App is on, window should be visible
      // The main process already shows it, but we can ensure UI is ready
    }
  } catch (error) {
    console.error('[App] Check initial state failed:', error);
  }
}

function focusInput() {
  // Focus message input after a short delay to ensure layout is ready
  setTimeout(() => {
    const input = document.getElementById('messageInput');
    if (input && !document.hidden) {
      input.focus();
    }
  }, 100);
}

// ============================================================================
// Cleanup
// ============================================================================

function cleanup() {
  // Remove all kayAPI listeners
  kayAPI.removeAllListeners('chat:stream-chunk');
  kayAPI.removeAllListeners('chat:stream-end');
  kayAPI.removeAllListeners('chat:stream-error');
  kayAPI.removeAllListeners('chat:models');
  kayAPI.removeAllListeners('conversations:list-changed');
  kayAPI.removeAllListeners('settings:changed');
  kayAPI.removeAllListeners('hotkey:changed');
  kayAPI.removeAllListeners('window:shown');
  kayAPI.removeAllListeners('window:hidden');
  kayAPI.removeAllListeners('app:state-changed');
  kayAPI.removeAllListeners('updater:error');

  // Cleanup window resize handler
  cleanupWindowResize();

  // Run any registered cleanup functions
  cleanupFunctions.forEach(fn => {
    try { fn(); } catch (e) { console.error('[App] Cleanup error:', e); }
  });
}

export function registerCleanup(fn) {
  cleanupFunctions.push(fn);
}

// ============================================================================
// Global Error Handling
// ============================================================================

window.addEventListener('error', (event) => {
  console.error('[Kay] Uncaught error:', event.error);
  utils.showToast('An unexpected error occurred', 'error');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Kay] Unhandled rejection:', event.reason);
  utils.showToast('An unexpected error occurred', 'error');
});

// ============================================================================
// Development Helpers
// ============================================================================

// Expose modules to window for debugging. Getters, because the module
// references are assigned during the async initApp() - snapshotting them at
// module-eval time left window.kay.sidebar/chat/settings permanently
// undefined.
window.kay = {
  utils,
  get sidebar() { return window.sidebar; },
  get chat() { return window.chat; },
  get settings() { return window.settings; },
  windowResize: { init: initWindowResize, cleanup: cleanupWindowResize },
  kayAPI,
};

// ============================================================================
// Auto-initialize on load
// ============================================================================

// Initialize the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// ============================================================================
// Export
// ============================================================================

export default {
  init: initApp,
  registerCleanup,
};