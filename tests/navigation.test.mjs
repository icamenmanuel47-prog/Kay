import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import { classifyNavigation } from '../src/main/navigation.js';

// A stand-in for the renderer bundle that index.js passes as allowedDir.
const ALLOWED_DIR = path.join(os.tmpdir(), 'kay-renderer');

const asFileUrl = (...segments) => pathToFileURL(path.join(...segments)).href;

test('Navigation: http(s) is blocked in-page but handed to the OS browser', () => {
  for (const url of ['http://example.com', 'https://example.com/a?b=c']) {
    assert.deepEqual(classifyNavigation(url), {
      preventNavigation: true,
      openExternal: url,
    });
  }
});

test('Navigation: javascript: and data: are blocked and never forwarded to the OS', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,<h1>hi</h1>',
    'ms-settings:',
    'app://internal/page',
    'smb://host/share',
  ]) {
    assert.deepEqual(classifyNavigation(url), {
      preventNavigation: true,
      openExternal: null,
    });
  }
});

test('Navigation: malformed URLs are denied instead of throwing', () => {
  // The old implementation called `new URL(url)` unguarded, so a bad URL
  // raised inside the will-navigate listener.
  assert.doesNotThrow(() => classifyNavigation('not a url'));
  assert.deepEqual(classifyNavigation('not a url'), {
    preventNavigation: true,
    openExternal: null,
  });
  assert.deepEqual(classifyNavigation('http://'), {
    preventNavigation: true,
    openExternal: null,
  });
});

test('Navigation: non-string input is denied', () => {
  for (const value of [null, undefined, 42, {}, [], true, '', Symbol('x'), 0n]) {
    assert.deepEqual(classifyNavigation(value), {
      preventNavigation: true,
      openExternal: null,
    });
  }
});

test('Navigation: local files inside the renderer bundle may load', () => {
  const url = asFileUrl(ALLOWED_DIR, 'index.html');
  assert.deepEqual(classifyNavigation(url, { allowedDir: ALLOWED_DIR }), {
    preventNavigation: false,
    openExternal: null,
  });
});

test('Navigation: local files outside the renderer bundle are blocked', () => {
  const allowedDir = ALLOWED_DIR;
  const outside = [
    path.join(os.tmpdir(), 'not-the-renderer', 'index.html'), // sibling dir
    path.join(ALLOWED_DIR, '..', 'secret.txt'), // climb out
    path.join(os.homedir(), 'sensitive.txt'), // somewhere else entirely
  ];

  for (const target of outside) {
    const result = classifyNavigation(asFileUrl(target), { allowedDir });
    assert.equal(result.preventNavigation, true, `should block ${target}`);
    assert.equal(result.openExternal, null);
  }
});

test('Navigation: file: URLs need an allowedDir to be trusted at all', () => {
  const url = asFileUrl(ALLOWED_DIR, 'index.html');
  assert.deepEqual(classifyNavigation(url), {
    preventNavigation: true,
    openExternal: null,
  });
  assert.deepEqual(classifyNavigation(url, { allowedDir: '' }), {
    preventNavigation: true,
    openExternal: null,
  });
  assert.deepEqual(classifyNavigation(url, { allowedDir: null }), {
    preventNavigation: true,
    openExternal: null,
  });
});
