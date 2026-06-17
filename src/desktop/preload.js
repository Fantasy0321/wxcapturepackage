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
  getSupportedWmpfVersions: () => ipcRenderer.invoke("get-supported-wmpf-versions"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  openUpdateUrl: (url) => ipcRenderer.invoke("open-update-url", url),
  downloadUpdate: (url) => ipcRenderer.invoke("download-update", url),
  onUpdateDownloadProgress: (callback) => {
    ipcRenderer.on("update-download-progress", (_event, progress) => callback(progress));
  },
  restartServers: (debugPort, cdpPort, wmpfVersion) => ipcRenderer.invoke("restart-servers", debugPort, cdpPort, wmpfVersion),
});
