/**
 * Kay - untrusted-input filters for conversations (pure, no Electron imports).
 *
 * Deliberately free of Electron imports so it can be unit tested under plain
 * `node --test`. conversations.js owns the IPC handlers that use it.
 *
 * Both functions exist because these values come straight from the renderer
 * over IPC, which is a boundary you cannot trust by definition.
 */

/**
 * A conversation id is derived from `Date.now()` + a random base-36 string, so
 * it is always short and alphanumeric. Anything else - in particular anything
 * containing a path separator or `..` - is rejected before it reaches
 * `path.join`, because the renderer chooses the id it sends for get/update/
 * delete/export and an unvalidated one would escape CONVERSATIONS_DIR.
 */
const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Fields the renderer may change on an existing conversation, and the type
 * each one must have.
 *
 * The handler used to spread the incoming object straight over the stored one,
 * so the renderer could overwrite `createdAt`, `id`, or the entire `messages`
 * array with anything it liked - or add arbitrary unknown keys to the file.
 */
const UPDATABLE_FIELDS = {
  title: (value) => typeof value === 'string',
  model: (value) => typeof value === 'string',
  messages: (value) => Array.isArray(value),
};

/**
 * @param {*} id candidate conversation id from the renderer
 * @returns {boolean} true if the id is safe to use in a filesystem path
 */
function isValidConversationId(id) {
  return typeof id === 'string' && CONVERSATION_ID_PATTERN.test(id);
}

/**
 * The subset of `data` that is allowed to be written to a conversation file,
 * filtered by type.
 *
 * Unknown keys and wrongly-typed values are dropped rather than rejected, so a
 * partial update containing one bad field still applies its good ones.
 *
 * @param {*} data candidate update from the renderer
 * @returns {object} only the fields that may be written
 */
function pickUpdatableFields(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};

  const picked = {};
  for (const [key, isValid] of Object.entries(UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(data, key) && isValid(data[key])) {
      picked[key] = data[key];
    }
  }
  return picked;
}

module.exports = {
  CONVERSATION_ID_PATTERN,
  UPDATABLE_FIELDS,
  isValidConversationId,
  pickUpdatableFields,
};
