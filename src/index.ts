import { promises } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import * as frida from "frida";
import WebSocket, { WebSocketServer } from "ws";

const codex = require("./third-party/RemoteDebugCodex.js");
const messageProto = require("./third-party/WARemoteDebugProtobuf.js");


class DebugMessageEmitter extends EventEmitter {};


// default debugging port, do not change
export const DEBUG_PORT = 9421;
// CDP port, change to whatever you like
// use this port by navigating to devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${CDP_PORT}
export const CDP_PORT = 62000;
// debug switch
export const DEBUG = false;

const debugMessageEmitter = new DebugMessageEmitter();
let jsContextId = "";

const bufferToHexString = (buffer: ArrayBuffer) => {
    return Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join("");
}

const listSupportedWmpfVersions = async (configDir: string) => {
    try {
        const files = await promises.readdir(configDir);
        const versions = files
            .map(file => file.match(/^addresses\.(\d+)\.json$/)?.[1])
            .filter((version): version is string => version !== undefined)
            .map(Number)
            .sort((a, b) => a - b);
        return versions.length > 0 ? versions.join(", ") : "none";
    } catch {
        return "none";
    }
}

const getCdpMethod = (message: string) => {
    try {
        const parsed = JSON.parse(message);
        return typeof parsed.method === "string" ? parsed.method : `id:${parsed.id ?? "unknown"}`;
    } catch {
        return "non-json";
    }
}

export const debug_server = (port: number = DEBUG_PORT) => {
    const wss = new WebSocketServer({ port });
    console.log(`[server] debug server running on ws://localhost:${port}`);

    let messageCounter = 0;
    const pendingProxyMessages: string[] = [];

    const sendProxyMessageToMiniapp = (client: WebSocket, message: string) => {
        // encode CDP and send to miniapp
        // wrapDebugMessageData(data, category, compressAlgo)
        const rawPayload = {
            jscontext_id: jsContextId,
            op_id: Math.round(100 * Math.random()),
            payload: message.toString()
        };
        DEBUG && console.log(rawPayload);
        const wrappedData = codex.wrapDebugMessageData(rawPayload, "chromeDevtools", 0);
        const outData = {
            seq: ++messageCounter,
            category: "chromeDevtools",
            data: wrappedData.buffer,
            compressAlgo: 0,
            originalSize: wrappedData.originalSize
        }
        const encodedData = messageProto.mmbizwxadevremote.WARemoteDebug_DebugMessage.encode(outData).finish();
        client.send(encodedData, { binary: true });
    }

    const flushPendingProxyMessages = () => {
        const openClients = Array.from(wss.clients).filter(client => client.readyState === WebSocket.OPEN);
        if (openClients.length === 0 || pendingProxyMessages.length === 0) {
            return;
        }

        const messages = pendingProxyMessages.splice(0);
        console.log(`[proxy] flushing ${messages.length} queued CDP messages, jscontext_id=${jsContextId || "<empty>"}`);
        for (const message of messages) {
            for (const client of openClients) {
                sendProxyMessageToMiniapp(client, message);
            }
        }
    }

    const onMessage = (message: ArrayBuffer) => {
        DEBUG && console.log(`[client] received raw message (hex): ${bufferToHexString(message)}`);
        let unwrappedData: any = null;
        try {
            const decodedData = messageProto.mmbizwxadevremote.WARemoteDebug_DebugMessage.decode(message);
            unwrappedData = codex.unwrapDebugMessageData(decodedData);
            DEBUG && console.log(`[client] [DEBUG] decoded data:`);
            DEBUG && console.dir(unwrappedData)
        } catch (e) {
            console.error(`[client] err: ${e}`);
        }

        if (unwrappedData === null) {
            return;
        }

        console.log(`[proxy] miniapp -> server category=${unwrappedData.category}`);
        if (unwrappedData.category === "setupContext") {
            const contextId = unwrappedData.data?.jscontext_id ?? unwrappedData.data?.jsContextId ?? unwrappedData.data?.id;
            if (typeof contextId === "string" && contextId.length > 0) {
                jsContextId = contextId;
                console.log(`[proxy] setupContext jscontext_id=${jsContextId}`);
            } else {
                console.log(`[proxy] setupContext payload=${JSON.stringify(unwrappedData.data)}`);
            }
            flushPendingProxyMessages();
        }
        if (unwrappedData.category === "chromeDevtoolsResult") {
            // need to proxy to CDP client
            console.log(`[proxy] miniapp -> CDP ${getCdpMethod(String(unwrappedData.data.payload))}`);
            debugMessageEmitter.emit("cdpmessage", unwrappedData.data.payload);
        }
    }

    wss.on("connection", (ws: WebSocket) => {
        console.log("[conn] miniapp client connected");
        ws.on("message", onMessage);
        ws.on("error", (err) => {console.error("[client] err:", err)});
        ws.on("close", () => {console.log("[client] client disconnected")});
    });

    debugMessageEmitter.on("proxymessage", (message: string) => {
        const openClients = Array.from(wss.clients).filter(client => client.readyState === WebSocket.OPEN).length;
        console.log(`[proxy] CDP -> miniapp ${getCdpMethod(message.toString())}, miniapp clients=${openClients}`);
        if (openClients === 0) {
            pendingProxyMessages.push(message.toString());
            if (pendingProxyMessages.length > 100) {
                pendingProxyMessages.shift();
            }
            return;
        }
        wss && wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                sendProxyMessageToMiniapp(client, message.toString());
            }
        });
    });

    return wss;
}

