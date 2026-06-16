# WMPFDebugger — Project Context

## Project Overview

WMPFDebugger is a Windows WeChat Mini Program (小程序) debugger. It exploits the Remote Debug feature provided by WeChat DevTools (wechatdevtools) and patches several restrictions to force the mini program runtime to support full Chrome DevTools Protocol (CDP), enabling standard Chromium-based browser DevTools to debug any WeChat mini program.

The debug protocol used by WMPF is a proprietary protocol based on **Protobuf**. The tool reverse-engineers the protocol from wechatdevtools and implements a translation layer that converts the mini program debug protocol to standard CDP.

**Author:** evi0s
**License:** GPLv2

### Supported WMPF Versions

| Version | Status |
|---------|--------|
| 14199 | Latest, stable |
| 14161 | Stable |
| 13909 | Stable |
| 13871 | Stable |
| 13655 | Older, stable |
| 13639 | Older, stable |
| 13487 | Older, stable |
| 13341 | Older, stable |
| 13331 | Older, stable |
| 11633 | Older, stable |
| 11581 | Unstable (connects but crashes renderer) |

> Currently only mini program component is supported (not built-in browser pages).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | **TypeScript** (strict mode, ES2020 target) |
| Runtime | **Node.js** (LTS v22+) |
| Process Injection | **Frida** (v17.x) — dynamic instrumentation |
| Protocol | **Protobuf** (protobufjs v8.x) — custom WeChat debug protocol |
| Transport | **WebSocket** (ws v8.x) — CDP proxy |
| Desktop GUI | **Electron** (v42.x) |
| Package Manager | **yarn** |
| Bundler | **electron-builder** — NSIS installer for Windows x64 |

### Key Dependencies

- `frida` — Process injection and hooking
- `protobufjs` — Protobuf encode/decode for custom WeChat debug protocol
- `ws` — WebSocket server for CDP proxy
- `ts-node` / `typescript` — TypeScript execution and compilation
- `electron` — Desktop GUI shell
- `electron-builder` — Build and packaging

---

## Project Structure

```
WMPFDebugger/
├── src/                          # Main source code
│   ├── index.ts                  # Core: debug server, CDP proxy, Frida injection
│   ├── desktop/                  # Electron desktop app
│   │   ├── main.ts               # Electron main process
│   │   ├── preload.ts            # Electron preload (context bridge)
│   │   ├── bootstrap.js          # Electron bootstrap entry
│   │   └── renderer/             # Renderer UI
│   │       └── index.html        # Desktop UI (HTML/CSS/JS)
│   └── third-party/              # Extracted from wechatdevtools (Tencent copyright)
│       ├── RemoteDebugCodex.js         # Debug message wrapping/unwrapping
│       ├── RemoteDebugConstants.js     # Protocol constants
│       ├── RemoteDebugUtils.js         # Protocol utilities
│       └── WARemoteDebugProtobuf.js    # Protobuf definitions
├── frida/                        # Frida instrumentation scripts
│   ├── hook.js                   # Main hook script injected into WMPF runtime
│   └── config/                   # Version-specific offset configurations
│       └── addresses.<version>.json
├── screenshots/                  # Screenshots for README
│   ├── console.png
│   ├── sources.png
│   └── adaptation/               # ADAPTATION guide screenshots
├── scripts/                      # Utility scripts (empty)
├── release/                      # Build output (gitignored)
├── package.json                  # Project config & build scripts
├── tsconfig.json                 # TypeScript configuration
├── ADAPTATION.md                 # Guide for adapting to new WMPF versions
└── AGENTS.md                     # This file
```

---

## Architecture

The system consists of three major components working together:

### 1. Frida Injection (`frida/hook.js`)

Injected into `WeChatAppEx.exe` (or `flue.dll` for newer versions) to hook three critical functions:

- **`AppletIndexContainer::OnLoadStart`** — Patches the scene number to force mini programs into Remote Debug mode. Uses a configurable offset and scene detection with fallback scanning.
- **`SendToClientFilter` (CDP Filter)** — Removes CDP message filtering restrictions (patches v216 value from 6 to 0).
- **Resource Cache Policy** — Forces resource cache policy to return 0, ensuring all source files appear in DevTools.

