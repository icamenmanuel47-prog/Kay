/**
 * Kay - Window Resize Handler
 * Handles frameless window resize via bottom-right corner drag handle
 */

// kayAPI is exposed via contextBridge on window object by preload
const kayAPI = window.kayAPI;

// Minimum window dimensions (must match main/window.js)
const MIN_WIDTH = 400;
const MIN_HEIGHT = 500;

// State
let isResizing = false;
let startX = 0;
let startY = 0;
let startWidth = 0;
let startHeight = 0;
let resizeHandle = null;
let rafId = null;

/**
 * Initialize the resize handler
 */
export function initWindowResize() {
  resizeHandle = document.getElementById('resizeHandle');

  if (!resizeHandle) {
    console.warn('[WindowResize] Resize handle element not found');
    return;
  }

  // Mouse down on resize handle
  resizeHandle.addEventListener('mousedown', onMouseDown);

  // Touch support for potential touch screens
  resizeHandle.addEventListener('touchstart', onTouchStart, { passive: false });

  console.log('[WindowResize] Initialized');
}

/**
 * Handle mouse down on resize handle
 */
function onMouseDown(e) {
  e.preventDefault();
  e.stopPropagation();

  startResize(e.clientX, e.clientY);
}

/**
 * Handle touch start on resize handle
 */
function onTouchStart(e) {
  e.preventDefault();
  e.stopPropagation();

  const touch = e.touches[0];
  if (touch) {
    startResize(touch.clientX, touch.clientY);
  }
}

/**
 * Start the resize operation
 */
async function startResize(clientX, clientY) {
  if (isResizing) return;

  isResizing = true;
  startX = clientX;
  startY = clientY;

  // Get current window bounds
  try {
    const bounds = await kayAPI.window.getBounds();
    if (bounds) {
      startWidth = bounds.width;
      startHeight = bounds.height;
    }
  } catch (error) {
    console.error('[WindowResize] Failed to get window bounds:', error);
  }

  // Add document-level listeners
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);

  // Prevent text selection during resize
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'se-resize';

  // Visual feedback
  resizeHandle.style.opacity = '1';
}

/**
 * Handle mouse move during resize
 */
function onMouseMove(e) {
  if (!isResizing) return;

  e.preventDefault();
  resizeWindow(e.clientX, e.clientY);
}

/**
 * Handle touch move during resize
 */
function onTouchMove(e) {
  if (!isResizing) return;

  e.preventDefault();
  const touch = e.touches[0];
  if (touch) {
    resizeWindow(touch.clientX, touch.clientY);
  }
}

/**
 * Calculate and apply new window size
 */
function resizeWindow(clientX, clientY) {
  const deltaX = clientX - startX;
  const deltaY = clientY - startY;

  let newWidth = Math.max(MIN_WIDTH, startWidth + deltaX);
  let newHeight = Math.max(MIN_HEIGHT, startHeight + deltaY);

  // Throttle IPC calls with requestAnimationFrame
  if (rafId) cancelAnimationFrame(rafId);

  rafId = requestAnimationFrame(() => {
    kayAPI.window.setBounds({ width: newWidth, height: newHeight });
  });
}

/**
 * Handle mouse up - end resize
 */
function onMouseUp() {
  endResize();
}

/**
 * Handle touch end - end resize
 */
function onTouchEnd() {
  endResize();
}

/**
 * End the resize operation
 */
function endResize() {
  if (!isResizing) return;

  isResizing = false;

  // Cancel any pending RAF
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  // Remove document-level listeners
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', onTouchEnd);

  // Restore styles
  document.body.style.userSelect = '';
  document.body.style.cursor = '';

  // Visual feedback
  if (resizeHandle) {
    resizeHandle.style.opacity = '';
  }

  console.log('[WindowResize] Resize ended');
}

/**
 * Cleanup function for app shutdown
 */
export function cleanupWindowResize() {
  if (resizeHandle) {
    resizeHandle.removeEventListener('mousedown', onMouseDown);
    resizeHandle.removeEventListener('touchstart', onTouchStart);
  }

  endResize();
}

export default {
  init: initWindowResize,
  cleanup: cleanupWindowResize,
};