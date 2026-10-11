const { ipcMain } = require('electron');
const { getApiKey, getSetting, getSettings } = require('./settings');
const { isValidConversationId } = require('./conversation-fields');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
let modelsCache = null;
let modelsCacheTime = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

let abortController = null;

// Monotonic id for the stream that currently owns the conversation. See
// setupOpenRouter's chat:stream handler for why this exists.
let activeStreamId = 0;

// Hard ceilings on the two outbound requests. A dropped connection mid-stream
// would otherwise leave the reader awaiting forever, and a wedged models
// fetch would leave the picker in a permanent loading state.
const CHAT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const MODELS_REQUEST_TIMEOUT_MS = 30 * 1000;

const MAX_MESSAGE_CHARS = 100000;
const MAX_IMAGES = 6;

/**
 * chat:stream comes straight from the renderer over an unvalidated channel.
 * Anything non-conforming is rejected here (with an error the UI can show)
 * rather than reaching the network request or the conversation file.
 *
 * @returns {string|null} an error message, or null when the payload is fine
 */
function validateStreamArgs(conversationId, message, images, model) {
  if (!isValidConversationId(conversationId)) return 'Invalid conversation id';
  if (typeof message !== 'string' || message.trim().length === 0) return 'Message is empty';
  if (message.length > MAX_MESSAGE_CHARS) return 'Message is too long';

  if (images != null) {
    if (!Array.isArray(images)) return 'Images must be an array';
    if (images.length > MAX_IMAGES) return `At most ${MAX_IMAGES} images are supported`;
    for (const img of images) {
      // The renderer only ever attaches compressed data URLs; anything else
      // is either a bug or an attempt to make main fetch an arbitrary URL.
      if (typeof img !== 'string' || !img.startsWith('data:image/')) {
        return 'Images must be embedded data URLs';
      }
    }
  }

  if (model != null && (typeof model !== 'string' || model.length > 200)) {
    return 'Invalid model';
  }

  return null;
}

function setupOpenRouter() {
  // Stream a message
  ipcMain.on('chat:stream', (event, conversationId, message, images, model, systemPrompt) => {
    // Only the app's own renderer may stream. Without this, any webContents
    // (including a future one opened by a bug) could drive the chat.
    if (event.sender !== getWindow()?.webContents) return;

    const invalid = validateStreamArgs(conversationId, message, images, model);
    if (invalid) {
      console.warn('[OpenRouter] Rejected chat:stream:', invalid);
      require('./window').sendToRenderer('chat:stream-error', invalid, conversationId);
      return;
    }

    const safeSystemPrompt = typeof systemPrompt === 'string' ? systemPrompt.slice(0, 20000) : '';
    const safeImages = Array.isArray(images) ? images : [];

    const apiKey = getApiKey();
    if (!apiKey) {
      // The renderer already rendered the message optimistically, and main is
      // the only process that writes messages to disk - so persist it here or
      // it silently disappears on the next reload.
      require('./conversations').addMessage(conversationId, {
        role: 'user',
        content: message,
        images: safeImages,
      });

      require('./window').sendToRenderer(
        'chat:stream-error',
        'API key not set. Please configure in Settings.',
        conversationId
      );
      return;
    }

    // Cancel any existing stream
    if (abortController) {
      abortController.abort();
    }
    const controller = new AbortController();
    abortController = controller;

    // The aborted stream's catch handler still runs afterwards. Tagging each
    // stream lets a superseded one recognise that it no longer owns the
    // conversation and must not write to it (or emit events for it).
    const streamId = ++activeStreamId;

    // Discard anything queued for this conversation by the stream we just
    // aborted, so a stale trailing write cannot land on the message we are
    // about to append.
    require('./conversations').cancelPendingAssistantUpdate(conversationId);

    streamChatCompletion(
      conversationId,
      message,
      safeImages,
      model,
      safeSystemPrompt,
      apiKey,
      controller.signal,
      streamId
    ).catch((error) => {
      // streamChatCompletion has its own try/catch, but an exception before
      // that (e.g. inside the conversations helpers) must still be logged
      // instead of surfacing as an unhandled rejection.
      console.error('[OpenRouter] Unhandled stream failure:', error);
    });
  });

  // Cancel streaming
  ipcMain.handle('chat:cancel-stream', () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  });

  // Get models list
  ipcMain.handle('chat:get-models', async () => {
    // Errors now travel back to the caller: the picker and settings screen
    // used to receive an empty list with no explanation on any network
    // failure, which read as "Kay has no models".
    return await fetchModels();
  });

  // Set favorite model
  ipcMain.handle('chat:set-favorite-model', (_, modelId, isFavorite) => {
    if (typeof modelId !== 'string' || modelId.length === 0 || modelId.length > 200) {
      return { success: false, error: 'Invalid model id' };
    }
    const settings = getSettings();
    let favorites = settings.favoriteModels || [];
    if (isFavorite) {
      if (!favorites.includes(modelId)) favorites.push(modelId);
    } else {
      favorites = favorites.filter(id => id !== modelId);
    }
    require('./settings').setSetting('favoriteModels', favorites);
    return { success: true, favorites };
  });
}

