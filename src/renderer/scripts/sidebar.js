/**
 * Kay - Sidebar Module
 * Handles conversation list: loading, search, create, select, delete, rename
 */

import { $, $$, createElement, clearElement, formatDate, debounce, showToast } from './utils.js';

// kayAPI is exposed via contextBridge on window object by preload
const kayAPI = window.kayAPI;

// ============================================================================
// State
// ============================================================================

let conversations = [];
let selectedConversationId = null;
let searchDebounce = null;
let isSearching = false;

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
  list: null,
  search: null,
  newChatBtn: null,
  startChatBtn: null,
};

// ============================================================================
// Initialization
// ============================================================================

export async function initSidebar() {
  cacheElements();
  bindEvents();
  await loadConversations();
  setupKeyboardNavigation();

  // Return public API for window attachment
  return {
    createNewConversation,
    selectConversation,
    getSelectedConversationId,
    renameConversation,
    deleteConversation,
    exportConversation,
    refresh,
    clearSearch,
  };
}

function cacheElements() {
  elements.list = $('#conversationList');
  elements.search = $('#conversationSearch');
  elements.newChatBtn = $('#newChatBtn');
  elements.startChatBtn = $('#startChatBtn');
}

function bindEvents() {
  // New chat buttons
  elements.newChatBtn?.addEventListener('click', () => createNewConversation());
  elements.startChatBtn?.addEventListener('click', () => createNewConversation());

  // Search input with debounce
  if (elements.search) {
    searchDebounce = debounce(handleSearch, 200);
    elements.search.addEventListener('input', (e) => searchDebounce(e.target.value));
    elements.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        elements.search.value = '';
        handleSearch('');
        elements.search.blur();
      }
    });
  }

  // Listen for conversation list changes from main process
  kayAPI.onConversationListChanged(() => loadConversations());

  // Listen for settings changes (might affect theme, etc.)
  kayAPI.onSettingsChanged(() => renderConversations());
}

// ============================================================================
// Conversation Loading
// ============================================================================

async function loadConversations() {
  try {
    const result = await kayAPI.conversations.list();
    if (result.conversations) {
      conversations = result.conversations;
      renderConversations();
    }
  } catch (error) {
    console.error('[Sidebar] Failed to load conversations:', error);
    showToast('Failed to load conversations', 'error');
  }
}

function renderConversations() {
  if (!elements.list) return;

  clearElement(elements.list);

  if (conversations.length === 0) {
    const emptyItem = createElement('li', { class: 'conversation-item empty' },
      createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' },
        createElement('path', { d: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' })
      ),
      createElement('p', {}, 'No conversations yet. Start a new chat!')
    );
    elements.list.appendChild(emptyItem);
    return;
  }

  const fragment = document.createDocumentFragment();

  conversations.forEach(conv => {
    const item = createConversationElement(conv);
    fragment.appendChild(item);
  });

  elements.list.appendChild(fragment);
  updateSelection();
}

function createConversationElement(conv) {
  const isSelected = conv.id === selectedConversationId;
  const initial = getInitial(conv.title);

  const item = createElement('li', {
    class: `conversation-item${isSelected ? ' selected' : ''}`,
    'data-id': conv.id,
    role: 'option',
    'aria-selected': isSelected,
    tabindex: 0,
  });

  item.innerHTML = `
    <div class="conversation-avatar">${escapeHtml(initial)}</div>
    <div class="conversation-content">
      <div class="conv-title">${escapeHtml(conv.title || 'Untitled')}</div>
      <div class="conv-preview">${escapeHtml(conv.preview || 'No messages yet')}</div>
      <div class="conv-meta">
        <span class="conv-model">${escapeHtml(conv.model || 'unknown')}</span>
        <span class="conv-time">${formatDate(conv.updatedAt)}</span>
      </div>
    </div>
  `;

  // Click to select
  item.addEventListener('click', () => selectConversation(conv.id));

  // Keyboard navigation
  item.addEventListener('keydown', (e) => handleItemKeydown(e, conv.id));

  // Context menu (right-click)
  item.addEventListener('contextmenu', (e) => showContextMenu(e, conv));

  return item;
}

function getInitial(title) {
  if (!title) return '?';
  const words = title.trim().split(/\s+/);
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// Search
// ============================================================================

async function handleSearch(query) {
  const trimmed = query.trim();

  if (!trimmed) {
    // Show all conversations
    isSearching = false;
    await loadConversations();
    return;
  }

  isSearching = true;

  try {
    const result = await kayAPI.conversations.search(trimmed);
    if (result.conversations) {
      conversations = result.conversations;
      renderConversations();
    }
  } catch (error) {
    console.error('[Sidebar] Search failed:', error);
  }
}

// ============================================================================
// Conversation Actions
// ============================================================================

export async function createNewConversation(title = 'New Chat', model = null) {
  try {
    const result = await kayAPI.conversations.create(title, model);
    if (result.conversation) {
      conversations.unshift({
        id: result.conversation.id,
        title: result.conversation.title,
        model: result.conversation.model,
        messageCount: 0,
        createdAt: result.conversation.createdAt,
        updatedAt: result.conversation.updatedAt,
        preview: 'No messages yet',
      });
      renderConversations();
      selectConversation(result.conversation.id);
      return result.conversation;
    } else if (result.error) {
      showToast(result.error, 'error');
    }
  } catch (error) {
    console.error('[Sidebar] Create conversation failed:', error);
    showToast('Failed to create conversation', 'error');
  }
  return null;
}

export function selectConversation(id) {
  if (selectedConversationId === id) return;

  selectedConversationId = id;
  updateSelection();

  // Notify app to load messages
  window.dispatchEvent(new CustomEvent('conversation:selected', {
    detail: { conversationId: id }
  }));
}

function updateSelection() {
  $$('.conversation-item', elements.list).forEach(item => {
    const id = item.dataset.id;
    const isSelected = id === selectedConversationId;
    toggleClass(item, 'selected', isSelected);
    item.setAttribute('aria-selected', isSelected);
  });
}

export function getSelectedConversationId() {
  return selectedConversationId;
}

export async function renameConversation(id, newTitle) {
  try {
    const result = await kayAPI.conversations.update(id, { title: newTitle });
    if (result.success) {
      const conv = conversations.find(c => c.id === id);
      if (conv) conv.title = newTitle;
      renderConversations();
      showToast('Conversation renamed', 'success');
    } else if (result.error) {
      showToast(result.error, 'error');
    }
  } catch (error) {
    console.error('[Sidebar] Rename failed:', error);
    showToast('Failed to rename conversation', 'error');
  }
}

export async function deleteConversation(id) {
  if (!confirm('Delete this conversation? This cannot be undone.')) return;

  try {
    const result = await kayAPI.conversations.delete(id);
    if (result.success) {
      conversations = conversations.filter(c => c.id !== id);
      if (selectedConversationId === id) {
        selectedConversationId = null;
        window.dispatchEvent(new CustomEvent('conversation:deleted', { detail: { id } }));
      }
      renderConversations();
      showToast('Conversation deleted', 'success');
    } else if (result.error) {
      showToast(result.error, 'error');
    }
  } catch (error) {
    console.error('[Sidebar] Delete failed:', error);
    showToast('Failed to delete conversation', 'error');
  }
}

export async function exportConversation(id) {
  try {
    const result = await kayAPI.conversations.export(id);
    if (result.success) {
      showToast(`Exported to ${result.path}`, 'success');
    } else if (result.canceled) {
      // User canceled, do nothing
    } else if (result.error) {
      showToast(result.error, 'error');
    }
  } catch (error) {
    console.error('[Sidebar] Export failed:', error);
    showToast('Failed to export conversation', 'error');
  }
}

// ============================================================================
// Context Menu
// ============================================================================

let contextMenu = null;

function showContextMenu(event, conv) {
  event.preventDefault();
  removeContextMenu();

  contextMenu = createElement('div', { class: 'context-menu' },
    createElement('div', { class: 'context-menu-item', onclick: () => handleRename(conv) }, 'Rename'),
    createElement('div', { class: 'context-menu-item', onclick: () => handleExport(conv) }, 'Export'),
    createElement('div', { class: 'context-menu-separator' }),
    createElement('div', { class: 'context-menu-item danger', onclick: () => handleDelete(conv) }, 'Delete')
  );

  document.body.appendChild(contextMenu);

  // Position menu
  const rect = contextMenu.getBoundingClientRect();
  let x = event.clientX;
  let y = event.clientY;

  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;

  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', removeContextMenu, { once: true });
  }, 0);
}

