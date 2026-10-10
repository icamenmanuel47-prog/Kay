/**
 * Kay - Markdown Rendering Pipeline
 * Uses marked, DOMPurify, KaTeX, and highlight.js
 */

import { $, $$ } from './utils.js';

// ============================================================================
// Configuration
// ============================================================================

// Check if libraries are loaded
const hasMarked = () => typeof marked !== 'undefined';
const hasDOMPurify = () => typeof DOMPurify !== 'undefined';
const hasKatex = () => typeof katex !== 'undefined';
const hasAutoRender = () => typeof renderMathInElement !== 'undefined';
const hasHighlight = () => typeof hljs !== 'undefined';

let markedConfigured = false;
function ensureMarkedConfigured() {
  if (markedConfigured || !hasMarked()) return;
  markedConfigured = true;

  marked.setOptions({
    gfm: true,           // GitHub Flavored Markdown
    breaks: true,        // Line breaks in paragraphs
    headerIds: false,    // Don't auto-generate header IDs
    mangle: false,       // Don't escape header IDs
    sanitize: false,     // We'll use DOMPurify instead
    smartLists: true,    // Better list handling
    smartypants: false,  // Don't convert quotes/dashes
    xhtml: false,        // HTML5 output
  });

  // Custom renderer for code blocks with language detection
  const renderer = new marked.Renderer();

  renderer.code = function ({ text, lang }) {
    const language = lang || 'plaintext';
    const validLang = hasHighlight() && hljs.getLanguage(language) ? language : 'plaintext';
    let highlighted = escapeHtml(text);
    if (hasHighlight()) {
      try {
        highlighted = hljs.highlight(text, { language: validLang, ignoreIllegals: true }).value;
      } catch {
        highlighted = escapeHtml(text);
      }
    }

    return `<pre class="language-${validLang}"><code class="language-${validLang}">${highlighted}</code></pre>`;
  };

  renderer.codespan = function ({ text }) {
    return `<code>${escapeHtml(text)}</code>`;
  };

  // Table rendering with scroll container
  renderer.table = function (token) {
    const tableHtml = marked.Renderer.prototype.table.call(this, token);
    return `<div class="table-container">${tableHtml}</div>`;
  };

  marked.use({ renderer });
}

// Configure immediately if already loaded
ensureMarkedConfigured();

/**
 * Escape HTML
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// DOMPurify Configuration
// ============================================================================

const purifyConfig = {
  // Allow KaTeX math elements
  ADD_TAGS: [
    'mjx-container', 'mjx-assistive-mml', 'mjx-math', 'mjx-mrow', 'mjx-mi', 'mjx-mo', 'mjx-mn',
    'mjx-ms', 'mjx-mtext', 'mjx-mfrac', 'mjx-msqrt', 'mjx-mroot', 'mjx-mfenced', 'mjx-mstyle',
    'mjx-merror', 'mjx-mpadded', 'mjx-mphantom', 'mjx-mspace', 'mjx-msub', 'mjx-msup', 'mjx-msubsup',
    'mjx-munder', 'mjx-mover', 'mjx-munderover', 'mjx-mmultiscripts', 'mjx-mtable', 'mjx-mtr', 'mjx-mtd',
    'annotation', 'semantics', 'svg', 'path', 'g', 'line', 'rect', 'circle', 'polyline', 'polygon',
    'katex', 'span', 'div',
  ],
  ADD_ATTR: [
    'aria-hidden', 'aria-label', 'role', 'viewBox', 'd', 'fill', 'stroke', 'stroke-width',
    'display', 'class', 'style', 'tabindex', 'xmlns', 'mathvariant', 'encoding',
  ],
  ALLOW_DATA_ATTR: true,
};

let purifyHookAdded = false;
function ensurePurifyConfigured() {
  if (purifyHookAdded || !hasDOMPurify()) return;
  purifyHookAdded = true;

  try {
    DOMPurify.addHook('uponSanitizeElement', (node, data) => {
      if (node.tagName === 'MJX-CONTAINER' && !node.textContent.trim()) {
        data.keep = false;
      }
    });
  } catch (e) {
    console.warn('[Markdown] DOMPurify hook registration failed:', e);
  }
}

// ============================================================================
// KaTeX Configuration
// ============================================================================

const KATEX_OPTIONS = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\(', right: '\\)', display: false },
    { left: '\\[', right: '\\]', display: true },
  ],
  throwOnError: false,
  errorColor: '#cc0000',
  strict: 'warn',
  output: 'html',
  trust: false,
  macros: {
    // Helpful engineering unit and notation macros
    '\\kN': '\\text{ kN}',
    '\\MPa': '\\text{ MPa}',
    '\\kPa': '\\text{ kPa}',
    '\\GPa': '\\text{ GPa}',
    '\\psi': '\\text{ psi}',
    '\\ksi': '\\text{ ksi}',
    '\\deg': '^\\circ',
  },
};

// ============================================================================
// Highlight.js Configuration
// ============================================================================

if (hasHighlight()) {
  try {
    hljs.configure({
      languages: [
        'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp',
        'go', 'rust', 'swift', 'kotlin', 'php', 'ruby', 'sql', 'html', 'css',
        'json', 'yaml', 'xml', 'markdown', 'bash', 'shell', 'dockerfile',
        'makefile', 'ini', 'toml', 'properties', 'plaintext',
      ],
      ignoreUnescapedHTML: true,
    });
  } catch {
    // Ignore configure error if minimal build
  }
}

// ============================================================================
// Math Masking & Preprocessing
// ============================================================================

/**
 * Mask math tokens before markdown parsing so underscores and asterisks are preserved
 */
