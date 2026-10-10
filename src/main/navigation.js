/**
 * Kay - decides what to do when the renderer asks to navigate somewhere.
 *
 * Pure (Node builtins only) so it can be unit tested under `node --test`.
 * index.js owns the Electron listeners that call it.
 *
 * The previous version of this check compared `new URL(url).origin` against
 * `'file://'`, which can never match: per the URL standard a `file:` URL has an
 * opaque origin, so `origin` is the string `"null"`. The "allow local file"
 * branch was dead code, and a malformed URL made `new URL` throw inside the
 * listener instead of being denied.
 *
 * It also handed *any* non-file URL to `shell.openExternal`, so a
 * `javascript:` or other custom-scheme link from a model response would be
 * passed to the OS shell.
 */

const path = require('path');
const { fileURLToPath } = require('url');

/** Schemes we are willing to hand to the user's default browser. */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/** Uniform "do not navigate, do not hand anything to the OS" answer. */
const DENY = Object.freeze({
  preventNavigation: true,
  openExternal: null,
});

/**
 * @param {*} rawUrl candidate URL from `will-navigate` / `setWindowOpenHandler`
 * @param {object} [options]
 * @param {string} [options.allowedDir] absolute directory local files must stay inside
 * @returns {{preventNavigation: boolean, openExternal: string|null}}
 *   `preventNavigation` should always be acted on; `openExternal` is a URL to
 *   pass to `shell.openExternal` when non-null.
 */
function classifyNavigation(rawUrl, options = {}) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return DENY;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return DENY;
  }

  // http(s) never happens in-page for this app, so treat it as a link the user
  // meant to follow elsewhere.
  if (EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    return { preventNavigation: true, openExternal: rawUrl };
  }

  // Local files are only navigable inside the renderer bundle - covers a
  // reload of index.html while still blocking `file:///` anywhere else on disk.
  if (parsed.protocol === 'file:') {
    const { allowedDir } = options;
    if (typeof allowedDir !== 'string' || allowedDir.length === 0) return DENY;

    let target;
    try {
      target = fileURLToPath(parsed);
    } catch {
      return DENY;
    }
    const relative = path.relative(allowedDir, target);
    const isInside =
      relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    return isInside ? { preventNavigation: false, openExternal: null } : DENY;
  }

  // javascript:, data:, app:// and anything else: block navigation, and do not
  // forward to the OS shell.
  return DENY;
}

module.exports = { classifyNavigation, EXTERNAL_PROTOCOLS };
