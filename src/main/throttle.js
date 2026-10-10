/**
 * Kay - trailing-edge throttle.
 *
 * Pure (no Electron), so it can be unit tested under plain `node --test`.
 *
 * Used to stop the streaming path from rewriting the whole conversation file
 * once per token: callers invoke on every update, and the wrapped function
 * runs at most once per `wait` milliseconds with the most recent arguments.
 */

/**
 * @template {(...args: any[]) => any} T
 * @param {T} fn function to throttle
 * @param {number} wait minimum gap between runs, in milliseconds
 */
function createTrailingThrottle(fn, wait) {
  if (typeof fn !== 'function') throw new TypeError('createTrailingThrottle: fn must be a function');
  if (!Number.isFinite(wait) || wait < 0) throw new TypeError('createTrailingThrottle: wait must be a non-negative number');

  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  /** @type {any[] | null} */
  let pendingArgs = null;

  function run() {
    timer = null;
    if (pendingArgs === null) return;
    const args = pendingArgs;
    pendingArgs = null;
    fn(...args);
  }

  return {
    /**
     * Record the latest arguments. The throttled function runs either when
     * `wait` elapses (trailing edge) or at the next flush, whichever is first.
     */
    invoke(...args) {
      pendingArgs = args;
      if (timer === null) {
        timer = setTimeout(run, wait);
      }
    },

    /**
     * Run the pending call now, if any, and stop the timer.
     * No-op when nothing is pending.
     * @returns {boolean} whether a call was flushed
     */
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const wasPending = pendingArgs !== null;
      run();
      return wasPending;
    },

    /**
     * Drop the pending call without running it.
     * @returns {boolean} whether a call was discarded
     */
    cancel() {
      const wasPending = pendingArgs !== null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pendingArgs = null;
      return wasPending;
    },

    /** @returns {boolean} whether a call is waiting to run */
    get pending() {
      return pendingArgs !== null;
    },
  };
}

module.exports = { createTrailingThrottle };
