const { contextBridge, ipcRenderer } = require('electron');

// Channels this bridge is allowed to subscribe to / detach. Anything else is
// refused: without a list, removeAllListeners() and onUpdaterEvent() were
// open-ended primitives over every channel in the app.
const LISTENER_CHANNELS = new Set([
  'chat:stream-chunk',
  'chat:stream-end',
  'chat:stream-error',
  'chat:models',
  'settings:changed',
  'hotkey:changed',
  'conversations:list-changed',
  'open-settings',
  'app:state-changed',
  'window:shown',
  'window:hidden',
  'updater:checking',
  'updater:available',
  'updater:not-available',
  'updater:error',
  'updater:progress',
  'updater:downloaded',
]);

const UPDATER_EVENTS = new Set([
  'checking',
  'available',
  'not-available',
  'error',
  'progress',
  'downloaded',
]);

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('kayAPI', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),
    hide: () => ipcRenderer.invoke('window:hide'),
    toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-always-on-top'),
    setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:set-always-on-top', flag),
    setOpacity: (opacity) => ipcRenderer.invoke('window:set-opacity', opacity),
    getBounds: () => ipcRenderer.invoke('window:get-bounds'),
    setBounds: (bounds) => ipcRenderer.invoke('window:set-bounds', bounds),
    isAlwaysOnTop: () => ipcRenderer.invoke('window:is-always-on-top'),
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    setApiKey: (key) => ipcRenderer.invoke('settings:set-api-key', key),
    deleteApiKey: () => ipcRenderer.invoke('settings:delete-api-key'),
    getHotkey: () => ipcRenderer.invoke('settings:get-hotkey'),
    setHotkey: (hotkey) => ipcRenderer.invoke('settings:set-hotkey', hotkey),
    encryptionAvailable: () => ipcRenderer.invoke('settings:encryption-available').then(r => r?.available ?? false),
    isEncryptionAvailable: () => ipcRenderer.invoke('settings:encryption-available').then(r => r?.available ?? false),
  },

  // Conversations
  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    get: (id) => ipcRenderer.invoke('conversations:get', id),
    create: (title, model) => ipcRenderer.invoke('conversations:create', title, model),
    update: (id, data) => ipcRenderer.invoke('conversations:update', id, data),
    delete: (id) => ipcRenderer.invoke('conversations:delete', id),
    export: (id) => ipcRenderer.invoke('conversations:export', id),
    search: (query) => ipcRenderer.invoke('conversations:search', query),
  },

  // Chat / OpenRouter
  chat: {
    streamMessage: (conversationId, message, images, model, systemPrompt) =>
      ipcRenderer.send('chat:stream', conversationId, message, images, model, systemPrompt),
    cancelStream: () => ipcRenderer.invoke('chat:cancel-stream'),
    getModels: () => ipcRenderer.invoke('chat:get-models'),
    setFavoriteModel: (modelId, isFavorite) =>
      ipcRenderer.invoke('chat:set-favorite-model', modelId, isFavorite),
  },

  // Tray / App state
  app: {
    toggleOnOff: () => ipcRenderer.invoke('app:toggle-on-off'),
    getState: () => ipcRenderer.invoke('app:get-state'),
    checkUpdates: (manual) => ipcRenderer.invoke('app:check-updates', manual),
    quit: () => ipcRenderer.invoke('app:quit'),
    openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
    openDataFolder: () => ipcRenderer.invoke('app:open-data-folder'),
    resetAllData: () => ipcRenderer.invoke('app:reset-all-data'),
    setLaunchAtStartup: (enabled) => ipcRenderer.invoke('app:set-launch-at-startup', enabled),
    getLaunchAtStartup: () => ipcRenderer.invoke('app:get-launch-at-startup'),
  },

  // Events from main process
  onStreamChunk: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('chat:stream-chunk', handler);
    return () => ipcRenderer.removeListener('chat:stream-chunk', handler);
  },
  onStreamEnd: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('chat:stream-end', handler);
    return () => ipcRenderer.removeListener('chat:stream-end', handler);
  },
  onStreamError: (callback) => {
    const handler = (_, error, conversationId) => callback(error, conversationId);
    ipcRenderer.on('chat:stream-error', handler);
    return () => ipcRenderer.removeListener('chat:stream-error', handler);
  },
  onModelList: (callback) => {
    const handler = (_, models) => callback(models);
    ipcRenderer.on('chat:models', handler);
    return () => ipcRenderer.removeListener('chat:models', handler);
  },
  onSettingsChanged: (callback) => {
    const handler = (_, settings) => callback(settings);
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },
  onHotkeyChanged: (callback) => {
    const handler = (_, hotkey) => callback(hotkey);
    ipcRenderer.on('hotkey:changed', handler);
    return () => ipcRenderer.removeListener('hotkey:changed', handler);
  },
  onConversationListChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('conversations:list-changed', handler);
    return () => ipcRenderer.removeListener('conversations:list-changed', handler);
  },
  onOpenSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('open-settings', handler);
    return () => ipcRenderer.removeListener('open-settings', handler);
  },
  onAppStateChanged: (callback) => {
    const handler = (_, state) => callback(state);
    ipcRenderer.on('app:state-changed', handler);
    return () => ipcRenderer.removeListener('app:state-changed', handler);
  },
  onWindowShown: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('window:shown', handler);
    return () => ipcRenderer.removeListener('window:shown', handler);
  },
  onWindowHidden: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('window:hidden', handler);
    return () => ipcRenderer.removeListener('window:hidden', handler);
  },
  onUpdaterEvent: (event, callback) => {
    // The channel is derived from a caller-supplied string, so restrict it to
    // the events main actually emits - otherwise this is a general-purpose
    // subscribe-to-any-channel primitive handed to the page.
    if (!UPDATER_EVENTS.has(event)) {
      console.warn(`[Preload] Ignoring subscription to unknown updater event: ${String(event).slice(0, 40)}`);
      return () => {};
    }
    const channel = `updater:${event}`;
    const handler = (_, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // Remove listeners - restricted to the channels this bridge owns, so the
  // page cannot detach handlers it was never given.
  removeAllListeners: (channel) => {
    if (LISTENER_CHANNELS.has(channel)) {
      ipcRenderer.removeAllListeners(channel);
    } else {
      console.warn(`[Preload] Ignoring removeAllListeners for unknown channel: ${String(channel).slice(0, 40)}`);
    }
  },
});