function removeContextMenu() {
  if (contextMenu) {
    contextMenu.remove();
    contextMenu = null;
  }
}

function handleRename(conv) {
  removeContextMenu();
  const newTitle = prompt('Enter new title:', conv.title);
  if (newTitle && newTitle.trim() && newTitle !== conv.title) {
    renameConversation(conv.id, newTitle.trim());
  }
}

function handleExport(conv) {
  removeContextMenu();
  exportConversation(conv.id);
}

function handleDelete(conv) {
  removeContextMenu();
  deleteConversation(conv.id);
}

// ============================================================================
// Keyboard Navigation
// ============================================================================

function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    if (e.target === elements.search) return; // Don't interfere with search input

    const items = $$('.conversation-item:not(.empty)', elements.list);
    if (items.length === 0) return;

    const currentIndex = Array.from(items).findIndex(el => el.dataset.id === selectedConversationId);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        const nextIndex = currentIndex >= 0 ? Math.min(currentIndex + 1, items.length - 1) : 0;
        selectConversation(items[nextIndex].dataset.id);
        items[nextIndex].focus();
        break;

      case 'ArrowUp':
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        selectConversation(items[prevIndex].dataset.id);
        items[prevIndex].focus();
        break;

      case 'Enter':
        if (currentIndex >= 0) {
          e.preventDefault();
          items[currentIndex].click();
        }
        break;

      case 'Delete':
        if (currentIndex >= 0) {
          e.preventDefault();
          deleteConversation(items[currentIndex].dataset.id);
        }
        break;

      case 'Escape':
        elements.search?.focus();
        break;
    }
  });
}

function handleItemKeydown(event, id) {
  switch (event.key) {
    case 'Enter':
    case ' ':
      event.preventDefault();
      selectConversation(id);
      break;
    case 'F2':
      event.preventDefault();
      const conv = conversations.find(c => c.id === id);
      if (conv) handleRename(conv);
      break;
  }
}

// ============================================================================
// Public API
// ============================================================================

export function refresh() {
  loadConversations();
}

export function clearSearch() {
  if (elements.search) {
    elements.search.value = '';
    handleSearch('');
  }
}

export default {
  init: initSidebar,
  createNewConversation,
  selectConversation,
  getSelectedConversationId,
  renameConversation,
  deleteConversation,
  exportConversation,
  refresh,
  clearSearch,
};