import test from 'node:test';
import assert from 'node:assert/strict';

// Load vendor dependencies into global scope as in the browser
import katex from 'katex';
import { marked } from 'marked';
import hljs from 'highlight.js';

// Setup browser globals
global.window = {};
global.document = {
  createElement: () => ({ textContent: '', innerHTML: '' }),
  querySelectorAll: () => [],
};
global.marked = marked;
global.katex = katex;
global.hljs = hljs;
global.DOMPurify = {
  sanitize: (html) => {
    // Basic test sanitizer stripping <script> and onerror
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/\s*onerror\s*=\s*["'][^"']*["']/gi, '');
  },
  addHook: () => {},
};

// Import our markdown rendering module
const { renderMarkdown } = await import('../src/renderer/scripts/markdown.js');

test('Markdown: basic text and paragraphs', () => {
  const result = renderMarkdown('Hello world, this is a test.');
  assert.match(result, /<p>Hello world, this is a test\.<\/p>/);
});

test('Markdown: headers and lists', () => {
  const input = '# Heading 1\n\n- Item 1\n- Item 2';
  const result = renderMarkdown(input);
  assert.match(result, /<h1>Heading 1<\/h1>/);
  assert.match(result, /<ul>\s*<li>Item 1<\/li>\s*<li>Item 2<\/li>\s*<\/ul>/);
});

test('Markdown: code block syntax highlighting', () => {
  const input = '```javascript\nconst x = 42;\n```';
  const result = renderMarkdown(input);
  assert.match(result, /<pre class="language-javascript"><code class="language-javascript">/);
  assert.match(result, /hljs-number/);
});

test('Markdown: tables', () => {
  const input = '| Column 1 | Column 2 |\n|---|---|\n| Value 1 | Value 2 |';
  const result = renderMarkdown(input);
  assert.match(result, /<div class="table-container"><table>/);
  assert.match(result, /<th>Column 1<\/th>/);
  assert.match(result, /<td>Value 1<\/td>/);
});

test('LaTeX: inline math with subscripts and symbols', () => {
  const input = 'The stress is $\\sigma_{max} = \\frac{M \\cdot c}{I}$ in the beam.';
  const result = renderMarkdown(input);
  // Must render via KaTeX
  assert.match(result, /katex/);
  // Must NOT convert _max into <em>max</em>
  assert.doesNotMatch(result, /<em>max<\/em>/);
  assert.match(result, /sigma/);
});

test('LaTeX: display math with fractions and Greek letters', () => {
  const input = '$$\\tau = \\frac{V \\cdot Q}{I \\cdot b}$$';
  const result = renderMarkdown(input);
  assert.match(result, /katex-display/);
  assert.match(result, /tau/);
});

test('LaTeX: bracket notation \\[ ... \\] and \\( ... \\)', () => {
  const input = 'Formula: \\[ E = mc^2 \\] and \\( a^2 + b^2 = c^2 \\)';
  const result = renderMarkdown(input);
  assert.match(result, /katex-display/);
  assert.match(result, /katex/);
});

test('Security: XSS prevention with DOMPurify', () => {
  const malicious = '<script>alert("xss")</script><img src="x" onerror="alert(1)">';
  const result = renderMarkdown(malicious);
  assert.doesNotMatch(result, /<script>/);
  assert.doesNotMatch(result, /onerror/);
});

