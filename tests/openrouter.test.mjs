/**
 * OpenRouter: real tests against src/main/openrouter.js.
 *
 * buildRequestWithHistory() and validateStreamArgs() are pure - they decide
 * exactly what leaves the machine - so they are exported and tested directly.
 * The previous suite copied their logic into the test file and asserted on the
 * copy, which could never catch a change in the real module (and in fact
 * asserted behaviour the real module does not have).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installElectronShim } from './helpers/electron-shim.mjs';

const nodeRequire = createRequire(import.meta.url);

const shim = installElectronShim();
const openrouter = nodeRequire('../src/main/openrouter.js');
const settings = nodeRequire('../src/main/settings.js');

test.after(() => shim.cleanup());

const { buildRequestWithHistory, validateStreamArgs } = openrouter;

// ---------------------------------------------------------------------------
// buildRequestWithHistory
// ---------------------------------------------------------------------------

test('OpenRouter: system prompt is emitted as a system message', () => {
  const body = buildRequestWithHistory([], 'hello', [], 'some/model', 'You are Kay.', true);

  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[0].content, 'You are Kay.');
  assert.equal(body.stream, true);
});

test('OpenRouter: no system prompt means no system message', () => {
  const body = buildRequestWithHistory([], 'hello', [], 'some/model', '', true);
  assert.equal(body.messages.some((m) => m.role === 'system'), false);
});

test('OpenRouter: text-only history stays as plain strings', () => {
  const history = [
    { role: 'user', content: 'Question one' },
    { role: 'assistant', content: 'Answer one' },
  ];

  const body = buildRequestWithHistory(history, 'Question two', [], 'some/model', '', true);

  assert.deepEqual(body.messages, [
    { role: 'user', content: 'Question one' },
    { role: 'assistant', content: 'Answer one' },
    { role: 'user', content: 'Question two' },
  ]);
});

test('OpenRouter: a message with images becomes multimodal content parts', () => {
  const history = [
    { role: 'user', content: 'See this', images: ['data:image/png;base64,AAA'] },
  ];

  const body = buildRequestWithHistory(history, 'and this', ['data:image/png;base64,BBB'], 'some/model', '', true);

  assert.deepEqual(body.messages[0], {
    role: 'user',
    content: [
      { type: 'text', text: 'See this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ],
  });

  assert.deepEqual(body.messages[1], {
    role: 'user',
    content: [
      { type: 'text', text: 'and this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,BBB' } },
    ],
  });
});

test('OpenRouter: an image-only message omits the text part', () => {
  const history = [
    { role: 'user', content: '', images: ['data:image/png;base64,CCC'] },
  ];

  const body = buildRequestWithHistory(history, 'next', [], 'some/model', '', true);

  assert.deepEqual(body.messages[0].content, [
    { type: 'image_url', image_url: { url: 'data:image/png;base64,CCC' } },
  ]);
});

test('OpenRouter: empty history entries are skipped', () => {
  const history = [
    { role: 'user', content: '' },
    { role: 'assistant', content: '' },
    { role: 'user', content: 'kept' },
  ];

  const body = buildRequestWithHistory(history, 'now', [], 'some/model', '', true);

  assert.deepEqual(body.messages.map((m) => m.content), ['kept', 'now']);
});

test('OpenRouter: unknown roles are ignored', () => {
  const history = [
    { role: 'system', content: 'injected' },
    { role: 'tool', content: 'not supported' },
    { role: 'user', content: 'kept' },
  ];

  const body = buildRequestWithHistory(history, 'now', [], 'some/model', '', true);
  assert.deepEqual(body.messages.map((m) => m.role), ['user', 'user']);
});

test('OpenRouter: a missing model falls back to the stored default', async () => {
  await settings.loadSettings();

  const body = buildRequestWithHistory([], 'hello', [], '', '', true);
  assert.equal(body.model, 'nvidia/nemotron-3-ultra-550b-a55b:free');

  const explicit = buildRequestWithHistory([], 'hello', [], 'openai/gpt-4o', '', true);
  assert.equal(explicit.model, 'openai/gpt-4o');
});

test('OpenRouter: request shape carries temperature and max_tokens', () => {
  const body = buildRequestWithHistory([], 'hello', [], 'some/model', '', false);
  assert.equal(body.temperature, 0.7);
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.stream, false);
});

// ---------------------------------------------------------------------------
// validateStreamArgs
// ---------------------------------------------------------------------------

const VALID_ID = 'conv_abc123';

test('Stream validation: accepts a well-formed request', () => {
  assert.equal(
    validateStreamArgs(VALID_ID, 'hello', ['data:image/png;base64,AAA'], 'some/model'),
    null
  );
  // Images and model are optional.
  assert.equal(validateStreamArgs(VALID_ID, 'hello', null, null), null);
  assert.equal(validateStreamArgs(VALID_ID, 'hello', undefined, undefined), null);
});

test('Stream validation: rejects a missing or malformed conversation id', () => {
  for (const id of [null, undefined, '', 42, '../../etc/passwd', 'conv/../../x']) {
    assert.equal(validateStreamArgs(id, 'hello', [], 'm'), 'Invalid conversation id',
      `should reject id ${JSON.stringify(id)}`);
  }
});

test('Stream validation: rejects an empty or non-string message', () => {
  assert.equal(validateStreamArgs(VALID_ID, '', [], 'm'), 'Message is empty');
  assert.equal(validateStreamArgs(VALID_ID, '   ', [], 'm'), 'Message is empty');
  assert.equal(validateStreamArgs(VALID_ID, null, [], 'm'), 'Message is empty');
  assert.equal(validateStreamArgs(VALID_ID, { text: 'hi' }, [], 'm'), 'Message is empty');
});

test('Stream validation: rejects an over-long message', () => {
  const huge = 'x'.repeat(100001);
  assert.equal(validateStreamArgs(VALID_ID, huge, [], 'm'), 'Message is too long');
  assert.equal(validateStreamArgs(VALID_ID, 'x'.repeat(100000), [], 'm'), null, 'exactly at the limit');
});

test('Stream validation: images must be an array of embedded data URLs', () => {
  assert.equal(validateStreamArgs(VALID_ID, 'hi', 'not-an-array', 'm'), 'Images must be an array');
  assert.equal(validateStreamArgs(VALID_ID, 'hi', ['https://evil.example/x.png'], 'm'),
    'Images must be embedded data URLs');
  assert.equal(validateStreamArgs(VALID_ID, 'hi', ['data:text/html,<script>'], 'm'),
    'Images must be embedded data URLs');
  assert.equal(validateStreamArgs(VALID_ID, 'hi', [123], 'm'), 'Images must be embedded data URLs');
});

test('Stream validation: caps the number of images', () => {
  const six = Array.from({ length: 6 }, () => 'data:image/png;base64,AA');
  const seven = [...six, 'data:image/png;base64,AA'];

  assert.equal(validateStreamArgs(VALID_ID, 'hi', six, 'm'), null);
  assert.equal(validateStreamArgs(VALID_ID, 'hi', seven, 'm'), 'At most 6 images are supported');
});

test('Stream validation: rejects a malformed model value', () => {
  assert.equal(validateStreamArgs(VALID_ID, 'hi', [], 42), 'Invalid model');
  assert.equal(validateStreamArgs(VALID_ID, 'hi', [], { id: 'x' }), 'Invalid model');
  assert.equal(validateStreamArgs(VALID_ID, 'hi', [], 'm'.repeat(201)), 'Invalid model');
});
