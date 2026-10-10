import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Preload: exposes complete kayAPI interface required by renderer', () => {
  const preloadCode = fs.readFileSync('D:/AI-Projects/Kay/src/preload/index.js', 'utf-8');

  // Check window methods
  const windowMethods = ['minimize', 'close', 'hide', 'toggleAlwaysOnTop', 'setOpacity', 'getBounds', 'setBounds', 'isAlwaysOnTop'];
  for (const m of windowMethods) {
    assert.ok(preloadCode.includes(`${m}:`), `kayAPI.window missing method: ${m}`);
  }

  // Check settings methods
  const settingsMethods = ['get', 'set', 'getApiKey', 'setApiKey', 'deleteApiKey', 'getHotkey', 'setHotkey', 'encryptionAvailable', 'isEncryptionAvailable'];
  for (const m of settingsMethods) {
    assert.ok(preloadCode.includes(`${m}:`), `kayAPI.settings missing method: ${m}`);
  }

  // Check conversations methods
  const convMethods = ['list', 'get', 'create', 'update', 'delete', 'export', 'search'];
  for (const m of convMethods) {
    assert.ok(preloadCode.includes(`${m}:`), `kayAPI.conversations missing method: ${m}`);
  }

  // Check chat methods
  const chatMethods = ['sendMessage', 'streamMessage', 'cancelStream', 'getModels', 'setFavoriteModel'];
  for (const m of chatMethods) {
    assert.ok(preloadCode.includes(`${m}:`), `kayAPI.chat missing method: ${m}`);
  }

  // Check app methods
  const appMethods = ['toggleOnOff', 'getState', 'checkUpdates', 'quit', 'openExternal', 'openDataFolder', 'resetAllData', 'setLaunchAtStartup', 'getLaunchAtStartup'];
  for (const m of appMethods) {
    assert.ok(preloadCode.includes(`${m}:`), `kayAPI.app missing method: ${m}`);
  }

  // Check event listeners
  const listenerMethods = [
    'onStreamChunk', 'onStreamEnd', 'onStreamError', 'onModelList',
    'onSettingsChanged', 'onHotkeyChanged', 'onConversationListChanged',
    'onOpenSettings', 'onAppStateChanged', 'onWindowShown', 'onWindowHidden', 'onUpdaterEvent',
    'removeAllListeners',
  ];
  for (const m of listenerMethods) {
    assert.ok(preloadCode.includes(`${m}:`), `kayAPI missing event listener: ${m}`);
  }
});

