import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidConversationId,
  pickUpdatableFields,
} from '../src/main/conversation-fields.js';

// Mirrors src/main/conversations.js generateId().
const generatedId = () =>
  Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

test('Conversation fields: accepts the ids the app itself generates', () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(isValidConversationId(generatedId()), true);
  }
  assert.equal(isValidConversationId('conv_abc123'), true);
  assert.equal(isValidConversationId('a'), true);
  assert.equal(isValidConversationId('x'.repeat(64)), true);
});

test('Conversation fields: rejects anything that could escape the directory', () => {
  // These ids reach path.join(CONVERSATIONS_DIR, `${id}.json`) from IPC.
  const bad = [
    '../outside',
    '..',
    'a/b',
    'a\\b',
    '/absolute/path',
    'C:\\Windows\\system32\\evil',
    'id with spaces',
    'id.json',
    '',
    'x'.repeat(65),
    null,
    undefined,
    42,
    {},
    ['id'],
    Symbol('id'),
  ];

  for (const value of bad) {
    assert.equal(
      isValidConversationId(value),
      false,
      `should reject ${String(value)}`,
    );
  }
});

test('Conversation fields: only whitelisted, correctly-typed fields survive', () => {
  assert.deepEqual(
    pickUpdatableFields({ title: 'New title', model: 'some/model' }),
    { title: 'New title', model: 'some/model' },
  );
  assert.deepEqual(
    pickUpdatableFields({ messages: [{ role: 'user', content: 'hi' }] }),
    { messages: [{ role: 'user', content: 'hi' }] },
  );
});

test('Conversation fields: drops metadata the renderer must not write', () => {
  const parsed = pickUpdatableFields({
    title: 'ok',
    // Previously spread straight over the stored conversation.
    id: '../../evil',
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
    apiKey: 'secret',
    extraArbitrary: true,
  });

  assert.deepEqual(Object.keys(parsed), ['title']);
  assert.equal('id' in parsed, false);
  assert.equal('createdAt' in parsed, false);
  assert.equal('apiKey' in parsed, false);
});

test('Conversation fields: wrongly-typed values are dropped, not rejected', () => {
  // One bad field should not prevent the good ones from applying.
  assert.deepEqual(
    pickUpdatableFields({ title: 42, model: 'good/model' }),
    { model: 'good/model' },
  );
  assert.deepEqual(pickUpdatableFields({ messages: 'not-an-array' }), {});
  assert.deepEqual(pickUpdatableFields({ title: null }), {});
  assert.deepEqual(pickUpdatableFields({ title: undefined }), {});
  assert.deepEqual(pickUpdatableFields({ model: {} }), {});
});

test('Conversation fields: non-object input yields an empty update', () => {
  for (const value of [null, undefined, 'title', 7, [], true, Symbol('x')]) {
    assert.deepEqual(pickUpdatableFields(value), {});
  }
});

test('Conversation fields: inherited properties are never picked up', () => {
  Object.prototype.title = 'polluted';
  try {
    assert.deepEqual(pickUpdatableFields({ model: 'm' }), { model: 'm' });
    assert.deepEqual(pickUpdatableFields({}), {});
  } finally {
    delete Object.prototype.title;
  }

  // A JSON payload can legitimately carry an own "__proto__" key; it must be
  // treated as an unknown field rather than spread onto the prototype.
  const fromJson = JSON.parse('{"__proto__": {"polluted": true}, "title": "t"}');
  assert.deepEqual(pickUpdatableFields(fromJson), { title: 't' });
  assert.equal({}.polluted, undefined);
});