function buildRequestWithHistory(historyMessages, currentMessage, images, model, systemPrompt, stream) {
  const messages = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  // Include previous messages from history (excluding empty assistant placeholders and the current message)
  if (Array.isArray(historyMessages)) {
    for (const msg of historyMessages) {
      if (!msg.content && (!msg.images || msg.images.length === 0)) continue;

      if (msg.role === 'user') {
        const userContent = [];
        if (msg.content) {
          userContent.push({ type: 'text', text: msg.content });
        }
        if (msg.images && msg.images.length > 0) {
          for (const img of msg.images) {
            userContent.push({
              type: 'image_url',
              image_url: { url: img },
            });
          }
        }
        messages.push({
          role: 'user',
          content: userContent.length === 1 && userContent[0].type === 'text' ? userContent[0].text : userContent,
        });
      } else if (msg.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: msg.content || '',
        });
      }
    }
  }

  // Add the current user message
  const currentUserContent = [];
  currentUserContent.push({ type: 'text', text: currentMessage });

  if (images && images.length > 0) {
    for (const img of images) {
      currentUserContent.push({
        type: 'image_url',
        image_url: { url: img },
      });
    }
  }

  messages.push({
    role: 'user',
    content: currentUserContent.length === 1 && currentUserContent[0].type === 'text' ? currentUserContent[0].text : currentUserContent,
  });

  return {
    model: model || getSetting('defaultModel'),
    messages,
    stream,
    temperature: 0.7,
    max_tokens: 4096,
  };
}

async function streamChatCompletion(conversationId, message, images, model, systemPrompt, apiKey, signal, streamId) {
  const {
    addMessage,
    getConversationData,
    removeLastEmptyMessage,
    scheduleAssistantUpdate,
    finalizeAssistantUpdate,
    flushPendingAssistantUpdates,
  } = require('./conversations');
  const { sendToRenderer } = require('./window');

  // False once a newer message has taken over this conversation. A superseded
  // stream must not persist text or emit events for a conversation it no
  // longer owns - its abort handler runs *after* the new stream has started.
  const isCurrent = () => streamId === activeStreamId;

  // 1. Get existing history before adding current message
  const existingData = getConversationData(conversationId);
  const maxHistory = getSetting('maxConversationHistory') || 100;
  const history = (existingData?.messages || []).slice(-maxHistory);

  // 2. Add user message to conversation
  addMessage(conversationId, { role: 'user', content: message, images });

  // 3. Add placeholder assistant message
  addMessage(conversationId, { role: 'assistant', content: '' });

  let fullContent = '';

  try {
    const requestBody = buildRequestWithHistory(history, message, images, model, systemPrompt, true);

    // The caller's signal lets the user cancel; the timeout catches a
    // connection that dies without ever closing the socket.
    const fetchSignal = typeof AbortSignal.any === 'function'
      ? AbortSignal.any([signal, AbortSignal.timeout(CHAT_REQUEST_TIMEOUT_MS)])
      : signal;

    const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://kay-assistant.app',
        'X-Title': 'Kay Assistant',
      },
      body: JSON.stringify(requestBody),
      signal: fetchSignal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneStreaming = false;

    // SSE payloads are separated by blank lines and terminated by
    // "data: [DONE]". The old loop only recognised `data: ` with a space,
    // skipped (rather than stopped on) [DONE], and never handled a final
    // event that arrived without a trailing newline - which silently
    // dropped the last chunk of a response.
    const handleLine = (line) => {
      const trimmed = line.trim();
      if (trimmed === '') return false;
      if (!trimmed.startsWith('data:')) return false;

      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return true;

      try {
        const parsed = JSON.parse(data);
        // choices can be missing on keep-alive/usage frames
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta && isCurrent()) {
          fullContent += delta;
          sendToRenderer('chat:stream-chunk', { conversationId, chunk: delta });
          // Throttled: this used to rewrite the entire conversation file
          // once per token.
          scheduleAssistantUpdate(conversationId, fullContent);
        }
      } catch (e) {
        // Ignore malformed frames; a stream should not die over one line.
      }
      return false;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE separates events with \r\n or \n; split on both.
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (handleLine(line)) {
          doneStreaming = true;
          break;
        }
      }
      if (doneStreaming) break;
    }

    if (!doneStreaming) {
      // Flush the decoder and process whatever was left in the buffer, in
      // case the final event arrived without a trailing newline.
      buffer += decoder.decode();
      if (buffer && handleLine(buffer)) doneStreaming = true;
    } else {
      // Release the connection instead of leaving the rest of the body
      // unread and the socket open.
      reader.cancel().catch(() => {});
    }

    // Send final content
    if (isCurrent()) {
      sendToRenderer('chat:stream-end', { conversationId, content: fullContent });
      finalizeAssistantUpdate(conversationId, fullContent);
      notifyIfAway(fullContent);
    }

  } catch (error) {
    // Superseded: a newer stream owns this conversation now. Touching the file
    // here would overwrite the new message with stale text.
    if (!isCurrent()) return;

    if (error.name === 'AbortError') {
      sendToRenderer('chat:stream-end', { conversationId, content: fullContent, canceled: true });
      if (fullContent) {
        finalizeAssistantUpdate(conversationId, fullContent);
      } else {
        removeLastEmptyMessage(conversationId);
      }
    } else {
      console.error('Stream error:', error);
      sendToRenderer('chat:stream-error', error.message, conversationId);
      if (fullContent) {
        // Keep whatever did arrive instead of dropping it on the floor, which
        // is what happened before when a stream failed part-way through.
        finalizeAssistantUpdate(conversationId, fullContent);
      } else {
        // Nothing streamed: remove the empty assistant placeholder.
        removeLastEmptyMessage(conversationId);
      }
    }
  } finally {
    // Safety net for any path that returned without finalising.
    if (isCurrent()) {
      flushPendingAssistantUpdates(conversationId);
    }
    // Only clear the module-level controller if it is still *this* stream's.
    // A superseded stream's finally used to null it unconditionally, dropping
    // the live stream's AbortController and making cancel/supersede no-ops.
    if (abortController && abortController.signal === signal) {
      abortController = null;
    }
  }
}

