const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onLog: (callback) => {
    ipcRenderer.on("log", (_event, msg) => callback(msg));
  },
  onState: (callback) => {
    ipcRenderer.on("state", (_event, state) => callback(state));
  },
  getState: () => ipcRenderer.invoke("get-state"),
  getPorts: () => ipcRenderer.invoke("get-ports"),
  restartServers: (debugPort, cdpPort) => ipcRenderer.invoke("restart-servers", debugPort, cdpPort),
});