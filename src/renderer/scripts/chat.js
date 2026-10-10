/**
 * Kay - Chat Module
 * Handles message rendering, streaming, input handling, image paste/upload, model selection
 */

import { $, $$, createElement, clearElement, formatDate, parseHotkey, compressImage, createImagePreview, showToast, debounce } from './utils.js';
import { renderMarkdownToElement, rerenderMarkdownInElement } from './markdown.js';

// kayAPI is exposed via contextBridge on window object by preload
const kayAPI = window.kayAPI;

// ============================================================================
// State
// ============================================================================

let currentConversationId = null;
let currentModel = null;
let currentSystemPrompt = null;
let isStreaming = false;
let attachedImages = [];
let modelsCache = [];
let favoritesCache = [];
let abortController = null;
let messageCounter = 0;

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
  welcomeScreen: null,
  messagesContainer: null,
  messages: null,
  typingIndicator: null,
  imagePreviewBar: null,
  imagePreviews: null,
  clearImagesBtn: null,
  messageInput: null,
  sendBtn: null,
  attachImageBtn: null,
  clearChatBtn: null,
  modelTrigger: null,
  modelDropdown: null,
  modelSearch: null,
  freeOnlyFilter: null,
  modelList: null,
  modelName: null,
  hotkeyBadge: null,
  opacityBtn: null,
  opacitySliderContainer: null,
  opacitySlider: null,
  opacityValue: null,
  settingsOpacitySlider: null,
  settingsOpacityValue: null,
};

// ============================================================================
// Initialization
// ============================================================================

export async function initChat() {
  cacheElements();
  bindEvents();
  await loadModels();
  setupModelSelector();
  setupOpacitySlider();
  setupImagePaste();
  setupInputAutoResize();
  loadSettings();

  // Return public API for window attachment
  return {
    sendMessage,
    cancelStream,
    getCurrentConversationId,
    setCurrentConversationId,
    loadConversation,
  };
}

function cacheElements() {
  elements.welcomeScreen = $('#welcomeScreen');
  elements.messagesContainer = $('#messagesContainer');
  elements.messages = $('#messages');
  elements.typingIndicator = $('#typingIndicator');
  elements.imagePreviewBar = $('#imagePreviewBar');
  elements.imagePreviews = $('#imagePreviews');
  elements.clearImagesBtn = $('#clearImages');
  elements.messageInput = $('#messageInput');
  elements.sendBtn = $('#sendBtn');
  elements.attachImageBtn = $('#attachImageBtn');
  elements.clearChatBtn = $('#clearChatBtn');
  elements.modelTrigger = $('#modelTrigger');
  elements.modelDropdown = $('#modelDropdown');
  elements.modelSearch = $('#modelSearch');
  elements.freeOnlyFilter = $('#freeOnlyFilter');
  elements.modelList = $('#modelList');
  elements.modelName = $('#modelName');
  elements.hotkeyBadge = $('#hotkeyBadge');
  elements.opacityBtn = $('#opacityBtn');
  elements.opacitySliderContainer = $('#opacitySliderContainer');
  elements.opacitySlider = $('#opacitySlider');
  elements.opacityValue = $('#opacityValue');
  elements.settingsOpacitySlider = $('#settingsOpacitySlider');
  elements.settingsOpacityValue = $('#settingsOpacityValue');
}

