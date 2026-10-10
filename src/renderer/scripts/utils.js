/**
 * Kay - Utility Functions
 * Common helpers used across all renderer modules
 */

// ============================================================================
// DOM Helpers
// ============================================================================

/**
 * Single element query selector
 * @param {string} selector - CSS selector
 * @param {Element} [context=document] - Root element
 * @returns {Element|null}
 */
export function $(selector, context = document) {
  return context.querySelector(selector);
}

/**
 * Multiple element query selector
 * @param {string} selector - CSS selector
 * @param {Element} [context=document] - Root element
 * @returns {NodeList}
 */
export function $$(selector, context = document) {
  return context.querySelectorAll(selector);
}

/**
 * Create an element with attributes and children
 * @param {string} tag - HTML tag name
 * @param {Object} [props={}] - Properties/attributes to set
 * @param {...(string|Node)} children - Child nodes or text content
 * @returns {HTMLElement}
 */
export function createElement(tag, props = {}, ...children) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') {
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else {
      el.setAttribute(key, value);
    }
  }

  for (const child of children) {
    if (child instanceof Node) {
      el.appendChild(child);
    } else if (child != null) {
      el.appendChild(document.createTextNode(String(child)));
    }
  }

  return el;
}

/**
 * Remove all children from an element
 * @param {Element} el - Parent element
 */
export function clearElement(el) {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

/**
 * Toggle a class on an element
 * @param {Element} el - Element
 * @param {string} className - Class name
 * @param {boolean} [force] - Force add/remove
 * @returns {boolean} - Whether class is now present
 */
export function toggleClass(el, className, force) {
  return el.classList.toggle(className, force);
}

/**
 * Add/remove class based on condition
 * @param {Element} el - Element
 * @param {string} className - Class name
 * @param {boolean} condition - Condition
 */
export function setClass(el, className, condition) {
  if (condition) el.classList.add(className);
  else el.classList.remove(className);
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format ISO date string to relative or absolute display
 * @param {string} isoString - ISO date string
 * @param {Object} [options] - Options
 * @param {boolean} [options.relative=true] - Show relative time
 * @returns {string}
 */
export function formatDate(isoString, options = {}) {
  const { relative = true } = options;
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (relative) {
    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
  }

  // Absolute format: "Jan 15, 2024 2:30 PM"
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Truncate text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string}
 */
export function truncate(text, maxLength = 100) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trim() + '…';
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string}
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// Async Helpers
// ============================================================================

/**
 * Debounce function calls
 * @param {Function} fn - Function to debounce
 * @param {number} ms - Delay in milliseconds
 * @returns {Function} - Debounced function
 */
export function debounce(fn, ms = 250) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Throttle function calls
 * @param {Function} fn - Function to throttle
 * @param {number} ms - Minimum interval
 * @returns {Function} - Throttled function
 */
export function throttle(fn, ms = 100) {
  let lastCall = 0;
  return (...args) => {
    const now = Date.now();
    if (now - lastCall >= ms) {
      lastCall = now;
      fn(...args);
    }
  };
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Toast Notifications
// ============================================================================

let toastContainer = null;
let toastId = 0;

/**
 * Initialize toast container
 * @param {string} selector - Container selector (default: '#toastContainer')
 */
export function initToasts(selector = '#toastContainer') {
  toastContainer = document.querySelector(selector);
}

/**
 * Show a toast notification
 * @param {string} message - Message text
 * @param {string} [type='info'] - Type: 'info', 'success', 'error', 'warning'
 * @param {number} [duration=4000] - Duration in ms (0 = persistent)
 * @returns {number} - Toast ID for dismissal
 */
export function showToast(message, type = 'info', duration = 4000) {
  if (!toastContainer) {
    initToasts();
    if (!toastContainer) return -1;
  }

  const id = ++toastId;
  const toast = createElement('div', {
    class: `toast toast-${type}`,
    role: 'alert',
    'aria-live': 'polite',
  }, message);

  // Add close button
  const closeBtn = createElement('button', {
    class: 'toast-close',
    'aria-label': 'Dismiss',
    onclick: () => dismissToast(id),
  }, '×');
  toast.appendChild(closeBtn);

  // Store ID for dismissal
  toast.dataset.toastId = id;

  toastContainer.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('toast-show');
  });

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }

  return id;
}

/**
 * Dismiss a toast by ID
 * @param {number} id - Toast ID
 */
