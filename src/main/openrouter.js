const { ipcMain } = require('electron');
const { getApiKey, getSetting, getSettings } = require('./settings');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
let modelsCache = null;
let modelsCacheTime = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

let abortController = null;

// Monotonic id for the stream that currently owns the conversation. See
// setupOpenRouter's chat:stream handler for why this exists.
let activeStreamId = 0;

function setupOpenRouter() {
  // Stream a message
  ipcMain.on('chat:stream', (_, conversationId, message, images, model, systemPrompt) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      // Send error via event
      const win = require('./window').getWindow();
      if (win) {
        win.webContents.send('chat:stream-error', 'API key not set. Please configure in Settings.');
      }
      return;
    }

    // Cancel any existing stream
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();

    // The aborted stream's catch handler still runs afterwards. Tagging each
    // stream lets a superseded one recognise that it no longer owns the
    // conversation and must not write to it (or emit events for it).
    const streamId = ++activeStreamId;

    // Discard anything queued for this conversation by the stream we just
    // aborted, so a stale trailing write cannot land on the message we are
    // about to append.
    require('./conversations').cancelPendingAssistantUpdate(conversationId);

    streamChatCompletion(conversationId, message, images, model, systemPrompt, apiKey, abortController.signal, streamId);
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
    const models = await fetchModels();
    return { models };
  });

  // Set favorite model
  ipcMain.handle('chat:set-favorite-model', (_, modelId, isFavorite) => {
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
  const win = require('./window').getWindow();
  const {
    addMessage,
    getConversationData,
    removeLastEmptyMessage,
    scheduleAssistantUpdate,
    finalizeAssistantUpdate,
    flushPendingAssistantUpdates,
  } = require('./conversations');

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

    const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://kay-assistant.app',
        'X-Title': 'Kay Assistant',
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices[0]?.delta?.content;
            if (delta && isCurrent()) {
              fullContent += delta;
              // Send chunk to renderer
              if (win) {
                win.webContents.send('chat:stream-chunk', { conversationId, chunk: delta });
              }
              // Throttled: this used to rewrite the entire conversation file
              // once per token.
              scheduleAssistantUpdate(conversationId, fullContent);
            }
          } catch (e) {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
    }

    // Send final content
    if (isCurrent()) {
      if (win) {
        win.webContents.send('chat:stream-end', { conversationId, content: fullContent });
      }
      finalizeAssistantUpdate(conversationId, fullContent);
    }

  } catch (error) {
    // Superseded: a newer stream owns this conversation now. Touching the file
    // here would overwrite the new message with stale text.
    if (!isCurrent()) return;

    if (error.name === 'AbortError') {
      if (win) {
        win.webContents.send('chat:stream-end', { conversationId, content: fullContent, canceled: true });
      }
      if (fullContent) {
        finalizeAssistantUpdate(conversationId, fullContent);
      } else {
        removeLastEmptyMessage(conversationId);
      }
    } else {
      console.error('Stream error:', error);
      if (win) {
        win.webContents.send('chat:stream-error', error.message);
      }
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
    abortController = null;
  }
}

async function fetchModels() {
  const now = Date.now();
  if (modelsCache && (now - modelsCacheTime) < CACHE_TTL) {
    return modelsCache;
  }

  try {
    const response = await fetch(`${OPENROUTER_BASE}/models`);
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
    const win = require('./window').getWindow();
    if (win) {
      win.webContents.send('chat:models', models);
    }

    return models;
  } catch (error) {
    console.error('Error fetching models:', error);
    return modelsCache || [];
  }
}

// Helper to check if model supports images
function modelSupportsImages(modelId) {
  const model = modelsCache?.find(m => m.id === modelId);
  return model?.supportsImages || false;
}

module.exports = {
  setupOpenRouter,
  fetchModels,
  modelSupportsImages,
  OPENROUTER_BASE,
};