Configurations are version-specific and stored in `frida/config/addresses.<version>.json`.

### 2. Debug Server (`src/index.ts`)

Runs two WebSocket servers:

- **Debug Server (port 9421)** — Receives raw debug messages from the mini program runtime via the Frida-injected connection. Decodes Protobuf messages and translates them to standard CDP format.
- **CDP Proxy (port 62000)** — Exposes standard CDP over WebSocket for browser DevTools to connect to (`devtools://devtools/bundled/inspector.html?ws=127.0.0.1:62000`).

Message flow:
```
Miniapp Runtime -> [Frida Hook] -> Debug Server (port 9421)
    -> Protobuf decode -> CDP translation -> CDP Proxy (port 62000)
    -> Browser DevTools
```

### 3. Electron Desktop App (`src/desktop/`)

Provides a GUI wrapper with:
- Real-time server status indicators (Debug Server, CDP Proxy, Frida)
- Configurable port settings with apply/restart
- Log output console
- CDP URL display with copy functionality
- Frida error state display

---

## Building and Running

### Prerequisites

- Node.js (LTS v22+)
- yarn package manager
- Chromium-based browser (Chrome, Edge, etc.)

### Quick Start

```bash
# Install dependencies
yarn

# Run CLI mode (debug server + CDP proxy + Frida injection)
npx ts-node src/index.ts
# or: yarn start

# Run Desktop GUI mode
yarn start:desktop
# Development mode with DevTools open:
yarn dev:desktop
```

### Usage Steps

1. Run the server (`yarn start` or `yarn start:desktop`)
2. Launch a WeChat mini program
3. Open browser at `devtools://devtools/bundled/inspector.html?ws=127.0.0.1:62000`

> **Important:** Launch the mini program BEFORE opening DevTools. Reverse order may require restarting the server.

### Building for Distribution

```bash
# Package to directory (unpacked)
yarn pack

# Build NSIS installer
yarn dist
```

Output goes to `release/` directory.

---

## Development Conventions

### Code Style

- **TypeScript strict mode** enabled in `tsconfig.json`
- **ES2020** target with Node module resolution
- **No JavaScript** in source (`allowJs: false`)
- Uses `const`/`let` (no `var`)
- Named exports preferred over default exports
- Async/await pattern for async operations

### Project Conventions

- Version-specific Frida hook addresses stored in separate JSON config files
- Third-party code from wechatdevtools kept in `src/third-party/` (not type-checked, excluded from TS compilation)
- Debug logging gated by `DEBUG` flag (false by default)
- Frida hook script uses `@@CONFIG@@` placeholder replaced at runtime with version config
- TypeScript `noEmit: true` — execution via `ts-node`, not pre-compilation

### Testing

No formal test framework detected. Testing is manual (run the tool against a live WeChat mini program).

### Adaptation to New WMPF Versions

See `ADAPTATION.md` for detailed reverse-engineering instructions. To add support for a new WMPF version:

1. Reverse engineer the three hook offsets using a disassembler
2. Create a new `frida/config/addresses.<version>.json` config file
3. The hook script auto-detects the version from the process path

---

## Key Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | npm scripts, dependencies, electron-builder config |
| `tsconfig.json` | TypeScript compiler options |
| `frida/hook.js` | Main Frida injection script |
| `frida/config/*.json` | Version-specific hook offsets |
| `src/index.ts` | Core server logic |
| `src/desktop/main.ts` | Electron desktop main process |

---

## Important Notes

- **Third-party code** in `src/third-party/` is extracted from wechatdevtools and fully copyrighted by Tencent Holdings Ltd.
- The tool is for **educational purposes only**. Use at your own risk.
- WMPF version can be found in Task Manager -> WeChatAppEx -> Open file location -> Number between `RadiumWMPF` and `extracted`.
- The `release/` directory and `node_modules/` are gitignored.