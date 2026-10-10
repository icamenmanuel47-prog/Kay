/**
 * Kay - shared app lifecycle state.
 *
 * Lives in its own module because window.js and index.js both need it and
 * requiring index.js from window.js created a circular dependency: window.js
 * destructured getIsQuitting while index.js was still mid-load, so it captured
 * `undefined` and calling it threw on window close (defeating the hide-to-tray
 * behaviour entirely).
 */

let isQuitting = false;

/**
 * Mark the app as quitting, so window close is allowed rather than hidden.
 * @param {boolean} value
 */
function setIsQuitting(value) {
  isQuitting = !!value;
}

/**
 * @returns {boolean} whether the app is shutting down
 */
function getIsQuitting() {
  return isQuitting;
}

module.exports = { setIsQuitting, getIsQuitting };
