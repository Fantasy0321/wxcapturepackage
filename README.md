# WMPFDebugger — 项目上下文

## 项目概览

WMPFDebugger 是一款 Windows 微信小程序调试工具。它利用微信开发者工具 (wechatdevtools) 提供的远程调试 (Remote Debug) 功能，通过 patch 多项限制，强制小程序运行时支持完整的 Chrome DevTools Protocol (CDP)，从而允许标准 Chromium 浏览器开发者工具调试任意微信小程序。

WMPF 使用的调试协议是基于 **Protobuf** 的私有协议。该工具逆向分析了 wechatdevtools 的协议实现，并实现了一个转换层，将小程序调试协议转换为标准 CDP。

**核心程序作者:** evi0s（`src/index.ts`、`frida/hook.js` 及核心逻辑）
**桌面集成作者:** funny（`src/desktop/` 下的 Electron 桌面应用）
**许可证:** GPLv2（LICENSE 文件声明为 GPLv2，package.json 中标注为 MIT，以 LICENSE 文件为准）

### 支持的 WMPF 版本

| 版本 | 状态 |
|------|------|
| 25046 | 最新，稳定 |
| 14199 | 稳定 |
| 14161 | 稳定 |
| 13909 | 稳定 |
| 13871 | 稳定 |
| 13655 | 较早，稳定 |
| 13639 | 较早，稳定 |
| 13487 | 较早，稳定 |
| 13341 | 较早，稳定 |
| 13331 | 较早，稳定 |
| 11633 | 较早，稳定 |
| 11581 | 不稳定（可连接，但渲染进程会崩溃） |

> 目前仅支持小程序组件，不支持内建浏览器页面。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | **TypeScript** (严格模式, ES2020 目标) |
| 运行时 | **Node.js** (LTS v22+) |
| 进程注入 | **Frida** (v17.x) — 动态插桩 |
| 协议 | **Protobuf** (protobufjs v8.x) — 自定义微信调试协议 |
| 传输层 | **WebSocket** (ws v8.x) — CDP 代理 |
| 桌面 GUI | **Electron** (v42.x) |
| 包管理器 | **yarn** |
| 打包工具 | **electron-builder** — Windows x64 NSIS 安装包 |

### 关键依赖

- `frida` — 进程注入与 Hook
- `protobufjs` — Protobuf 编码/解码（自定义微信调试协议）
- `ws` — CDP 代理 WebSocket 服务器
- `ts-node` / `typescript` — TypeScript 执行与编译
- `electron` — 桌面 GUI 外壳
- `electron-builder` — 构建与打包

---

## 项目结构

```
WMPFDebugger/
├── src/                              # 主要源代码
│   ├── index.ts                      # 核心：调试服务器、CDP 代理、Frida 注入
│   ├── desktop/                      # Electron 桌面应用（作者: funny）
│   │   ├── main.ts                   # Electron 主进程
│   │   ├── preload.ts                # Electron preload 脚本（上下文桥接）
│   │   ├── preload.js                # preload 编译产物（bootstrap 入口引用）
│   │   ├── bootstrap.js              # Electron 启动入口
│   │   ├── tsconfig.desktop.json     # Electron 专用 TS 配置（继承根目录 tsconfig）
│   │   └── renderer/                 # 渲染进程 UI
│   │       └── index.html            # 桌面 UI（HTML/CSS/JS）
│   └── third-party/                  # 从 wechatdevtools 提取（腾讯版权）
│       ├── RemoteDebugCodex.js       # 调试消息封装/解封
│       ├── RemoteDebugConstants.js   # 协议常量
│       ├── RemoteDebugUtils.js       # 协议工具函数
│       └── WARemoteDebugProtobuf.js  # Protobuf 定义
├── frida/                            # Frida 插桩脚本
│   ├── hook.js                       # 注入到 WMPF 运行时的主 Hook 脚本
│   └── config/                       # 版本特定的偏移量配置
│       ├── addresses.11581.json
│       ├── addresses.11633.json
│       ├── addresses.13331.json
│       ├── addresses.13341.json
│       ├── addresses.13487.json
│       ├── addresses.13639.json
│       ├── addresses.13655.json
│       ├── addresses.13871.json
│       ├── addresses.13909.json
│       ├── addresses.14161.json
│       ├── addresses.14199.json
│       └── addresses.25046.json
├── screenshots/                      # 截图
│   ├── console.png
│   ├── sources.png
│   └── adaptation/                   # ADAPTATION 指南截图
│       ├── cdp_filter_hook.1.png
│       ├── cdp_filter_hook.2.png
│       ├── cdp_filter_hook.3.png
│       ├── onload_start_hook.1.png
│       ├── onload_start_hook.2.png
│       ├── onload_start_hook.3.png
│       ├── resource_cache_hook.1.png
│       └── resource_cache_hook.2.png
├── scripts/                          # 工具脚本（当前为空）
├── release/                          # 构建输出（gitignored）
├── package.json                      # 项目配置与构建脚本
├── tsconfig.json                     # TypeScript 编译配置
├── ADAPTATION.md                     # 适配新 WMPF 版本的指南
└── README.md                         # 本文档
```

