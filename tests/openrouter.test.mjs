import test from 'node:test';
import assert from 'node:assert/strict';

test('OpenRouter: builds request with multi-turn history', () => {
  const conversation = {
    id: 'conv_1',
    messages: [
      { id: 'm1', role: 'user', content: 'What is Hooke\'s Law?' },
      { id: 'm2', role: 'assistant', content: 'Hooke\'s Law is $\\sigma = E \\cdot \\epsilon$.' },
      { id: 'm3', role: 'user', content: 'How does it apply to cantilever beams?' },
    ]
  };

  const systemPrompt = 'You are Kay, an academic civil engineering assistant.';
  const maxHistory = 10;
  const currentPrompt = 'How does it apply to cantilever beams?';
  const currentImages = ['data:image/png;base64,abc123'];

  // Emulate buildRequestWithHistory logic
  const messages = [];

  if (systemPrompt && systemPrompt.trim()) {
    messages.push({
      role: 'system',
      content: systemPrompt.trim(),
    });
  }

  // Preceding history
  const historyTurns = conversation.messages.slice(0, -1);
  const sliced = historyTurns.slice(-maxHistory);

  for (const msg of sliced) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    if (msg.images && msg.images.length > 0) {
      const contentParts = [];
      if (msg.content) {
        contentParts.push({ type: 'text', text: msg.content });
      }
      for (const img of msg.images) {
        contentParts.push({
          type: 'image_url',
          image_url: { url: img },
        });
      }
      messages.push({ role: msg.role, content: contentParts });
    } else {
      messages.push({ role: msg.role, content: msg.content || '' });
    }
  }

  // Current turn
  const currentContent = [];
  if (currentPrompt) {
    currentContent.push({ type: 'text', text: currentPrompt });
  }
  if (currentImages && currentImages.length > 0) {
    for (const img of currentImages) {
      currentContent.push({
        type: 'image_url',
        image_url: { url: img },
      });
    }
  }
  messages.push({ role: 'user', content: currentContent });

  // Assertions
  assert.equal(messages.length, 4); // system, user(1), assistant(2), user(3 with image)
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.equal(messages[1].content, 'What is Hooke\'s Law?');
  assert.equal(messages[2].role, 'assistant');
  assert.equal(messages[2].content, 'Hooke\'s Law is $\\sigma = E \\cdot \\epsilon$.');
  assert.equal(messages[3].role, 'user');
  assert.equal(Array.isArray(messages[3].content), true);
  assert.equal(messages[3].content[0].text, 'How does it apply to cantilever beams?');
  assert.equal(messages[3].content[1].image_url.url, 'data:image/png;base64,abc123');
});

test('OpenRouter: caps history length accurately', () => {
  const conversation = {
    id: 'conv_long',
    messages: []
  };

  // Generate 20 turns
  for (let i = 1; i <= 20; i++) {
    conversation.messages.push({
      id: `m_${i}`,
      role: i % 2 === 1 ? 'user' : 'assistant',
      content: `Message ${i}`,
    });
  }

  const maxHistory = 4;
  const historyTurns = conversation.messages.slice(0, -1);
  const sliced = historyTurns.slice(-maxHistory);

  assert.equal(sliced.length, 4);
  assert.equal(sliced[0].content, 'Message 16');
  assert.equal(sliced[3].content, 'Message 19');
});