export function dismissToast(id) {
  if (!toastContainer) return;
  const toast = toastContainer.querySelector(`[data-toast-id="${id}"]`);
  if (toast) {
    toast.classList.remove('toast-show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }
}

/**
 * Convenience methods for different toast types
 */
export const toast = {
  info: (msg, dur) => showToast(msg, 'info', dur),
  success: (msg, dur) => showToast(msg, 'success', dur),
  error: (msg, dur) => showToast(msg, 'error', dur),
  warning: (msg, dur) => showToast(msg, 'warning', dur),
};

// ============================================================================
// Clipboard
// ============================================================================

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} - Success
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Copy failed:', error);
    // Fallback for older browsers
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch (e) {
      return false;
    }
  }
}

// ============================================================================
// Hotkey Parsing
// ============================================================================

/**
 * Parse keyboard event to hotkey string (e.g., "Ctrl+Shift+M")
 * @param {KeyboardEvent} event - Keyboard event
 * @returns {string}
 */
export function parseHotkey(event) {
  const parts = [];

  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');

  // Skip modifier-only keys
  const key = event.key;
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key);
  }

  return parts.join('+');
}

/**
 * Check if event matches a hotkey string
 * @param {KeyboardEvent} event - Keyboard event
 * @param {string} hotkey - Hotkey string (e.g., "Ctrl+Shift+M")
 * @returns {boolean}
 */
export function matchesHotkey(event, hotkey) {
  return parseHotkey(event) === hotkey;
}

// ============================================================================
// Image/Data URI Helpers
// ============================================================================

/**
 * Convert data URI to Blob
 * @param {string} dataURI - Data URI string
 * @returns {Blob}
 */
export function dataURItoBlob(dataURI) {
  const byteString = atob(dataURI.split(',')[1]);
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}

/**
 * Compress image data URI to target size
 * @param {string} dataURI - Original data URI
 * @param {number} [maxSizeKB=1024] - Max size in KB
 * @param {number} [quality=0.8] - JPEG quality (0-1)
 * @returns {Promise<string>} - Compressed data URI
 */
export function compressImage(dataURI, maxSizeKB = 1024, quality = 0.8) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Calculate scale to fit max dimensions while preserving aspect
      const maxDim = 1920;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width *= scale;
        height *= scale;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      // Try different quality levels until under size limit
      let currentQuality = quality;
      let result = canvas.toDataURL('image/jpeg', currentQuality);

      const tryCompress = () => {
        const sizeKB = (result.length * 3) / 4 / 1024; // Rough base64 size
        if (sizeKB <= maxSizeKB || currentQuality <= 0.1) {
          resolve(result);
        } else {
          currentQuality -= 0.1;
          result = canvas.toDataURL('image/jpeg', currentQuality);
          tryCompress();
        }
      };

      tryCompress();
    };
    img.src = dataURI;
  });
}

/**
 * Create image preview element with remove button
 * @param {string} dataURI - Image data URI
 * @param {number} index - Index in array
 * @param {Function} onRemove - Callback(index)
 * @returns {HTMLElement}
 */
export function createImagePreview(dataURI, index, onRemove) {
  return createElement('div', { class: 'image-preview' },
    createElement('img', { src: dataURI, alt: `Attachment ${index + 1}` }),
    createElement('button', {
      class: 'image-preview-remove',
      'aria-label': `Remove image ${index + 1}`,
      onclick: () => onRemove(index),
    }, '×')
  );
}

// ============================================================================
// Storage Helpers (for renderer-side caching)
// ============================================================================

const storagePrefix = 'kay:';

/**
 * Get item from localStorage with JSON parsing
 * @param {string} key - Key
 * @param {*} defaultValue - Default if not found
 * @returns {*}
 */
export function getLocal(key, defaultValue = null) {
  try {
    const item = localStorage.getItem(storagePrefix + key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Set item in localStorage with JSON stringification
 * @param {string} key - Key
 * @param {*} value - Value
 */
export function setLocal(key, value) {
  try {
    localStorage.setItem(storagePrefix + key, JSON.stringify(value));
  } catch (error) {
    console.error('LocalStorage set failed:', error);
  }
}

/**
 * Remove item from localStorage
 * @param {string} key - Key
 */
export function removeLocal(key) {
  localStorage.removeItem(storagePrefix + key);
}

// ============================================================================
// Export all as default object for convenience
// ============================================================================

export default {
  $,
  $$,
  createElement,
  clearElement,
  toggleClass,
  setClass,
  formatDate,
  truncate,
  escapeHtml,
  debounce,
  throttle,
  sleep,
  initToasts,
  showToast,
  dismissToast,
  toast,
  copyToClipboard,
  parseHotkey,
  matchesHotkey,
  dataURItoBlob,
  compressImage,
  createImagePreview,
  getLocal,
  setLocal,
  removeLocal,
};