function bindEvents() {
  // Send message - use direct references to ensure binding
  const sendBtn = elements.sendBtn;
  const messageInput = elements.messageInput;

  if (sendBtn) {
    sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendMessage();
    });
  } else {
    console.warn('[Chat] sendBtn not found during bindEvents');
  }

  if (messageInput) {
    messageInput.addEventListener('keydown', handleInputKeydown);
    // Also handle composition events for IME input
    messageInput.addEventListener('compositionstart', () => {
      messageInput.dataset.composing = 'true';
    });
    messageInput.addEventListener('compositionend', (e) => {
      messageInput.dataset.composing = 'false';
      // Handle Enter during composition
      if (e.data && e.data.endsWith('\n')) {
        e.preventDefault();
        sendMessage();
      }
    });
  } else {
    console.warn('[Chat] messageInput not found during bindEvents');
  }

  // Clear chat
  const clearChatBtn = elements.clearChatBtn;
  if (clearChatBtn) {
    clearChatBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearCurrentChat();
    });
  }

  // Clear images
  const clearImagesBtn = elements.clearImagesBtn;
  if (clearImagesBtn) {
    clearImagesBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearAttachedImages();
    });
  }

  // Attach image button
  const attachImageBtn = elements.attachImageBtn;
  if (attachImageBtn) {
    attachImageBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = createElement('input', { type: 'file', accept: 'image/*', style: 'display:none' });
      input.onchange = (ev) => handleFileSelect(ev.target.files);
      document.body.appendChild(input);
      input.click();
      input.remove();
    });
  }

  // Model selector toggle
  const modelTrigger = elements.modelTrigger;
  if (modelTrigger) {
    modelTrigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleModelDropdown();
    });
  }
  const modelSearch = elements.modelSearch;
  if (modelSearch) {
    modelSearch.addEventListener('input', debounce(filterModels, 150));
  }
  const freeOnlyFilter = elements.freeOnlyFilter;
  if (freeOnlyFilter) {
    freeOnlyFilter.addEventListener('change', filterModels);
  }

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!elements.modelTrigger?.contains(e.target) && !elements.modelDropdown?.contains(e.target)) {
      closeModelDropdown();
    }
  });

  // Opacity slider in header
  const opacityBtn = elements.opacityBtn;
  if (opacityBtn) {
    opacityBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleOpacitySlider();
    });
  }
  const opacitySlider = elements.opacitySlider;
  if (opacitySlider) {
    opacitySlider.addEventListener('input', handleOpacityChange);
  }

  // Close opacity slider on click outside
  document.addEventListener('click', (e) => {
    if (!elements.opacityBtn?.contains(e.target) && !elements.opacitySliderContainer?.contains(e.target)) {
      closeOpacitySlider();
    }
  });

  // Stream event listeners
  kayAPI.onStreamChunk(handleStreamChunk);
  kayAPI.onStreamEnd(handleStreamEnd);
  kayAPI.onStreamError(handleStreamError);
  kayAPI.onModelList(handleModelList);

  // Conversation selection
  window.addEventListener('conversation:selected', (e) => loadConversation(e.detail.conversationId));
  window.addEventListener('conversation:deleted', () => showWelcomeScreen());

  // Settings changes
  kayAPI.onSettingsChanged(handleSettingsChange);
  kayAPI.onHotkeyChanged(updateHotkeyBadge);

  // Window shown/hidden
  kayAPI.onConversationListChanged(() => {
    // Conversation list changed, maybe refresh models if needed
  });
}

// ============================================================================
// Settings & Models
// ============================================================================

async function loadSettings() {
  try {
    const result = await kayAPI.settings.get();
    if (result) {
      currentModel = result.defaultModel;
      currentSystemPrompt = result.systemPrompt;
      updateModelDisplay();
      updateHotkeyBadge(result.hotkey);
    }
  } catch (error) {
    console.error('[Chat] Failed to load settings:', error);
  }
}

async function loadModels() {
  try {
    const result = await kayAPI.chat.getModels();
    if (result.models) {
      modelsCache = result.models;
      filterModels();
    }
  } catch (error) {
    console.error('[Chat] Failed to load models:', error);
  }
}

function handleModelList(models) {
  modelsCache = models;
  filterModels();
}

