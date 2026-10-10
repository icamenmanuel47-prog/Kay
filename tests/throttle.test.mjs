import test from 'node:test';
import assert from 'node:assert/strict';

import { createTrailingThrottle } from '../src/main/throttle.js';

const WAIT = 300;

/** Enable mocked timers for the duration of a test. */
function mockTimers(t) {
  // clearTimeout is mocked automatically alongside setTimeout.
  t.mock.timers.enable({ apis: ['setTimeout'] });
}

test('Throttle: does not run before the interval elapses', (t) => {
  mockTimers(t);
  const calls = [];
  const throttled = createTrailingThrottle((v) => calls.push(v), WAIT);

  throttled.invoke('a');
  t.mock.timers.tick(WAIT - 1);
  assert.deepEqual(calls, []);

  t.mock.timers.tick(1);
  assert.deepEqual(calls, ['a']);
});

test('Throttle: collapses bursts into one call with the latest arguments', (t) => {
  mockTimers(t);
  const calls = [];
  const throttled = createTrailingThrottle((v) => calls.push(v), WAIT);

  // Stand-in for a stream: one invoke per token, 50 x 3ms = 150ms elapsed,
  // deliberately still inside the 300ms window.
  for (let i = 0; i < 50; i++) {
    throttled.invoke(`chunk-${i}`);
    t.mock.timers.tick(3);
  }

  assert.equal(calls.length, 0, 'nothing should run while calls keep arriving');
  t.mock.timers.tick(WAIT);
  assert.deepEqual(calls, ['chunk-49'], 'only the newest value should be written');
});

test('Throttle: flush writes immediately and stops the pending timer', (t) => {
  mockTimers(t);
  const calls = [];
  const throttled = createTrailingThrottle((v) => calls.push(v), WAIT);

  throttled.invoke('a');
  assert.equal(throttled.pending, true);

  assert.equal(throttled.flush(), true);
  assert.deepEqual(calls, ['a']);
  assert.equal(throttled.pending, false);

  // A stale timer firing later must not write a second time.
  t.mock.timers.tick(WAIT * 2);
  assert.deepEqual(calls, ['a']);
});

test('Throttle: flush is a no-op when nothing is pending', (t) => {
  mockTimers(t);
  const calls = [];
  const throttled = createTrailingThrottle((v) => calls.push(v), WAIT);

  assert.equal(throttled.flush(), false);
  assert.deepEqual(calls, []);

  throttled.invoke('a');
  throttled.flush();
  assert.equal(throttled.flush(), false);
  assert.deepEqual(calls, ['a']);
});

test('Throttle: cancel drops the pending call entirely', (t) => {
  mockTimers(t);
  const calls = [];
  const throttled = createTrailingThrottle((v) => calls.push(v), WAIT);

  throttled.invoke('stale');
  assert.equal(throttled.cancel(), true);

  t.mock.timers.tick(WAIT * 5);
  assert.deepEqual(calls, [], 'cancelled content must never be written');

  assert.equal(throttled.cancel(), false);
});

test('Throttle: re-arms after each run', (t) => {
  mockTimers(t);
  const calls = [];
  const throttled = createTrailingThrottle((v) => calls.push(v), WAIT);

  throttled.invoke('one');
  t.mock.timers.tick(WAIT);
  assert.deepEqual(calls, ['one']);

  throttled.invoke('two');
  t.mock.timers.tick(WAIT);
  assert.deepEqual(calls, ['one', 'two']);
});

test('Throttle: flush after cancel writes nothing', (t) => {
  mockTimers(t);
  const calls = [];
  const throttled = createTrailingThrottle((v) => calls.push(v), WAIT);

  throttled.invoke('dropped');
  throttled.cancel();
  assert.equal(throttled.flush(), false);

  t.mock.timers.tick(WAIT);
  assert.deepEqual(calls, []);
});

test('Throttle: passes through all arguments', (t) => {
  mockTimers(t);
  const calls = [];
  const throttled = createTrailingThrottle((...args) => calls.push(args), WAIT);

  throttled.invoke('a', 'b');
  throttled.invoke(1, 2, 3);
  t.mock.timers.tick(WAIT);

  assert.deepEqual(calls, [[1, 2, 3]]);
});

test('Throttle: rejects invalid configuration', () => {
  assert.throws(() => createTrailingThrottle(null, WAIT), TypeError);
  assert.throws(() => createTrailingThrottle(() => {}, -1), TypeError);
  assert.throws(() => createTrailingThrottle(() => {}, NaN), TypeError);
  assert.throws(() => createTrailingThrottle(() => {}, '300'), TypeError);
});
