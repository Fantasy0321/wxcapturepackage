import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { WebSocketServer } from "ws";
import {
  main as startServers,
  DEBUG_PORT,
  CDP_PORT,
  ServerConfig,
} from "../index";

let mainWindow: BrowserWindow | null = null;
let debugWss: WebSocketServer | null = null;
let cdpWss: WebSocketServer | null = null;

const serverState = {
  debugServer: false,
  cdpProxy: false,
  frida: false,
  fridaError: "",
};

function sendLog(message: string) {
  mainWindow?.webContents.send("log", message);
}

function sendState() {
  mainWindow?.webContents.send("state", serverState);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    title: "WMPF Debugger",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Override console.log to send to renderer
const originalLog = console.log;
const originalError = console.error;

console.log = (...args: any[]) => {
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  originalLog(...args);
  sendLog(msg);
};

console.error = (...args: any[]) => {
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  originalError(...args);
  sendLog(`[error] ${msg}`);
};

async function startWithConfig(debugPort: number, cdpPort: number) {
  // Close existing servers first
  if (debugWss) {
    debugWss.close();
    debugWss = null;
  }
  if (cdpWss) {
    cdpWss.close();
    cdpWss = null;
  }

  sendLog(`[desktop] Starting servers... debug=${debugPort}, cdp=${cdpPort}`);

  // We need to import and call debug_server/proxy_server directly to get instances.
  // Since they're not exported, we'll use the main function and monkey-patch.
  // Actually, let me re-import the modules.
  const index = require("../index");
  debugWss = index.debug_server?.(debugPort) ?? null;
  cdpWss = index.proxy_server?.(cdpPort) ?? null;

  serverState.debugServer = !!debugWss;
  serverState.cdpProxy = !!cdpWss;

  try {
    if (index.frida_server) {
      await index.frida_server();
      serverState.frida = true;
      serverState.fridaError = "";
    }
  } catch (e: any) {
    serverState.frida = false;
    serverState.fridaError = e.message;
    sendLog(`[error] [frida] ${e.message}`);
  }

  sendLog(`[desktop] All servers started successfully`);
  sendState();
}

app.whenReady().then(async () => {
  createWindow();
  await startWithConfig(DEBUG_PORT, CDP_PORT);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC handlers
ipcMain.handle("get-state", () => serverState);
ipcMain.handle("get-ports", () => ({
  debugPort: DEBUG_PORT,
  cdpPort: CDP_PORT,
}));

ipcMain.handle("restart-servers", async (_event, debugPort: number, cdpPort: number) => {
  await startWithConfig(debugPort, cdpPort);
  return serverState;
});