function filterModels() {
  if (!elements.modelList) return;

  const searchTerm = elements.modelSearch?.value?.toLowerCase() || '';
  const freeOnly = elements.freeOnlyFilter?.checked;

  let filtered = modelsCache;

  if (freeOnly) {
    filtered = filtered.filter(m => m.isFree);
  }

  if (searchTerm) {
    filtered = filtered.filter(m =>
      m.name.toLowerCase().includes(searchTerm) ||
      m.id.toLowerCase().includes(searchTerm)
    );
  }

  // Sort: favorites first, then free, then by name
  filtered.sort((a, b) => {
    const aFav = favoritesCache.includes(a.id);
    const bFav = favoritesCache.includes(b.id);
    if (aFav !== bFav) return bFav - aFav;
    if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  renderModelList(filtered);
}

function renderModelList(models) {
  if (!elements.modelList) return;

  clearElement(elements.modelList);

  const fragment = document.createDocumentFragment();

  models.forEach(model => {
    const isFavorite = favoritesCache.includes(model.id);
    const isSelected = model.id === currentModel;

    const item = createElement('div', {
      class: `model-item${isSelected ? ' selected' : ''}${isFavorite ? ' favorite' : ''}`,
      'data-model-id': model.id,
      role: 'option',
      'aria-selected': isSelected,
    });

    item.innerHTML = `
      <div class="model-item-info">
        <div class="model-item-name">${escapeHtml(model.name)}</div>
        <div class="model-item-meta">
          ${model.isFree ? '<span class="model-item-badge free">Free</span>' : '<span class="model-item-badge paid">Paid</span>'}
          <span>${model.contextLength ? `${(model.contextLength / 1000).toFixed(0)}k ctx` : ''}</span>
        </div>
      </div>
      <button class="model-item-favorite" aria-label="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}" data-model-id="${model.id}">
        <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      </button>
    `;

    // Click to select model
    item.addEventListener('click', (e) => {
      if (e.target.closest('.model-item-favorite')) return;
      selectModel(model.id);
    });

    // Favorite button
    const favBtn = item.querySelector('.model-item-favorite');
    favBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(model.id, !isFavorite);
    });

    fragment.appendChild(item);
  });

  elements.modelList.appendChild(fragment);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// Model Selector UI
// ============================================================================

function setupModelSelector() {
  // Load favorites from settings
  kayAPI.settings.get().then(settings => {
    if (settings.favoriteModels) {
      favoritesCache = settings.favoriteModels;
      filterModels();
    }
  });
}

function toggleModelDropdown() {
  const isOpen = elements.modelDropdown?.classList.toggle('open');
  elements.modelTrigger?.setAttribute('aria-expanded', isOpen);
  if (isOpen) {
    elements.modelSearch?.focus();
    filterModels();
  }
}

function closeModelDropdown() {
  elements.modelDropdown?.classList.remove('open');
  elements.modelTrigger?.setAttribute('aria-expanded', 'false');
}

export function selectModel(modelId) {
  currentModel = modelId;
  updateModelDisplay();
  closeModelDropdown();

  // Save as default model
  kayAPI.settings.set('defaultModel', modelId);
}

function updateModelDisplay() {
  const model = modelsCache.find(m => m.id === currentModel);
  if (model && elements.modelName) {
    elements.modelName.textContent = model.name;
  }
}

async function toggleFavorite(modelId, isFavorite) {
  try {
    const result = await kayAPI.chat.setFavoriteModel(modelId, isFavorite);
    if (result.success) {
      favoritesCache = result.favorites;
      filterModels();
    }
  } catch (error) {
    console.error('[Chat] Toggle favorite failed:', error);
  }
}

// ============================================================================
// Opacity Slider
// ============================================================================

function setupOpacitySlider() {
  // Load current opacity
  kayAPI.settings.get().then(settings => {
    if (settings.windowOpacity) {
      const opacity = Math.round(settings.windowOpacity * 100);
      elements.opacitySlider.value = opacity;
      elements.settingsOpacitySlider.value = opacity;
      updateOpacityDisplay(opacity);
    }
  });
}

function toggleOpacitySlider() {
  elements.opacitySliderContainer?.classList.toggle('visible');
  if (elements.opacitySliderContainer?.classList.contains('visible')) {
    elements.opacitySlider?.focus();
  }
}

function closeOpacitySlider() {
  elements.opacitySliderContainer?.classList.remove('visible');
}

function handleOpacityChange() {
  const opacity = parseInt(elements.opacitySlider?.value) / 100;
  updateOpacityDisplay(Math.round(opacity * 100));
  kayAPI.window.setOpacity(opacity);
  kayAPI.settings.set('windowOpacity', opacity);
}

function updateOpacityDisplay(value) {
  elements.opacityValue.textContent = `${value}%`;
  elements.settingsOpacityValue.textContent = `${value}%`;
  elements.opacitySlider.value = value;
  elements.settingsOpacitySlider.value = value;
}

// ============================================================================
// Hotkey Badge
// ============================================================================

function updateHotkeyBadge(hotkey) {
  if (elements.hotkeyBadge) {
    elements.hotkeyBadge.textContent = hotkey;
  }
}

function handleSettingsChange(settings) {
  if (settings.theme) {
    applyTheme(settings.theme);
  }
  if (settings.windowOpacity !== undefined) {
    updateOpacityDisplay(Math.round(settings.windowOpacity * 100));
  }
  if (settings.hotkey) {
    updateHotkeyBadge(settings.hotkey);
  }
  if (settings.defaultModel) {
    currentModel = settings.defaultModel;
    updateModelDisplay();
  }
  if (settings.systemPrompt) {
    currentSystemPrompt = settings.systemPrompt;
  }
}

// ============================================================================
// Theme
// ============================================================================

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

// ============================================================================
// Image Handling
// ============================================================================

function setupImagePaste() {
  document.addEventListener('paste', async (e) => {
    if (isStreaming) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await addImageFile(file);
      }
    }
  });

  // Drag and drop
  const dropZone = elements.messagesContainer || document.body;

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');

    if (isStreaming) return;

    const files = e.dataTransfer?.files;
    if (files) {
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          await addImageFile(file);
        }
      }
    }
  });
}

