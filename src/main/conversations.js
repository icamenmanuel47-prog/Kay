const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONVERSATIONS_DIR = path.join(app.getPath('userData'), 'kay', 'conversations');

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
                preview: getPreview(content.messages, searchTerm),
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

function getPreview(messages, highlightTerm = null) {
  if (!messages || messages.length === 0) return 'No messages yet';
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
  const preview = lastUserMsg || lastAssistantMsg;
  if (!preview) return 'No messages yet';
  let text = preview.content.substring(0, 100);
  if (highlightTerm && text.toLowerCase().includes(highlightTerm)) {
    // Could add highlighting here if needed
  }
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
  getConversationData,
  removeLastEmptyMessage,
  getConversationPath,
  CONVERSATIONS_DIR,
};