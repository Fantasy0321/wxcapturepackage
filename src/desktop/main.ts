import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { WebSocketServer } from "ws";
import {
  DEBUG_PORT,
  CDP_PORT,
} from "../index";

let mainWindow: BrowserWindow | null = null;
let debugWss: WebSocketServer | null = null;
let cdpWss: WebSocketServer | null = null;
let currentPorts = {
  debugPort: DEBUG_PORT,
  cdpPort: CDP_PORT,
};
let currentWmpfVersion: number | undefined = undefined;
const GITHUB_REPO = "Fantasy0321/wxcapturepackage";
const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;

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
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

type GitHubReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type GitHubRelease = {
  tag_name: string;
  html_url: string;
  assets?: GitHubReleaseAsset[];
};

type UpdateCheckResult = {
  currentVersion: string;
  latestVersion?: string;
  hasUpdate: boolean;
  releaseUrl?: string;
  downloadUrl?: string;
  error?: string;
};

type DownloadProgress = {
  percent: number;
  transferred: number;
  total?: number;
  status: "downloading" | "completed" | "error";
  filePath?: string;
  error?: string;
};

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "").split(/[+-]/)[0];
}

function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersion(left).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  return 0;
}

function requestJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "Accept": "application/vnd.github+json",
          "User-Agent": `WMPF-Debugger/${app.getVersion()}`,
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`GitHub API returned ${response.statusCode}: ${body}`));
            return;
          }

          try {
            resolve(JSON.parse(body) as T);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.setTimeout(10000, () => {
      request.destroy(new Error("GitHub update check timed out"));
    });
    request.on("error", reject);
  });
}

function pickDownloadUrl(release: GitHubRelease) {
  const assets = release.assets ?? [];
  const installer = assets.find((asset) => asset.name.toLowerCase().endsWith(".exe"));
  const archive = assets.find((asset) => asset.name.toLowerCase().endsWith(".zip"));
  return installer?.browser_download_url ?? archive?.browser_download_url;
}

function getFilenameFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(path.basename(parsed.pathname));
    return name && name !== "/" ? name : "WMPF-Debugger-update.exe";
  } catch {
    return "WMPF-Debugger-update.exe";
  }
}

function getUniqueFilePath(directory: string, filename: string) {
  const parsed = path.parse(filename);
  let candidate = path.join(directory, filename);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }

  return candidate;
}

function sendDownloadProgress(progress: DownloadProgress) {
  mainWindow?.webContents.send("update-download-progress", progress);
}

function downloadUpdateFile(url: string, destinationPath: string, redirects = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("Too many update download redirects"));
      return;
    }

    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const request = client.get(
      parsed,
      {
        headers: {
          "User-Agent": `WMPF-Debugger/${app.getVersion()}`,
          "Accept": "application/octet-stream",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;

        if (status >= 300 && status < 400 && location) {
          response.resume();
          const redirectUrl = new URL(location, parsed).toString();
          downloadUpdateFile(redirectUrl, destinationPath, redirects + 1).then(resolve, reject);
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`Update download failed with HTTP ${status}`));
          return;
        }

        const total = Number.parseInt(String(response.headers["content-length"] ?? ""), 10);
        let transferred = 0;
        const file = fs.createWriteStream(destinationPath);

        response.on("data", (chunk: Buffer) => {
          transferred += chunk.length;
          sendDownloadProgress({
            status: "downloading",
            transferred,
            total: Number.isFinite(total) ? total : undefined,
            percent: Number.isFinite(total) && total > 0 ? Math.round((transferred / total) * 100) : 0,
          });
        });

        response.pipe(file);

        response.on("error", (error) => {
          file.destroy(error);
        });

        file.on("finish", () => {
          file.close(() => resolve(destinationPath));
        });

        file.on("error", (error) => {
          fs.rm(destinationPath, { force: true }, () => reject(error));
        });
      },
    );

    request.setTimeout(30000, () => {
      request.destroy(new Error("Update download timed out"));
    });
    request.on("error", reject);
  });
}

async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();

  try {
    const release = await requestJson<GitHubRelease>(GITHUB_RELEASES_URL);
    const latestVersion = release.tag_name;

    return {
      currentVersion,
      latestVersion,
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      releaseUrl: release.html_url || GITHUB_RELEASES_PAGE,
      downloadUrl: pickDownloadUrl(release),
    };
  } catch (error: any) {
    return {
      currentVersion,
      hasUpdate: false,
      error: error?.message ?? String(error),
    };
  }
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

async function startWithConfig(debugPort: number, cdpPort: number, wmpfVersion?: number) {
  // Close existing servers first
  if (debugWss) {
    debugWss.close();
    debugWss = null;
  }
  if (cdpWss) {
    cdpWss.close();
    cdpWss = null;
  }

  currentPorts = { debugPort, cdpPort };
  currentWmpfVersion = wmpfVersion;

  sendLog(`[desktop] Starting servers... debug=${debugPort}, cdp=${cdpPort}, wmpf=${wmpfVersion ?? "auto"}`);

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
      await index.frida_server({ wmpfVersion });
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
  ...currentPorts,
  wmpfVersion: currentWmpfVersion,
}));
ipcMain.handle("get-supported-wmpf-versions", async () => {
  const index = require("../index");
  return index.listSupportedWmpfVersions?.() ?? [];
});
ipcMain.handle("check-for-updates", () => checkForUpdates());
ipcMain.handle("open-update-url", async (_event, url: string) => {
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Only http(s) update URLs are allowed");
  }

  await shell.openExternal(parsed.toString());
});
ipcMain.handle("download-update", async (_event, url: string) => {
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Only http(s) update URLs are allowed");
  }

  const downloadsPath = app.getPath("downloads");
  const filename = getFilenameFromUrl(parsed.toString());
  const destinationPath = getUniqueFilePath(downloadsPath, filename);

  try {
    sendDownloadProgress({
      status: "downloading",
      transferred: 0,
      percent: 0,
    });
    const filePath = await downloadUpdateFile(parsed.toString(), destinationPath);
    sendDownloadProgress({
      status: "completed",
      transferred: fs.statSync(filePath).size,
      percent: 100,
      filePath,
    });
    shell.showItemInFolder(filePath);
    return { filePath };
  } catch (error: any) {
    fs.rm(destinationPath, { force: true }, () => undefined);
    sendDownloadProgress({
      status: "error",
      transferred: 0,
      percent: 0,
      error: error?.message ?? String(error),
    });
    throw error;
  }
});

ipcMain.handle("restart-servers", async (_event, debugPort: number, cdpPort: number, wmpfVersion?: number) => {
  await startWithConfig(debugPort, cdpPort, wmpfVersion);
  return serverState;
});