function protectMath(text) {
  const mathTokens = [];

  // Protect display math: $$...$$ or \[...\]
  let processed = text.replace(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g, (match) => {
    const placeholder = `XKATEXMATHDISPLAY${mathTokens.length}X`;
    mathTokens.push({ placeholder, math: match, display: true });
    return placeholder;
  });

  // Protect inline math: $...$ or \(...\)
  // Ensure we don't match currency like $5 or $10.99
  processed = processed.replace(/(\$(?!\s)[^$\n]+(?<!\s)\$|\\\([\s\S]*?\\\))/g, (match) => {
    const placeholder = `XKATEXMATHINLINE${mathTokens.length}X`;
    mathTokens.push({ placeholder, math: match, display: false });
    return placeholder;
  });

  return { processed, mathTokens };
}

/**
 * Restore math tokens after markdown parsing and render with KaTeX if available
 */
function restoreMath(html, mathTokens) {
  let result = html;

  for (const token of mathTokens) {
    if (hasKatex()) {
      let rawMath = token.math;
      // Strip outer delimiters
      if (rawMath.startsWith('$$') && rawMath.endsWith('$$')) {
        rawMath = rawMath.slice(2, -2);
      } else if (rawMath.startsWith('\\[') && rawMath.endsWith('\\]')) {
        rawMath = rawMath.slice(2, -2);
      } else if (rawMath.startsWith('$') && rawMath.endsWith('$')) {
        rawMath = rawMath.slice(1, -1);
      } else if (rawMath.startsWith('\\(') && rawMath.endsWith('\\)')) {
        rawMath = rawMath.slice(2, -2);
      }

      try {
        const rendered = katex.renderToString(rawMath, {
          displayMode: token.display,
          throwOnError: false,
          errorColor: '#cc0000',
          macros: KATEX_OPTIONS.macros,
        });
        result = result.replace(token.placeholder, rendered);
        continue;
      } catch (err) {
        console.warn('[Markdown] KaTeX string render error:', err);
      }
    }

    // Fallback: put raw math back
    result = result.replace(token.placeholder, token.math);
  }

  return result;
}

// ============================================================================
// Main Render Function
// ============================================================================

/**
 * Render markdown text to safe HTML
 * @param {string} markdown - Markdown text
 * @returns {string} - Sanitized HTML
 */
