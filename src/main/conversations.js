const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { createTrailingThrottle } = require('./throttle');

const CONVERSATIONS_DIR = path.join(app.getPath('userData'), 'kay', 'conversations');

// How often a streamed assistant message is allowed to hit disk. Persisting
// every chunk meant a full read/parse/stringify/write of the whole
// conversation once per token - quadratic work that visibly stuttered on long
// threads and wore the disk for no benefit.
const STREAM_PERSIST_INTERVAL_MS = 300;

/** @type {Map<string, ReturnType<typeof createTrailingThrottle>>} */
const pendingAssistantWrites = new Map();

// Ensure conversations directory exists
function ensureDir() {
  if (!fs.existsSync(CONVERSATIONS_DIR)) {
    fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
  }
}

function getConversationPath(id) {
  return path.join(CONVERSATIONS_DIR, `${id}.json`);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function setupConversations() {
  ensureDir();

  // List all conversations (metadata only for sidebar)
  ipcMain.handle('conversations:list', () => {
    try {
      ensureDir();
      const files = fs.readdirSync(CONVERSATIONS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const filePath = path.join(CONVERSATIONS_DIR, f);
          const stat = fs.statSync(filePath);
          try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return {
              id: content.id,
              title: content.title || 'Untitled',
              model: content.model || 'unknown',
              messageCount: content.messages?.length || 0,
              createdAt: content.createdAt,
              updatedAt: content.updatedAt || content.createdAt,
              preview: getPreview(content.messages),
            };
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      return { conversations: files };
    } catch (error) {
      console.error('Error listing conversations:', error);
      return { conversations: [] };
    }
  });

  // Get full conversation with messages
  ipcMain.handle('conversations:get', (_, id) => {
    try {
      const filePath = getConversationPath(id);
      if (!fs.existsSync(filePath)) {
        return { conversation: null, error: 'Not found' };
      }
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { conversation: content };
    } catch (error) {
      console.error('Error reading conversation:', error);
      return { conversation: null, error: error.message };
    }
  });

  // Create new conversation
  ipcMain.handle('conversations:create', (_, title = 'New Chat', model = 'nvidia/nemotron-3-ultra-550b-a55b:free') => {
    try {
      ensureDir();
      const id = generateId();
      const now = new Date().toISOString();
      const conversation = {
        id,
        title,
        model,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      fs.writeFileSync(getConversationPath(id), JSON.stringify(conversation, null, 2));
      notifyListChanged();
      return { conversation };
    } catch (error) {
      console.error('Error creating conversation:', error);
      return { conversation: null, error: error.message };
    }
  });

  // Update conversation (title, model, messages)
  ipcMain.handle('conversations:update', (_, id, data) => {
    try {
      const filePath = getConversationPath(id);
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Not found' };
      }
      const conversation = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const updated = {
        ...conversation,
        ...data,
        id, // Preserve ID
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
      notifyListChanged();
      return { success: true, conversation: updated };
    } catch (error) {
      console.error('Error updating conversation:', error);
      return { success: false, error: error.message };
    }
  });

  // Delete conversation
  ipcMain.handle('conversations:delete', (_, id) => {
    try {
      const filePath = getConversationPath(id);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      notifyListChanged();
      return { success: true };
    } catch (error) {
      console.error('Error deleting conversation:', error);
      return { success: false, error: error.message };
    }
  });

  // Export conversation to Markdown
  ipcMain.handle('conversations:export', async (_, id) => {
    try {
      const filePath = getConversationPath(id);
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Not found' };
      }
      const conversation = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      // Generate markdown
      let md = `# ${conversation.title}\n\n`;
      md += `**Model:** ${conversation.model}  \n`;
      md += `**Created:** ${new Date(conversation.createdAt).toLocaleString()}  \n`;
      md += `**Updated:** ${new Date(conversation.updatedAt).toLocaleString()}  \n\n`;
      md += `---\n\n`;

      for (const msg of conversation.messages) {
        const role = msg.role === 'user' ? '## You' : '## Kay';
        md += `${role}\n\n${msg.content}\n\n`;
        if (msg.images && msg.images.length > 0) {
          md += `*[${msg.images.length} image(s) attached]*\n\n`;
        }
        md += `---\n\n`;
      }

      // Save dialog
      const win = require('./window').getWindow();
      const result = await dialog.showSaveDialog(win, {
        defaultPath: `${conversation.title}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });

      if (!result.canceled && result.filePath) {
        fs.writeFileSync(result.filePath, md, 'utf8');
        return { success: true, path: result.filePath };
      }
      return { success: false, canceled: true };
    } catch (error) {
      console.error('Error exporting conversation:', error);
      return { success: false, error: error.message };
    }
  });

  // Search conversations
  ipcMain.handle('conversations:search', (_, query) => {
    try {
      if (!query || !query.trim()) {
        return { conversations: [] };
      }
      const searchTerm = query.toLowerCase().trim();
      ensureDir();
      const files = fs.readdirSync(CONVERSATIONS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const filePath = path.join(CONVERSATIONS_DIR, f);
          try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const titleMatch = content.title?.toLowerCase().includes(searchTerm);
            const contentMatch = content.messages?.some(m =>
              m.content?.toLowerCase().includes(searchTerm)
            );
            if (titleMatch || contentMatch) {
              return {
                id: content.id,
                title: content.title || 'Untitled',
                model: content.model || 'unknown',
                messageCount: content.messages?.length || 0,
                createdAt: content.createdAt,
                updatedAt: content.updatedAt || content.createdAt,
                preview: getPreview(content.messages),
              };
            }
            return null;
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      return { conversations: files };
    } catch (error) {
      console.error('Error searching conversations:', error);
      return { conversations: [] };
    }
  });
}

function getPreview(messages) {
  if (!messages || messages.length === 0) return 'No messages yet';
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
  const preview = lastUserMsg || lastAssistantMsg;
  if (!preview) return 'No messages yet';
  const text = preview.content.substring(0, 100);
  return text + (preview.content.length > 100 ? '...' : '');
}

function notifyListChanged() {
  const win = require('./window').getWindow();
  if (win) {
    win.webContents.send('conversations:list-changed');
  }
}

// Helper to add a message to a conversation
function addMessage(conversationId, message) {
  try {
    const filePath = getConversationPath(conversationId);
    if (!fs.existsSync(filePath)) return false;
    const conversation = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    conversation.messages.push({
      ...message,
      timestamp: new Date().toISOString(),
    });
    conversation.updatedAt = new Date().toISOString();
    // Auto-generate title from first user message
    if (conversation.messages.length === 1 && message.role === 'user') {
      conversation.title = message.content.substring(0, 50) + (message.content.length > 50 ? '...' : '');
    }
    fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2));
    notifyListChanged();
    return true;
  } catch (error) {
    console.error('Error adding message:', error);
    return false;
  }
}

// Helper to update the last assistant message (for streaming)
function updateLastAssistantMessage(conversationId, content) {
  try {
    const filePath = getConversationPath(conversationId);
    if (!fs.existsSync(filePath)) return false;
    const conversation = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const lastIdx = conversation.messages.findLastIndex(m => m.role === 'assistant');
    if (lastIdx >= 0) {
      conversation.messages[lastIdx].content = content;
      conversation.updatedAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2));
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error updating last message:', error);
    return false;
  }
}

function getAssistantThrottle(conversationId) {
  let throttle = pendingAssistantWrites.get(conversationId);
  if (!throttle) {
    throttle = createTrailingThrottle(
      (id, content) => updateLastAssistantMessage(id, content),
      STREAM_PERSIST_INTERVAL_MS,
    );
    pendingAssistantWrites.set(conversationId, throttle);
  }
  return throttle;
}

/**
 * Queue a persist of a streaming assistant message.
 *
 * Empty content is ignored: there is nothing to write, and it must never
 * replace the pending real content.
 *
 * @param {string} conversationId
 * @param {string} content full message text so far
 */
function scheduleAssistantUpdate(conversationId, content) {
  if (!content) return;
  getAssistantThrottle(conversationId).invoke(conversationId, content);
}

/**
 * Persist a streaming assistant message immediately and stop any queued write.
 *
 * Must be used on every terminal path (stream end, cancel, error) so the
 * final text is never lost to a queued write holding older content.
 *
 * @param {string} conversationId
 * @param {string} content final message text
 * @returns {boolean} whether a write happened
 */
function finalizeAssistantUpdate(conversationId, content) {
  const throttle = pendingAssistantWrites.get(conversationId);
  if (throttle) {
    throttle.cancel();
    pendingAssistantWrites.delete(conversationId);
  }
  if (!content) return false;
  return updateLastAssistantMessage(conversationId, content);
}

/**
 * Drop any queued write without persisting it.
 *
 * Used when the placeholder assistant message is about to be removed, so a
 * trailing timer cannot resurrect it afterwards.
 *
 * @param {string} conversationId
 * @returns {boolean} whether a queued write was discarded
 */
function cancelPendingAssistantUpdate(conversationId) {
  const throttle = pendingAssistantWrites.get(conversationId);
  if (!throttle) return false;
  pendingAssistantWrites.delete(conversationId);
  return throttle.cancel();
}

/**
 * Persist any queued writes. Safety net for app shutdown.
 *
 * @param {string} [conversationId] one conversation, or all when omitted
 */
function flushPendingAssistantUpdates(conversationId) {
  const ids = conversationId === undefined
    ? [...pendingAssistantWrites.keys()]
    : [conversationId];

  for (const id of ids) {
    const throttle = pendingAssistantWrites.get(id);
    if (!throttle) continue;
    pendingAssistantWrites.delete(id);
    throttle.flush();
  }
}

// Helper to get conversation data
function getConversationData(conversationId) {
  try {
    const filePath = getConversationPath(conversationId);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error('Error reading conversation data:', error);
    return null;
  }
}

// Helper to remove last message if it's empty (e.g. placeholder on stream error)
function removeLastEmptyMessage(conversationId) {
  try {
    const filePath = getConversationPath(conversationId);
    if (!fs.existsSync(filePath)) return false;
    const conversation = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (conversation.messages.length > 0) {
      const last = conversation.messages[conversation.messages.length - 1];
      if (last.role === 'assistant' && (!last.content || last.content.trim() === '')) {
        conversation.messages.pop();
        conversation.updatedAt = new Date().toISOString();
        fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2));
        notifyListChanged();
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('Error removing empty message:', error);
    return false;
  }
}

module.exports = {
  setupConversations,
  addMessage,
  updateLastAssistantMessage,
  scheduleAssistantUpdate,
  finalizeAssistantUpdate,
  cancelPendingAssistantUpdate,
  flushPendingAssistantUpdates,
  getConversationData,
  removeLastEmptyMessage,
  getConversationPath,
  CONVERSATIONS_DIR,
};