async function handleFileSelect(files) {
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      await addImageFile(file);
    }
  }
}

async function addImageFile(file) {
  // Check size
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    showToast('Image too large (max 10MB)', 'error');
    return;
  }

  // Convert to data URI
  const dataURI = await fileToDataURI(file);

  // Compress if needed
  const compressed = await compressImage(dataURI, 1024, 0.85);

  attachedImages.push(compressed);
  renderImagePreviews();
  showImagePreviewBar();
}

function fileToDataURI(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderImagePreviews() {
  if (!elements.imagePreviews) return;

  clearElement(elements.imagePreviews);

  attachedImages.forEach((dataURI, index) => {
    const preview = createImagePreview(dataURI, index, removeAttachedImage);
    elements.imagePreviews.appendChild(preview);
  });
}

function removeAttachedImage(index) {
  attachedImages.splice(index, 1);
  renderImagePreviews();

  if (attachedImages.length === 0) {
    hideImagePreviewBar();
  }
}

function clearAttachedImages() {
  attachedImages = [];
  renderImagePreviews();
  hideImagePreviewBar();
}

function showImagePreviewBar() {
  elements.imagePreviewBar?.removeAttribute('hidden');
}

function hideImagePreviewBar() {
  elements.imagePreviewBar?.setAttribute('hidden', '');
}

function getAttachedImages() {
  return [...attachedImages];
}

function clearAttachedImagesInternal() {
  attachedImages = [];
}

// ============================================================================
// Input Handling
// ============================================================================

function setupInputAutoResize() {
  const textarea = elements.messageInput;
  if (!textarea) return;

  const resize = () => {
    textarea.style.height = 'auto';
    const height = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = `${height}px`;
  };

  textarea.addEventListener('input', resize);
  // Initial resize
  resize();
}

function handleInputKeydown(event) {
  // Don't send during IME composition
  if (event.target.dataset.composing === 'true') return;

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    console.log('[Chat] Enter key pressed, sending message');
    sendMessage();
    return false;
  }
}

