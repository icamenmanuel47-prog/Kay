# Kay

A personal desktop assistant for civil engineering students. Kay lives in your system
tray as a frameless, always-on-top overlay, so you can ask a question without leaving
whatever you're working on.

It talks to [OpenRouter](https://openrouter.ai), so you can pick from hundreds of
models — including free ones — and switch mid-conversation.

## Features

- **Overlay window** — frameless, always-on-top, adjustable opacity and size.
- **Global hotkey** — `Ctrl+Shift+M` toggles the window from anywhere (configurable).
- **System tray** — turn Kay on/off, open settings, check for updates, quit.
- **Streaming responses** — tokens render as they arrive, with cancel support.
- **Conversation history** — chats are saved as JSON, searchable, and exportable to Markdown.
- **Images** — paste or attach a screenshot and ask about it.
- **Math & code** — LaTeX via KaTeX, syntax highlighting via highlight.js.
- **Model picker** — search, filter to free models, and star favourites.
- **Domain-aware tutor prompt** — ships with a system prompt tuned for structural
  theory: givens and assumptions first, principles named, step-by-step substitution
  with units, equilibrium and reasonableness checks, and a clearly stated final answer.

## Requirements

- Node.js 18+ (20+ recommended)
- Windows x64 (the packaged target is NSIS)
- An [OpenRouter API key](https://openrouter.ai/keys)

## Getting started

```bash
npm install     # also rebuilds native deps for Electron via postinstall
npm start       # launch the app
npm run dev     # launch with DevTools open
```

On first launch, open **Settings** and paste your OpenRouter API key. It is encrypted
at rest with Electron's `safeStorage` (DPAPI on Windows) and is never sent to the
renderer.

## Tests

```bash
npm test
```

Runs `node --test` against `tests/*.test.mjs` — no Electron or network required.
Covered: Markdown/LaTeX rendering, DOMPurify XSS handling, multi-turn request
building and history capping, settings defaults, and the preload API contract.

## Packaging

```bash
npm run pack    # unpacked build into dist/ (fast, for local smoke-testing)
npm run dist    # NSIS installer into dist/
```

Build configuration lives in [`electron-builder.json`](electron-builder.json).

## Project layout

```
src/
  main/          Electron main process
    index.js       app lifecycle, single-instance lock, navigation guards
    window.js      frameless overlay creation, bounds/opacity/always-on-top
    tray.js        tray icon and context menu
    hotkey.js      global hotkey (uiohook-napi, falling back to globalShortcut)
    settings.js    electron-store settings + safeStorage API-key encryption
    conversations.js  JSON chat persistence, export, search
    openrouter.js  OpenRouter chat completions, streaming, model list
    ipc.js         IPC handler registration
    updater.js     electron-updater wiring
  preload/
    index.js       contextBridge — the only surface the renderer can touch
  renderer/
    index.html
    scripts/       app, chat, sidebar, settings, markdown, utils, window-resize
    styles/        main, components, markdown
    vendor/        marked, DOMPurify, KaTeX, highlight.js (bundled for offline use)
tests/           node --test suites
build/           icon and installer assets
```

## Where your data lives

Chats and settings are stored under Electron's `userData` directory:

```
<userData>/kay/conversations/*.json   # one file per chat
<userData>/kay-settings.json          # settings (API key encrypted)
```

On Windows that is typically `%APPDATA%/kay/`. Use **Settings → Open data folder**
to jump there, or **Reset all data** to wipe it.

## Security notes

- Renderer runs with `contextIsolation`, `sandbox`, and no `nodeIntegration`.
- Navigation and `window.open` are blocked; external links open in your browser.
- Rendered Markdown is sanitized with DOMPurify before insertion.
- The API key is encrypted at rest and masked before crossing IPC.

## License

MIT