export const proxy_server = (port: number = CDP_PORT) => {
    const wss = new WebSocketServer({ port });
    console.log(`[server] proxy server running on ws://localhost:${port}`);

    const onMessage = (message: string) => {
        debugMessageEmitter.emit("proxymessage", message);
    }

    wss.on("connection", (ws: WebSocket) => {
        console.log("[conn] CDP client connected");
        ws.on("message", onMessage);
        ws.on("error", (err) => {console.error("[client] CDP err:", err)});
        ws.on("close", () => {console.log("[client] CDP client disconnected")});
    });

    debugMessageEmitter.on("cdpmessage", (message: string) => {
        wss && wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                // send CDP message to devtools
                console.log(`[proxy] server -> CDP ${getCdpMethod(message.toString())}`);
                client.send(message);
            }
        });
    });

    return wss;
}

export const frida_server = async () => {
    const localDevice = await frida.getLocalDevice();
    const processes = await localDevice.enumerateProcesses({scope: frida.Scope.Metadata});
    const wmpfProcesses = processes.filter(process => process.name === "WeChatAppEx.exe");
    const wmpfPids = wmpfProcesses.map(p => {
        const ppid = p.parameters.ppid;
        // frida v17 returns bigint for ppid, convert to number for comparison
        return (typeof ppid === 'number' || typeof ppid === 'bigint') ? Number(ppid) : 0;
    });

    // find the parent process
    const wmpfPid = wmpfPids.sort((a, b) => wmpfPids.filter(v => v === a).length - wmpfPids.filter(v => v === b).length).pop();
    if (wmpfPid === undefined || wmpfPid === 0) {
        throw new Error("[frida] WeChatAppEx.exe process not found");
        return;
    }
    const wmpfProcess = processes.filter(process => process.pid === wmpfPid)[0];
    if (!wmpfProcess) {
        throw new Error("[frida] parent process (WeChat.exe) not found");
        return;
    }
    const pathStr = typeof wmpfProcess.parameters.path === 'string' ? wmpfProcess.parameters.path : "";
    const wmpfVersionMatch = pathStr.match(/\d+/g);
    const wmpfVersion = wmpfVersionMatch ? Number(wmpfVersionMatch.pop()) : 0;
    if (wmpfVersion === 0) {
        throw new Error("[frida] error in find wmpf version");
        return;
    }

    const projectRoot = path.resolve(__dirname, "..");
    const configDir = path.join(projectRoot, "frida/config");

    // find hook script
    let scriptContent: string | null = null;
    try {
        scriptContent = (await promises.readFile(path.join(projectRoot, "frida/hook.js"))).toString();
    } catch (e) {
        throw new Error("[frida] hook script not found");
        return;
    }

    let configContent: string | null = null;
    try {
        configContent = (await promises.readFile(path.join(configDir, `addresses.${wmpfVersion}.json`))).toString();
        configContent = JSON.stringify(JSON.parse(configContent));
    } catch(e) {
        const supportedVersions = await listSupportedWmpfVersions(configDir);
        throw new Error(`[frida] version config not found: ${wmpfVersion}. supported versions: ${supportedVersions}. process path: ${pathStr}`);
    }

    if (scriptContent === null || configContent === null) {
        throw new Error("[frida] unable to find hook script");
        return;
    }

    // attach to process only after all local files are ready
    const session = await localDevice.attach(wmpfPid);

    // load script
    const script = await session.createScript(scriptContent.replace("@@CONFIG@@", configContent));
    script.message.connect(message => {
        console.log("[frida client]", message);
    });
    await script.load();
    console.log(`[frida] script loaded, WMPF version: ${wmpfVersion}, pid: ${wmpfPid}`);
}

export interface ServerConfig {
    debugPort?: number;
    cdpPort?: number;
}

export const main = async (config?: ServerConfig) => {
    debug_server(config?.debugPort ?? DEBUG_PORT);
    proxy_server(config?.cdpPort ?? CDP_PORT);
    try {
        await frida_server();
    } catch (e: any) {
        console.error("[frida]", e.message);
    }
}

// When run as a script (not imported), auto-execute
const isDirectRun = require.main === module || process.argv[1]?.endsWith("index.ts");
if (isDirectRun) {
    (async () => {
        await main();
    })();
}