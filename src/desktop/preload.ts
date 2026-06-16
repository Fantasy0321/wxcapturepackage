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
  restartServers: (debugPort: number, cdpPort: number, wmpfVersion?: number) => {
    return ipcRenderer.invoke("restart-servers", debugPort, cdpPort, wmpfVersion);
  },
});