// ============================================================================
// Message Sending
// ============================================================================

async function sendMessage() {
  const text = elements.messageInput?.value?.trim();
  if (!text && attachedImages.length === 0) return;
  if (isStreaming) return;

  // Create conversation if needed
  if (!currentConversationId) {
    const conv = await window.sidebar?.createNewConversation();
    if (!conv) return;
    currentConversationId = conv.id;
  }

  const messageText = text || '';
  const images = [...attachedImages];

  // Clear input
  elements.messageInput.value = '';
  elements.messageInput.style.height = 'auto';
  clearAttachedImagesInternal();

  // Add user message to UI immediately
  addMessageToUI({
    role: 'user',
    content: messageText,
    images,
    timestamp: new Date().toISOString(),
  }, true);

  // Start streaming
  isStreaming = true;
  updateSendButtonState();

  try {
    kayAPI.chat.streamMessage(
      currentConversationId,
      messageText,
      images,
      currentModel,
      currentSystemPrompt
    );
  } catch (error) {
    console.error('[Chat] Stream error:', error);
    handleStreamError(error.message);
  }
}

// ============================================================================
// Stream Handling
// ============================================================================

function handleStreamChunk(data) {
  if (data.conversationId !== currentConversationId) return;

  // Show typing indicator
  showTypingIndicator();

  // Find or create assistant message
  let assistantMsg = elements.messages?.lastElementChild;
  if (!assistantMsg || assistantMsg.dataset.role !== 'assistant') {
    assistantMsg = createAssistantMessageElement('');
    elements.messages?.appendChild(assistantMsg);
  }

  // Update content
  const contentEl = assistantMsg.querySelector('.message-text');
  if (contentEl) {
    contentEl.dataset.rawContent = (contentEl.dataset.rawContent || '') + data.chunk;
    renderMarkdownToElement(contentEl.dataset.rawContent, contentEl);
  }

  // Scroll to bottom
  scrollToBottom();
}

function handleStreamEnd(data) {
  if (data.conversationId !== currentConversationId) return;

  isStreaming = false;
  hideTypingIndicator();
  updateSendButtonState();

  // Find assistant message and finalize
  const assistantMsg = elements.messages?.lastElementChild;
  if (assistantMsg && assistantMsg.dataset.role === 'assistant') {
    const contentEl = assistantMsg.querySelector('.message-text');
    if (contentEl && data.content) {
      contentEl.dataset.rawContent = data.content;
      renderMarkdownToElement(data.content, contentEl);
    }

    // Add metadata
    addMessageMeta(assistantMsg, data.canceled);
  }

  scrollToBottom();
}

function handleStreamError(error) {
  isStreaming = false;
  hideTypingIndicator();
  updateSendButtonState();

  // Remove incomplete assistant message if exists
  const assistantMsg = elements.messages?.lastElementChild;
  if (assistantMsg && assistantMsg.dataset.role === 'assistant') {
    assistantMsg.remove();
  }

  // Show error message
  addMessageToUI({
    role: 'assistant',
    content: `**Error:** ${error}`,
    timestamp: new Date().toISOString(),
    isError: true,
  }, true);

  showToast(error, 'error');
}

// ============================================================================
// Message Rendering
// ============================================================================

function addMessageToUI(message, scroll = true) {
  if (!elements.messages) return;

  // Hide welcome screen
  elements.welcomeScreen?.setAttribute('hidden', '');
  elements.messagesContainer?.removeAttribute('hidden');

  const msgEl = message.role === 'user'
    ? createUserMessageElement(message)
    : createAssistantMessageElement(message.content, message);

  elements.messages.appendChild(msgEl);

  if (scroll) scrollToBottom();
}