/**
 * Desktop notification for a finished response, honouring the
 * showNotifications setting. Only fires while the window is away - notifying
 * someone who is already looking at the answer is just noise.
 */
function notifyIfAway(content) {
  try {
    if (!getSetting('showNotifications')) return;
    const win = require('./window').getWindow();
    if (win && win.isVisible()) return;
    const { Notification } = require('electron');
    if (!Notification.isSupported()) return;
    const body = String(content || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    new Notification({ title: 'Kay', body: body || 'Kay finished responding' }).show();
  } catch (error) {
    // Notifications are best-effort; never let them break the stream path.
  }
}

/**
 * Fetch the model list from OpenRouter, cached for an hour.
 *
 * Returns { models, error } so callers can tell the user why the list is
 * empty instead of presenting a silent, permanently blank picker.
 */
async function fetchModels() {
  const now = Date.now();
  if (modelsCache && (now - modelsCacheTime) < CACHE_TTL) {
    return { models: modelsCache, error: null };
  }

  try {
    const response = await fetch(`${OPENROUTER_BASE}/models`, {
      signal: AbortSignal.timeout(MODELS_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const models = (data.data || []).map(m => ({
      id: m.id,
      name: m.name || m.id,
      description: m.description,
      contextLength: m.context_length,
      pricing: m.pricing,
      inputModalities: m.architecture?.input_modalities || ['text'],
      outputModalities: m.architecture?.output_modalities || ['text'],
      isFree: (m.pricing?.prompt === '0' && m.pricing?.completion === '0') || m.id.includes(':free'),
      supportsImages: (m.architecture?.input_modalities || ['text']).includes('image'),
    }));

    modelsCache = models;
    modelsCacheTime = now;

    // Notify renderer
    require('./window').sendToRenderer('chat:models', models);

    return { models, error: null };
  } catch (error) {
    console.error('Error fetching models:', error);
    return {
      models: modelsCache || [],
      error: modelsCache
        ? null // a stale list beats an error banner
        : `Could not load models: ${error.message}`,
    };
  }
}

module.exports = {
  setupOpenRouter,
  fetchModels,
  // Exported for tests: both are pure functions that decide what actually
  // reaches the network.
  buildRequestWithHistory,
  validateStreamArgs,
  OPENROUTER_BASE,
};