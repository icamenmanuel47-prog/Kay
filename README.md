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

- Node.js 22+ (Node 20 reached end of life in April 2026; Electron 44 bundles Node 22.x)
- Windows x64 (the packaged target is NSIS)
- An [OpenRouter API key](https://openrouter.ai/keys)

## Getting started

```bash
npm install       # uiohook-napi ships prebuilds, so no compiler toolchain is needed
npm start         # launch the app
npm run dev       # launch with DevTools open
```

On first launch, open **Settings** and paste your OpenRouter API key. It is encrypted
at rest with Electron's `safeStorage` (DPAPI on Windows) and is never sent to the
renderer.

## Tests

```bash
npm test
```

Runs `node --test` — no Electron, network, or display required (the Electron API is
stubbed in `tests/helpers/electron-shim.mjs`).

109 tests cover the real modules rather than reimplementations of them:
conversation persistence (auto-titling, preview, streaming writes, path-traversal
ids, corrupt files), settings (API-key encryption and renderer masking, coalesced
change notifications), OpenRouter request building and `chat:stream` argument
validation, the pure logic behind hotkeys, navigation classification and throttling,
Markdown/LaTeX rendering with sanitization, and a contract test that the preload API
matches what the renderer calls and what the main process sends.

## Packaging

```bash
npm run pack    # unpacked build into dist/ (fast, for local smoke-testing)
npm run dist    # NSIS installer into dist/
```

Build configuration lives in [`electron-builder.json`](electron-builder.json).

### Releases and updates

Pushing a `v*` tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml),
which builds the installer and publishes it to a GitHub Release:

```bash
git tag v1.2.0
git push origin v1.2.0
```

A packaged build reads that release feed (via the generated `app-update.yml`) and
updates itself: **Settings → Check for Updates** downloads in the background, and the
update installs the next time you quit Kay. Update checks only work from an installed
build — running `npm start` from source has no update feed and says so.

> **SmartScreen warning.** Builds are **unsigned** — no code-signing certificate is
> configured. Windows will therefore show "Windows protected your PC" on first run of
> the installer. Choose **More info → Run anyway**. This is expected for unsigned
> software, not a sign of tampering; signing removes it.

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
    hotkey-logic.js, navigation.js, throttle.js, conversation-fields.js
                   pure helpers (no Electron imports, unit-tested directly)
  preload/
    index.js       contextBridge — the only surface the renderer can touch
  renderer/
    index.html
    scripts/       app, chat, sidebar, settings, markdown, utils, window-resize
    styles/        main, components, markdown
    vendor/        marked, DOMPurify, KaTeX, highlight.js (bundled for offline use;
                   the npm copies of these are test-only dependencies)
tests/           node --test suites (+ helpers/electron-shim.mjs)
.github/workflows/  CI (cross-platform tests + packaging) and Release (tag -> GitHub Release)
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
