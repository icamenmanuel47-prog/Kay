import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Create a mock ElectronStore backed by memory/temp file
class MockStore {
  constructor(options = {}) {
    this.name = options.name || 'store';
    this.data = options.defaults || {};
  }
  get(key, defaultValue) {
    if (key === undefined) return this.data;
    const parts = key.split('.');
    let cur = this.data;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return defaultValue;
      cur = cur[p];
    }
    return cur !== undefined ? cur : defaultValue;
  }
  set(key, value) {
    if (typeof key === 'object') {
      this.data = { ...this.data, ...key };
      return;
    }
    const parts = key.split('.');
    let cur = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  delete(key) {
    delete this.data[key];
  }
  clear() {
    this.data = {};
  }
}

// Mock electron modules
const electronMock = {
  app: {
    getPath: (name) => os.tmpdir(),
  },
  dialog: {
    showSaveDialog: async () => ({ canceled: false, filePath: path.join(os.tmpdir(), 'test_export.md') }),
  },
};

// We can test conversation operations logic
test('Conversations: creates conversation and adds messages', async () => {
  const store = new MockStore({
    defaults: {
      conversations: {},
      activeConversationId: null,
      folders: [],
    }
  });

  // Create conversation
  const convId = 'conv_' + Date.now();
  const newConv = {
    id: convId,
    title: 'Civil Engineering Analysis',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    folderId: null,
    tags: ['structural', 'beam'],
    messages: [
      {
        id: 'msg_1',
        role: 'user',
        content: 'Calculate beam deflection',
        timestamp: new Date().toISOString(),
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: 'Deflection $\\delta = \\frac{5wL^4}{384EI}$',
        timestamp: new Date().toISOString(),
      }
    ],
  };

  store.set(`conversations.${convId}`, newConv);
  store.set('activeConversationId', convId);

  const retrieved = store.get(`conversations.${convId}`);
  assert.equal(retrieved.title, 'Civil Engineering Analysis');
  assert.equal(retrieved.messages.length, 2);
  assert.equal(retrieved.messages[1].role, 'assistant');
  assert.match(retrieved.messages[1].content, /\\delta/);
});

test('Conversations: empty assistant placeholder cleanup', async () => {
  const store = new MockStore({
    defaults: {
      conversations: {
        conv_123: {
          id: 'conv_123',
          title: 'Test Conversation',
          messages: [
            { id: 'm1', role: 'user', content: 'Hello' },
            { id: 'm2', role: 'assistant', content: '' } // Empty placeholder
          ]
        }
      }
    }
  });

  const conv = store.get('conversations.conv_123');
  assert.equal(conv.messages.length, 2);

  // Simulate removeLastEmptyMessage logic
  const lastMsg = conv.messages[conv.messages.length - 1];
  if (lastMsg && lastMsg.role === 'assistant' && (!lastMsg.content || !lastMsg.content.trim())) {
    conv.messages.pop();
    store.set('conversations.conv_123.messages', conv.messages);
  }

  const updated = store.get('conversations.conv_123');
  assert.equal(updated.messages.length, 1);
  assert.equal(updated.messages[0].id, 'm1');
});

test('Conversations: export formatting to markdown and JSON', async () => {
  const conversation = {
    id: 'conv_export',
    title: 'Reinforced Concrete Design',
    createdAt: '2025-01-01T00:00:00.000Z',
    messages: [
      { role: 'user', content: 'What is the minimum cover for concrete?', timestamp: '2025-01-01T00:00:01.000Z' },
      { role: 'assistant', content: 'For exterior exposure, 50mm cover is recommended.', timestamp: '2025-01-01T00:00:05.000Z' },
    ]
  };

  // Format to markdown
  const lines = [
    `# ${conversation.title}`,
    `*Created: ${conversation.createdAt}*`,
    '',
    '---',
    '',
  ];

  for (const msg of conversation.messages) {
    const roleLabel = msg.role === 'user' ? '**User**' : '**Kay**';
    lines.push(`### ${roleLabel}`);
    lines.push(msg.content);
    lines.push('');
  }

  const mdExport = lines.join('\n');
  assert.match(mdExport, /# Reinforced Concrete Design/);
  assert.match(mdExport, /\*\*Kay\*\*/);
  assert.match(mdExport, /50mm cover/);

  // Format to JSON
  const jsonExport = JSON.stringify(conversation, null, 2);
  const parsed = JSON.parse(jsonExport);
  assert.equal(parsed.title, 'Reinforced Concrete Design');
  assert.equal(parsed.messages.length, 2);
});