function createUserMessageElement(message) {
  const wrapper = createElement('div', {
    class: 'message user',
    'data-role': 'user',
  });

  const avatar = createElement('div', { class: 'message-avatar' }, 'You');

  const content = createElement('div', { class: 'message-content' });
  const text = createElement('div', { class: 'message-text' });
  content.appendChild(text);

  // Render markdown
  renderMarkdownToElement(message.content, text);

  // Images
  if (message.images && message.images.length > 0) {
    const imagesContainer = createElement('div', { class: 'message-images' });
    message.images.forEach(img => {
      const imgEl = createElement('img', {
        class: 'message-image',
        src: img,
        alt: 'Attached image',
      });
      imgEl.onclick = () => openImageModal(img);
      imagesContainer.appendChild(imgEl);
    });
    content.appendChild(imagesContainer);
  }

  // Meta
  const meta = createElement('div', { class: 'message-meta' });
  meta.innerHTML = `
    <span>${formatDate(message.timestamp)}</span>
    <div class="message-actions">
      <button class="message-action-btn" aria-label="Copy message" data-action="copy">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
    </div>
  `;
  content.appendChild(meta);

  // Copy action
  meta.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
    copyToClipboard(message.content);
    showToast('Copied to clipboard', 'success');
  });

  wrapper.appendChild(avatar);
  wrapper.appendChild(content);

  return wrapper;
}

function createAssistantMessageElement(content = '', message = {}) {
  const wrapper = createElement('div', {
    class: 'message assistant',
    'data-role': 'assistant',
  });

  const avatar = createElement('div', { class: 'message-avatar' }, 'K');

  const contentDiv = createElement('div', { class: 'message-content' });
  const text = createElement('div', { class: 'message-text' });
  contentDiv.appendChild(text);

  if (content) {
    text.dataset.rawContent = content;
    renderMarkdownToElement(content, text);
  }

  // Meta (model info, actions)
  const meta = createElement('div', { class: 'message-meta' });
  meta.innerHTML = `
    <span class="model-badge">${escapeHtml(currentModel || 'unknown')}</span>
    <div class="message-actions">
      <button class="message-action-btn" aria-label="Copy message" data-action="copy">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="message-action-btn" aria-label="Regenerate" data-action="regenerate">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      </button>
    </div>
  `;
  contentDiv.appendChild(meta);

  // Actions
  meta.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
    copyToClipboard(text.dataset.rawContent || content);
    showToast('Copied to clipboard', 'success');
  });

  meta.querySelector('[data-action="regenerate"]')?.addEventListener('click', () => {
    regenerateLastResponse();
  });

  wrapper.appendChild(contentDiv);
  wrapper.appendChild(avatar);

  return wrapper;
}

function addMessageMeta(messageEl, canceled = false) {
  const meta = messageEl.querySelector('.message-meta');
  if (!meta) return;

  const time = formatDate(new Date().toISOString());
  const status = canceled ? ' <span style="color: var(--accent-warning)">(stopped)</span>' : '';

  meta.innerHTML = `
    <span>${time}${status}</span>
    <div class="message-actions">
      <button class="message-action-btn" aria-label="Copy message" data-action="copy">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="message-action-btn" aria-label="Regenerate" data-action="regenerate">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      </button>
    </div>
  `;

  meta.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
    const contentEl = messageEl.querySelector('.message-text');
    copyToClipboard(contentEl?.dataset.rawContent || contentEl?.textContent || '');
    showToast('Copied to clipboard', 'success');
  });

  meta.querySelector('[data-action="regenerate"]')?.addEventListener('click', () => {
    regenerateLastResponse();
  });
}