---

## 架构

系统由三个主要组件协同工作：

### 1. Frida 注入 (`frida/hook.js`)

注入到 `WeChatAppEx.exe`（较新版本为 `flue.dll`），Hook 三个关键函数：

- **`AppletIndexContainer::OnLoadStart`** — 修改场景编号 (scene)，强制小程序进入远程调试模式。使用可配置的偏移量和场景检测，带 fallback 扫描。
- **`SendToClientFilter`（CDP 过滤器）** — 解除 CDP 消息过滤限制（将 v216 值从 6 patch 为 0）。
- **资源缓存策略** — 强制资源缓存策略返回 0，确保所有源文件出现在 DevTools 中。

配置项按版本区分，存储在 `frida/config/addresses.<version>.json` 中。

### 2. 调试服务器 (`src/index.ts`)

运行两个 WebSocket 服务器：

- **调试服务器（端口 9421）** — 通过 Frida 注入的连接接收小程序运行时的原始调试消息。解码 Protobuf 消息并转换为标准 CDP 格式。
- **CDP 代理（端口 62000）** — 通过 WebSocket 暴露标准 CDP，供浏览器 DevTools 连接（`devtools://devtools/bundled/inspector.html?ws=127.0.0.1:62000`）。

消息流：
```
小程序运行时 -> [Frida Hook] -> 调试服务器 (端口 9421)
    -> Protobuf 解码 -> CDP 转换 -> CDP 代理 (端口 62000)
    -> 浏览器 DevTools
```

### 3. Electron 桌面应用 (`src/desktop/`)（作者: funny）

提供 GUI 包装，包含：
- 实时服务器状态指示器（调试服务器、CDP 代理、Frida）
- 可配置端口号，支持应用/重启
- 日志输出控制台
- CDP URL 显示与复制功能
- Frida 错误状态显示

---

## 构建与运行

### 前置条件

- Node.js (LTS v22+)
- yarn 包管理器
- Chromium 浏览器（Chrome、Edge 等）

### 快速启动

```bash
# 安装依赖
yarn

# CLI 模式运行（调试服务器 + CDP 代理 + Frida 注入）
yarn start

# 桌面 GUI 模式运行
yarn start:desktop

# 开发模式（打开 DevTools）
yarn dev:desktop
```

### 使用步骤

1. 运行服务器（`yarn start` 或 `yarn start:desktop`）
2. 打开任意微信小程序
3. 浏览器访问 `devtools://devtools/bundled/inspector.html?ws=127.0.0.1:62000`

> **重要：** 先启动小程序，再打开 DevTools。操作顺序反了可能需要重启服务器。

### 发布构建

```bash
# 打包到目录（解压版）
yarn pack

# 构建 NSIS 安装包
yarn dist
```

输出文件位于 `release/` 目录。

---

## 开发规范

### 代码风格

- **TypeScript 严格模式** 在 `tsconfig.json` 中启用
- **ES2020** 目标，Node 模块解析
- **禁止 JavaScript** 源文件（`allowJs: false`）
- 使用 `const`/`let`（不使用 `var`）
- 优先使用命名导出而非默认导出
- 异步操作使用 async/await 模式

### 项目约定

