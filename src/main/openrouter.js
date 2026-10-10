const { ipcMain } = require('electron');
const { getApiKey, getSetting, getSettings } = require('./settings');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
let modelsCache = null;
let modelsCacheTime = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

let abortController = null;

function setupOpenRouter() {
  // Send a message (non-streaming)
  ipcMain.handle('chat:send', async (_, conversationId, message, images, model, systemPrompt) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { success: false, error: 'API key not set. Please configure in Settings.' };
    }

    const { addMessage, getConversationData } = require('./conversations');

    try {
      const existingData = getConversationData(conversationId);
      const maxHistory = getSetting('maxConversationHistory') || 50;
      const history = (existingData?.messages || []).slice(-maxHistory);

      const requestBody = buildRequestWithHistory(history, message, images, model, systemPrompt, false);

      const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://kay-assistant.app',
          'X-Title': 'Kay Assistant',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return { success: false, error: error.error?.message || `HTTP ${response.status}` };
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';

      // Persist user and assistant messages
      addMessage(conversationId, { role: 'user', content: message, images });
      addMessage(conversationId, { role: 'assistant', content });

      return { success: true, content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

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

    streamChatCompletion(conversationId, message, images, model, systemPrompt, apiKey, abortController.signal);
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

async function streamChatCompletion(conversationId, message, images, model, systemPrompt, apiKey, signal) {
  const win = require('./window').getWindow();
  const { addMessage, updateLastAssistantMessage, getConversationData, removeLastEmptyMessage } = require('./conversations');

  // 1. Get existing history before adding current message
  const existingData = getConversationData(conversationId);
  const maxHistory = getSetting('maxConversationHistory') || 50;
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
            if (delta) {
              fullContent += delta;
              // Send chunk to renderer
              if (win) {
                win.webContents.send('chat:stream-chunk', { conversationId, chunk: delta });
              }
              // Update conversation file periodically
              updateLastAssistantMessage(conversationId, fullContent);
            }
          } catch (e) {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
    }

    // Send final content
    if (win) {
      win.webContents.send('chat:stream-end', { conversationId, content: fullContent });
    }
    updateLastAssistantMessage(conversationId, fullContent);

  } catch (error) {
    if (error.name === 'AbortError') {
      if (win) {
        win.webContents.send('chat:stream-end', { conversationId, content: fullContent, canceled: true });
      }
      if (fullContent) {
        updateLastAssistantMessage(conversationId, fullContent);
      } else {
        removeLastEmptyMessage(conversationId);
      }
    } else {
      console.error('Stream error:', error);
      if (win) {
        win.webContents.send('chat:stream-error', error.message);
      }
      // If nothing was streamed, remove the empty assistant placeholder
      if (!fullContent) {
        removeLastEmptyMessage(conversationId);
      }
    }
  } finally {
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