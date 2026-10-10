import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererDir = path.join(ROOT, 'src', 'renderer');
const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');

const cspTag = html.match(
  /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i,
);
const csp = cspTag?.[0]?.match(/content="([^"]*)"/i)?.[1];

/** The value of one directive, e.g. `"'self'"` for `script-src`. */
const directive = (name) =>
  (csp?.match(new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`, 'i'))?.[1] ?? '')
    .trim()
    .toLowerCase();

test('Security: index.html declares a Content-Security-Policy', () => {
  assert.ok(cspTag, 'missing <meta http-equiv="Content-Security-Policy">');
  assert.ok(csp, 'CSP tag has no content attribute');
});

test('Security: CSP is deny-by-default with no script relaxation', () => {
  assert.equal(directive('default-src'), "'none'");
  assert.equal(directive('script-src'), "'self'");
  assert.doesNotMatch(
    directive('script-src'),
    /unsafe-inline|unsafe-eval|https?:|data:|\*/,
    'script-src must stay exactly \'self\'',
  );
  // Local fonts and pasted/attached images still have to work.
  assert.match(directive('img-src'), /data:/);
  assert.equal(directive('font-src'), "'self'");
  assert.equal(directive('object-src'), "'none'");
  assert.equal(directive('base-uri'), "'none'");
});

test('Security: no renderer resource is loaded from the network', () => {
  // Everything (marked, purify, katex, highlight) is shipped under vendor/,
  // so the app keeps working offline and a compromised CDN cannot inject code.
  const remoteLoads = [
    ...html.matchAll(/<(?:script|link|img|iframe)\b[^>]*?\b(?:src|href)="(https?:\/\/[^"]*)"/gi),
  ].map((match) => match[1]);

  assert.deepEqual(
    remoteLoads,
    [],
    `remote resources found: ${remoteLoads.join(', ')}`,
  );
});

test('Security: highlight.js is vendored, not pulled from cdnjs', () => {
  const vendored = path.join(rendererDir, 'vendor', 'highlight.min.js');
  assert.ok(
    fs.existsSync(vendored),
    'src/renderer/vendor/highlight.min.js is missing',
  );
  assert.match(
    html,
    /<script src="vendor\/highlight\.min\.js"><\/script>/,
    'index.html should load the local copy',
  );
  assert.doesNotMatch(html, /cdnjs\.cloudflare\.com/);
});

test('Security: renderer ships no inline <script> or <style> blocks', () => {
  // Inline content is what forces 'unsafe-inline' into script-src; keeping it
  // empty is what lets the CSP above stay strict.
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc\s*=)[^>]*>/i);
  assert.doesNotMatch(html, /<style[\s>]/i);
});

test('Security: stylesheets reference no remote url() resources', () => {
  // main.css previously @font-face'd Inter straight from fonts.gstatic.com.
  // data: URIs are fine (inline SVG), anything http(s) is not.
  const stylesDir = path.join(rendererDir, 'styles');
  const offenders = [];

  for (const file of fs.readdirSync(stylesDir).filter((name) => name.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(stylesDir, file), 'utf8');
    for (const match of css.matchAll(/url\(\s*['"]?(https?:\/\/[^'")\s]+)/g)) {
      offenders.push(`${file}: ${match[1]}`);
    }
  }

  assert.deepEqual(offenders, [], `remote CSS resources: ${offenders.join(', ')}`);
});