export function renderMarkdown(markdown) {
  if (!markdown || !markdown.trim()) return '';

  ensureMarkedConfigured();

  if (!hasMarked()) {
    console.warn('[Markdown] marked.js not available');
    return escapeHtmlBasic(markdown);
  }

  try {
    // 1. Protect math formulas from markdown parser
    const { processed, mathTokens } = protectMath(markdown);

    // 2. Parse markdown
    let html = marked.parse(processed);

    // 3. Restore and render math
    html = restoreMath(html, mathTokens);

    // 4. Sanitize with DOMPurify
    if (hasDOMPurify()) {
      ensurePurifyConfigured();
      html = DOMPurify.sanitize(html, purifyConfig);
    }

    return html;
  } catch (error) {
    console.error('[Markdown] Render error:', error);
    return escapeHtmlBasic(markdown);
  }
}

/**
 * Basic HTML escape fallback
 * @param {string} text
 * @returns {string}
 */
function escapeHtmlBasic(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render markdown into an element with full processing
 * @param {string} markdown - Markdown text
 * @param {HTMLElement} container - Container element
 * @returns {Promise<void>}
 */
export async function renderMarkdownToElement(markdown, container) {
  if (!container) return;

  const html = renderMarkdown(markdown);
  container.innerHTML = html;

  // 3. Process KaTeX math
  if (hasAutoRender && hasKatex) {
    try {
      await renderMathInElement(container, KATEX_OPTIONS);
    } catch (error) {
      console.warn('[Markdown] KaTeX render error:', error);
    }
  }

  // 4. Highlight code blocks
  if (hasHighlight) {
    const codeBlocks = container.querySelectorAll('pre code');
    codeBlocks.forEach(block => {
      // Skip if already highlighted
      if (block.classList.contains('hljs')) return;

      try {
        hljs.highlightElement(block);
      } catch (error) {
        console.warn('[Markdown] Highlight error:', error);
      }
    });
  }

  // 5. Fix table scrolling
  const tables = container.querySelectorAll('.table-container');
  tables.forEach(table => {
    if (!table.parentElement.classList.contains('table-wrapper')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'table-wrapper';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
  });

  // 6. Add copy buttons to code blocks
  addCopyButtons(container);
}

/**
 * Add copy buttons to code blocks
 * @param {HTMLElement} container
 */
function addCopyButtons(container) {
  const codeBlocks = container.querySelectorAll('pre:not(.has-copy-btn)');
  codeBlocks.forEach(pre => {
    const button = document.createElement('button');
    button.className = 'code-copy-btn';
    button.setAttribute('aria-label', 'Copy code');
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    button.onclick = async () => {
      const code = pre.querySelector('code');
      if (code) {
        await navigator.clipboard.writeText(code.textContent);
        button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
        button.classList.add('copied');
        setTimeout(() => {
          button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
          button.classList.remove('copied');
        }, 2000);
      }
    };
    pre.appendChild(button);
    pre.classList.add('has-copy-btn');
  });
}

/**
 * Re-render math in an element (for streaming updates)
 * @param {HTMLElement} container
 * @returns {Promise<void>}
 */
export async function rerenderMath(container) {
  if (!hasAutoRender || !hasKatex) return;

  try {
    await renderMathInElement(container, KATEX_OPTIONS);
  } catch (error) {
    console.warn('[Markdown] KaTeX re-render error:', error);
  }
}

/**
 * Highlight code blocks in an element (for streaming updates)
 * @param {HTMLElement} container
 */
export function highlightCodeBlocks(container) {
  if (!hasHighlight) return;

  const codeBlocks = container.querySelectorAll('pre code:not(.hljs)');
  codeBlocks.forEach(block => {
    try {
      hljs.highlightElement(block);
    } catch (error) {
      console.warn('[Markdown] Highlight error:', error);
    }
  });
}

/**
 * Full re-render of markdown content in element
 * @param {HTMLElement} container
 * @returns {Promise<void>}
 */
export async function rerenderMarkdownInElement(container) {
  await rerenderMath(container);
  highlightCodeBlocks(container);
  addCopyButtons(container);
}

// ============================================================================
// Export
// ============================================================================

export default {
  renderMarkdown,
  renderMarkdownToElement,
  rerenderMath,
  highlightCodeBlocks,
  rerenderMarkdownInElement,
};