async function regenerateLastResponse() {
  // Find last user message
  const messages = elements.messages?.querySelectorAll('.message');
  let lastUserMsg = null;
  let lastAssistantMsg = null;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].dataset.role === 'user' && !lastUserMsg) {
      lastUserMsg = messages[i];
    } else if (messages[i].dataset.role === 'assistant' && !lastAssistantMsg) {
      lastAssistantMsg = messages[i];
    }
    if (lastUserMsg && lastAssistantMsg) break;
  }

  if (!lastUserMsg || !currentConversationId) return;

  // Get user message content
  const userContent = lastUserMsg.querySelector('.message-text')?.dataset.rawContent ||
                       lastUserMsg.querySelector('.message-text')?.textContent || '';

  // Remove last assistant message
  lastAssistantMsg.remove();

  // Re-send
  isStreaming = true;
  updateSendButtonState();

  kayAPI.chat.streamMessage(
    currentConversationId,
    userContent,
    [], // Images not stored for regeneration
    currentModel,
    currentSystemPrompt
  );
}

// ============================================================================
// Conversation Loading
// ============================================================================

async function loadConversation(conversationId) {
  currentConversationId = conversationId;

  // Clear current messages
  clearElement(elements.messages);
  clearAttachedImagesInternal();

  try {
    const result = await kayAPI.conversations.get(conversationId);
    if (result.conversation) {
      const conv = result.conversation;

      if (conv.messages && conv.messages.length > 0) {
        elements.welcomeScreen?.setAttribute('hidden', '');
        elements.messagesContainer?.removeAttribute('hidden');

        conv.messages.forEach(msg => {
          addMessageToUI(msg, false);
        });

        scrollToBottom();
      } else {
        showWelcomeScreen();
      }
    } else if (result.error) {
      showToast(result.error, 'error');
      showWelcomeScreen();
    }
  } catch (error) {
    console.error('[Chat] Load conversation failed:', error);
    showToast('Failed to load conversation', 'error');
    showWelcomeScreen();
  }
}

function showWelcomeScreen() {
  elements.welcomeScreen?.removeAttribute('hidden');
  elements.messagesContainer?.setAttribute('hidden', '');
  clearElement(elements.messages);
}

function clearCurrentChat() {
  if (!currentConversationId) return;

  if (!confirm('Clear all messages in this conversation?')) return;

  clearElement(elements.messages);
  showWelcomeScreen();
}

// ============================================================================
// Typing Indicator
// ============================================================================

function showTypingIndicator() {
  elements.typingIndicator?.removeAttribute('hidden');
  scrollToBottom();
}

function hideTypingIndicator() {
  elements.typingIndicator?.setAttribute('hidden', '');
}

// ============================================================================
// Scroll Management
// ============================================================================

function scrollToBottom() {
  if (elements.messagesContainer) {
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
  }
}

// ============================================================================
// Send Button State
// ============================================================================

function updateSendButtonState() {
  if (elements.sendBtn) {
    elements.sendBtn.disabled = isStreaming;
    if (isStreaming) {
      elements.sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    } else {
      elements.sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
    }
  }
}

// ============================================================================
// Image Modal
// ============================================================================

function openImageModal(dataURI) {
  // Create modal overlay
  const overlay = createElement('div', { class: 'image-modal-overlay' });
  const img = createElement('img', { src: dataURI, alt: 'Full size image' });
  const closeBtn = createElement('button', {
    class: 'image-modal-close',
    'aria-label': 'Close',
    onclick: () => overlay.remove(),
  }, '×');

  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);

  // Close on click outside image
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Close on Escape
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

// ============================================================================
// Public API
// ============================================================================

export function getCurrentConversationId() {
  return currentConversationId;
}

export function setCurrentConversationId(id) {
  currentConversationId = id;
}

export function cancelStream() {
  if (isStreaming) {
    kayAPI.chat.cancelStream();
    isStreaming = false;
    hideTypingIndicator();
    updateSendButtonState();
  }
}

export default {
  init: initChat,
  sendMessage,
  cancelStream,
  getCurrentConversationId,
  setCurrentConversationId,
  loadConversation,
};