- 版本特定的 Frida Hook 地址存储在独立的 JSON 配置文件中
- 来自 wechatdevtools 的第三方代码放在 `src/third-party/` 目录（不进行类型检查，排除在 TS 编译之外）
- 调试日志由 `DEBUG` 标志控制（默认关闭）
- Frida Hook 脚本使用 `@@CONFIG@@` 占位符，运行时替换为版本配置
- TypeScript 配置 `noEmit: true` — 通过 `ts-node` 直接执行，不预先编译

### 测试

当前没有正式的测试框架。测试方式为手动（对真实微信小程序运行该工具）。

### 适配新 WMPF 版本

详细逆向工程说明参见 `ADAPTATION.md`。添加新 WMPF 版本支持的步骤：

1. 使用反汇编工具逆向分析三个 Hook 函数的偏移量
2. 创建新的 `frida/config/addresses.<version>.json` 配置文件
3. Hook 脚本会自动从进程路径中检测版本号

---

## TypeScript 配置说明

### 根目录 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "es2020",
    "lib": ["es2020", "ES2021.String"],
    "moduleResolution": "Node",
    "noEmit": true,
    "esModuleInterop": true,
    "allowJs": false,
    "strict": true,
    "skipLibCheck": true,
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules/*", "src/third-party/*"]
}
```

### Electron 专用配置 `src/desktop/tsconfig.desktop.json`

继承根目录配置，将 `rootDir` 重设为 `src`，覆盖 Electron 的模块解析上下文。

---

## 关键配置文件

| 文件 | 用途 |
|------|------|
| `package.json` | npm 脚本、依赖、electron-builder 配置 |
| `tsconfig.json` | TypeScript 编译器选项 |
| `frida/hook.js` | 主 Frida 注入脚本 |
| `frida/config/*.json` | 版本特定的 Hook 偏移量 |
| `src/index.ts` | 核心服务器逻辑 |
| `src/desktop/main.ts` | Electron 主进程 |

---

## 常见问题排查

### 启动后 DevTools 无内容显示
- 确保已先启动小程序，再打开 DevTools 页面
- 检查 CDP 代理端口 (62000) 是否被其他程序占用
- 重启服务器并重试

### Frida 注入失败
- 确认微信进程正在运行（WeChatAppEx.exe）
- 确认小程序已打开
- 检查 Frida 版本是否兼容（v17.x）
- 查看控制台日志中的 Frida 错误信息

### 不支持当前 WMPF 版本
- 检查任务管理器中 WeChatAppEx 进程所在路径，获取 WMPF 版本号
- 查看 `frida/config/` 目录下是否有对应版本的配置文件
- 如无，请参考 `ADAPTATION.md` 自行适配或提交 Issue

### 协议转换异常
- 切换 `src/index.ts` 中的 `DEBUG` 标志为 `true`，启用详细日志
- 检查 Protobuf 消息是否有解码错误

---

## 重要说明

### 第三方代码版权

`src/third-party/` 目录下的代码提取自微信开发者工具（wechatdevtools），**腾讯控股有限公司**拥有对该代码的完整版权。

### 免责声明

**本工具仅用于学习和教育目的，造成的任何问题与开发者无关。如侵犯到你的权益，请联系删除。**

该程序以 GPLv2 许可证开源，参考许可证第十一及十二条：

本程序为免费授权，故在适用法律范围内不提供品质担保。除非另作书面声明，版权持有人及其他程式提供者"概"不提供任何显式或隐式的品质担保，品质担保所指包括而不仅限于有经济价值和适合特定用途的保证。全部风险，如程序的质量和性能问题，皆由你承担。若程序出现缺陷，你将承担所有必要的修复和更正服务的费用。

除非适用法律或书面协议要求，任何版权持有人或本程序按本协议可能存在的第三方修改和再发布者，都不对你的损失负有责任，包括由于使用或者不能使用本程序造成的任何一般的、特殊的、偶发的或重大的损失（包括而不仅限于数据丢失、数据失真、你或第三方的后续损失、其他程序无法与本程序协同运作），即使那些人声称会对此负责。

### 版本查看方法

打开任务管理器 -> 找到 WeChatAppEx 进程 -> 右键打开文件所在位置 -> 查找 `RadiumWMPF` 和 `extracted` 之间的数字即为 WMPF 版本号。

### Git 忽略规则

`release/` 目录和 `node_modules/` 被 gitignore 忽略。