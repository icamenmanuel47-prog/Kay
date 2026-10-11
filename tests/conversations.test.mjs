/**
 * Conversations: real tests against src/main/conversations.js.
 *
 * These drive the actual ipcMain handlers and helper functions over a
 * throwaway userData directory (see helpers/electron-shim.mjs). The previous
 * suite asserted against a local MockStore and inline reimplementations of the
 * logic, so it passed no matter what the real module did.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { installElectronShim } from './helpers/electron-shim.mjs';

const nodeRequire = createRequire(import.meta.url);

const shim = installElectronShim();

// Require the real module through the shim so it picks up the temp userData
// directory, then register its real IPC handlers.
const conversations = nodeRequire('../src/main/conversations.js');
conversations.setupConversations();
const invoke = (channel, ...args) => {
  const handler = shim.ipcHandlers.get(channel);
  assert.ok(handler, `expected ${channel} to be registered`);
  return handler(null, ...args);
};

test.after(() => shim.cleanup());

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

test('Conversations: create falls back to defaults for a null model and empty title', async () => {
  const { conversation } = invoke('conversations:create', '', null);

  assert.equal(conversation.title, 'New Chat');
  // Regression: the default parameter only covered `undefined`, so the chat
  // module passing `null` stored a model-less conversation which the sidebar
  // then rendered as "unknown".
  assert.equal(conversation.model, 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assert.deepEqual(conversation.messages, []);
});

test('Conversations: create keeps an explicit title and model', async () => {
  const { conversation } = invoke('conversations:create', '  Truss analysis  ', 'openai/gpt-4o');

  assert.equal(conversation.title, 'Truss analysis');
  assert.equal(conversation.model, 'openai/gpt-4o');
});

// ---------------------------------------------------------------------------
// addMessage + auto-titling
// ---------------------------------------------------------------------------

test('Conversations: first user message auto-titles a placeholder conversation', async () => {
  const { conversation } = invoke('conversations:create');
  conversations.addMessage(conversation.id, { role: 'user', content: 'What is a shear diagram?' });

  const stored = invoke('conversations:get', conversation.id).conversation;
  assert.equal(stored.title, 'What is a shear diagram?');
  assert.equal(stored.messages.length, 1);
  assert.equal(stored.messages[0].role, 'user');
  assert.ok(stored.messages[0].timestamp, 'message should carry a timestamp');
});

test('Conversations: auto-title truncates long content', async () => {
  const { conversation } = invoke('conversations:create');
  conversations.addMessage(conversation.id, { role: 'user', content: 'x'.repeat(80) });

  const stored = invoke('conversations:get', conversation.id).conversation;
  assert.equal(stored.title, `${'x'.repeat(50)}...`);
});

test('Conversations: a title set before the first message is not clobbered', async () => {
  const { conversation } = invoke('conversations:create', 'My rename');
  conversations.addMessage(conversation.id, { role: 'user', content: 'first message' });

  const stored = invoke('conversations:get', conversation.id).conversation;
  // Regression: auto-titling used to fire on message #1 regardless of the
  // current title, overwriting a name the user had just given the thread.
  assert.equal(stored.title, 'My rename');
});

test('Conversations: only the *first* message auto-titles', async () => {
  const { conversation } = invoke('conversations:create');
  conversations.addMessage(conversation.id, { role: 'user', content: 'first' });
  conversations.addMessage(conversation.id, { role: 'assistant', content: 'answer' });
  conversations.addMessage(conversation.id, { role: 'user', content: 'second' });

  const stored = invoke('conversations:get', conversation.id).conversation;
  assert.equal(stored.title, 'first');
});

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

test('Conversations: preview reflects the newest message with content', async () => {
  const { conversation } = invoke('conversations:create');
  conversations.addMessage(conversation.id, { role: 'user', content: 'Old user question' });
  conversations.addMessage(conversation.id, { role: 'assistant', content: 'Fresh assistant answer' });

  const listed = invoke('conversations:list').conversations.find((c) => c.id === conversation.id);

  // Regression: the preview used to prefer the newest *user* message, so it
  // went stale the moment Kay replied.
  assert.equal(listed.preview, 'Fresh assistant answer');
  assert.equal(listed.messageCount, 2);
});

test('Conversations: preview truncates long content and skips blank messages', async () => {
  const { conversation } = invoke('conversations:create');
  conversations.addMessage(conversation.id, { role: 'user', content: 'short' });
  conversations.addMessage(conversation.id, { role: 'assistant', content: '   ' });
  conversations.addMessage(conversation.id, { role: 'assistant', content: 'y'.repeat(150) });

  const listed = invoke('conversations:list').conversations.find((c) => c.id === conversation.id);
  assert.ok(listed.preview.startsWith('y'.repeat(100)), 'preview should keep the first 100 chars');
  assert.ok(listed.preview.endsWith('...'), 'preview should be ellipsised');
  assert.equal(listed.preview.length, 103); // 100 chars + "..."
});

test('Conversations: empty conversation previews as "No messages yet"', async () => {
  const { conversation } = invoke('conversations:create');
  const listed = invoke('conversations:list').conversations.find((c) => c.id === conversation.id);
  assert.equal(listed.preview, 'No messages yet');
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

test('Conversations: update preserves id and createdAt and ignores unknown fields', async () => {
  const { conversation } = invoke('conversations:create', 'Original');
  const before = invoke('conversations:get', conversation.id).conversation;

  const { success, conversation: updated } = invoke('conversations:update', conversation.id, {
    title: 'Renamed',
    id: 'attacker-chosen-id',
    createdAt: '1999-01-01T00:00:00.000Z',
    someUnknownField: 'nope',
  });

  assert.equal(success, true);
  assert.equal(updated.title, 'Renamed');
  assert.equal(updated.id, before.id, 'id must not be overwritten by renderer input');
  assert.equal(updated.createdAt, before.createdAt, 'createdAt must be preserved');
  assert.equal(updated.someUnknownField, undefined, 'unknown fields must be dropped');
});

test('Conversations: update of a missing conversation reports not found', () => {
  const result = invoke('conversations:update', 'doesnotexist123', { title: 'x' });
  assert.equal(result.success, false);
  assert.equal(result.error, 'Not found');
});

// ---------------------------------------------------------------------------
// Streaming persistence helpers
// ---------------------------------------------------------------------------

test('Conversations: updateLastAssistantMessage rewrites the trailing assistant turn', async () => {
  const { conversation } = invoke('conversations:create');
  conversations.addMessage(conversation.id, { role: 'user', content: 'question' });
  conversations.addMessage(conversation.id, { role: 'assistant', content: '' });

  assert.equal(conversations.updateLastAssistantMessage(conversation.id, 'partial answer'), true);
  assert.equal(
    invoke('conversations:get', conversation.id).conversation.messages.at(-1).content,
    'partial answer'
  );
});

test('Conversations: finalizeAssistantUpdate persists and cancels the queued write', async () => {
  const { conversation } = invoke('conversations:create');
  conversations.addMessage(conversation.id, { role: 'user', content: 'question' });
  conversations.addMessage(conversation.id, { role: 'assistant', content: '' });

  // Queue an intermediate value, then finalise with the real one. The queued
  // (older) value must never land afterwards.
  conversations.scheduleAssistantUpdate(conversation.id, 'intermediate');
  assert.equal(conversations.finalizeAssistantUpdate(conversation.id, 'final text'), true);

  await new Promise((resolve) => setTimeout(resolve, 400));

  const stored = invoke('conversations:get', conversation.id).conversation;
  assert.equal(stored.messages.at(-1).content, 'final text');
});

test('Conversations: scheduleAssistantUpdate ignores empty content', async () => {
  const { conversation } = invoke('conversations:create');
  conversations.addMessage(conversation.id, { role: 'user', content: 'question' });
  conversations.addMessage(conversation.id, { role: 'assistant', content: 'real content' });

  // An empty chunk must never replace the pending content.
  conversations.scheduleAssistantUpdate(conversation.id, '');
  conversations.finalizeAssistantUpdate(conversation.id, '');

  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(
    invoke('conversations:get', conversation.id).conversation.messages.at(-1).content,
    'real content'
  );
});

test('Conversations: cancelPendingAssistantUpdate discards the queued write', async () => {
  const { conversation } = invoke('conversations:create');
  conversations.addMessage(conversation.id, { role: 'user', content: 'question' });
  conversations.addMessage(conversation.id, { role: 'assistant', content: 'kept' });

  conversations.scheduleAssistantUpdate(conversation.id, 'should not be written');
  assert.equal(conversations.cancelPendingAssistantUpdate(conversation.id), true);

  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(
    invoke('conversations:get', conversation.id).conversation.messages.at(-1).content,
    'kept'
  );
});

test('Conversations: flushPendingAssistantUpdates writes queued content on shutdown', async () => {
  const { conversation } = invoke('conversations:create');
  conversations.addMessage(conversation.id, { role: 'user', content: 'question' });
  conversations.addMessage(conversation.id, { role: 'assistant', content: '' });

  conversations.scheduleAssistantUpdate(conversation.id, 'last flushed words');
  conversations.flushPendingAssistantUpdates();

  assert.equal(
    invoke('conversations:get', conversation.id).conversation.messages.at(-1).content,
    'last flushed words'
  );
});

// ---------------------------------------------------------------------------
// removeLastEmptyMessage
// ---------------------------------------------------------------------------

test('Conversations: removeLastEmptyMessage drops a trailing empty assistant turn only', async () => {
  const { conversation } = invoke('conversations:create');
  conversations.addMessage(conversation.id, { role: 'user', content: 'hello' });
  conversations.addMessage(conversation.id, { role: 'assistant', content: '' });

  assert.equal(conversations.removeLastEmptyMessage(conversation.id), true);
  const after = invoke('conversations:get', conversation.id).conversation;
  assert.equal(after.messages.length, 1);
  assert.equal(after.messages[0].role, 'user');

  // Nothing left to remove.
  assert.equal(conversations.removeLastEmptyMessage(conversation.id), false);
});

test('Conversations: removeLastEmptyMessage leaves a populated assistant turn alone', async () => {
  const { conversation } = invoke('conversations:create');
  conversations.addMessage(conversation.id, { role: 'user', content: 'hello' });
  conversations.addMessage(conversation.id, { role: 'assistant', content: 'hi there' });

  assert.equal(conversations.removeLastEmptyMessage(conversation.id), false);
  assert.equal(invoke('conversations:get', conversation.id).conversation.messages.length, 2);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('Conversations: a traversal id never reaches the filesystem', async () => {
  const evil = '../../escaped';

  for (const channel of ['conversations:get', 'conversations:update', 'conversations:delete']) {
    const result = invoke(channel, evil, { title: 'x' });
    assert.equal(result.error, 'Invalid conversation id', `${channel} must reject ${evil}`);
  }

  // And nothing was written outside the conversations directory.
  const parent = path.dirname(conversations.CONVERSATIONS_DIR);
  assert.equal(fs.existsSync(path.join(parent, 'escaped.json')), false);
});

test('Conversations: list survives a corrupt JSON file', async () => {
  fs.writeFileSync(path.join(conversations.CONVERSATIONS_DIR, 'corrupt.json'), '{ not json');

  const { conversations: listed } = invoke('conversations:list');
  assert.ok(Array.isArray(listed), 'list must still return an array');
  assert.equal(listed.some((c) => c.id === 'corrupt.json'), false);

  fs.rmSync(path.join(conversations.CONVERSATIONS_DIR, 'corrupt.json'), { force: true });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

test('Conversations: search matches titles and message bodies', async () => {
  const a = invoke('conversations:create', 'Seismic design').conversation;
  conversations.addMessage(a.id, { role: 'user', content: 'base isolation' });

  const b = invoke('conversations:create', 'Unrelated').conversation;
  conversations.addMessage(b.id, { role: 'user', content: 'nothing here' });

  const byTitle = invoke('conversations:search', 'seismic').conversations;
  assert.deepEqual(byTitle.map((c) => c.id), [a.id]);

  const byBody = invoke('conversations:search', 'ISOLATION').conversations;
  assert.deepEqual(byBody.map((c) => c.id), [a.id], 'search must be case-insensitive');
});

test('Conversations: an empty search returns nothing rather than everything', () => {
  assert.deepEqual(invoke('conversations:search', '').conversations, []);
  assert.deepEqual(invoke('conversations:search', '   ').conversations, []);
});
