import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  onLog: (callback: (msg: string) => void) => {
    ipcRenderer.on("log", (_event, msg: string) => callback(msg));
  },
  onState: (callback: (state: any) => void) => {
    ipcRenderer.on("state", (_event, state: any) => callback(state));
  },
  getState: () => ipcRenderer.invoke("get-state"),
  getPorts: () => ipcRenderer.invoke("get-ports"),
  getSupportedWmpfVersions: () => ipcRenderer.invoke("get-supported-wmpf-versions"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  openUpdateUrl: (url: string) => ipcRenderer.invoke("open-update-url", url),
  downloadUpdate: (url: string) => ipcRenderer.invoke("download-update", url),
  onUpdateDownloadProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("update-download-progress", (_event, progress: any) => callback(progress));
  },
  restartServers: (debugPort: number, cdpPort: number, wmpfVersion?: number) => {
    return ipcRenderer.invoke("restart-servers", debugPort, cdpPort, wmpfVersion);
  },
});
