const VERBOSE = false;
const LOG_PATCHES = false;

const getMainModule = (version) => {
    if (version >= 13331) {
        return Process.findModuleByName("flue.dll");
    }
    return Process.findModuleByName("WeChatAppEx.exe");
}


const patchResourceCachePolicy = (base, offset, version) => {
    // xref: WAPCAdapterAppIndex.js
    Interceptor.attach(base.add(offset), {
        onEnter(args) {
            LOG_PATCHES && console.log(`[patch] lib cache policy ${offset} on enter`);
        },
        onLeave(retval) {
            LOG_PATCHES && console.log(`[patch] lib cache policy ${offset} onLeave with retval:`, retval.toInt32(), "; patch to 0x0");
            retval.replace(0x0);
        }
    });
}

const patchCDPFilter = (base, offset, version) => {
    // filter function: sub_14342D970
    // xref: SendToClientFilter OR devtools_message_filter_applet_webview.cc
    Interceptor.attach(base.add(offset), {
        onEnter(args) {
            !VERBOSE ? console.log(`[patch] patch CDP filter ${offset}`) : console.log(`[patch] CDP filter ${offset} on enter, original value of v216:`, args[0].readPointer());
            this.v216 = args[0];
        },
        onLeave(retval) {
            const v216Value = this.v216.readPointer();
            VERBOSE && console.log(`[patch] CDP filter ${offset} on leave, patch v216, now value:`, v216Value, "; *(v216 + 8) =", v216Value.add(8).readU32());
            if (v216Value.add(8).readU32() == 6) {
                v216Value.add(8).writeU32(0x0);
            }
        }
    });
}

const getScenePtr = (a1, config) => {
    if (Array.isArray(config.SceneOffsets) && config.SceneOffsets.length === 2) {
        const sceneOffsets = config.SceneOffsets;
        return a1
            .add(sceneOffsets[0])
            .readPointer()
            .add(sceneOffsets[1]);
    }

    if (Array.isArray(config.SceneOffsets) && config.SceneOffsets.length === 6) {
        const sceneOffsets = config.SceneOffsets;
        const miniappConfigPtr = a1
            .add(sceneOffsets[0])
            .readPointer()
            .add(sceneOffsets[1])
            .readPointer();
        return miniappConfigPtr
            .add(sceneOffsets[2])
            .readPointer()
            .add(sceneOffsets[3])
            .readPointer()
            .add(sceneOffsets[4])
            .readPointer()
            .add(sceneOffsets[5]);
    }

    let structOffset = [1208, 1160, 16, 488];
    switch (config.Version) {
        case 13331:
        case 13341:
        case 13487:
        case 13639:
            structOffset = [1272, 1224, 16, 488];
            break;
        case 13655:
            structOffset = [1280, 1232, 16, 488];
            break;
        case 13871:
        case 13909:
        case 14161:
        case 14199:
            structOffset = [1360, 1312, 16, 488];
            break;
    }
    const passArgs = a1.add(56).readPointer().add(structOffset[0]).readPointer();
    return passArgs.add(8).readPointer().add(structOffset[1]).readPointer().add(structOffset[2]).readPointer().add(structOffset[3]);
}

const sceneNumberArray = [1005, 1007, 1008, 1027, 1035, 1053, 1074, 1145, 1178, 1256, 1260, 1302, 1308];
const patchedSceneNumber = 1101;

const tryReadPtr = (ptr) => {
    try {
        const value = ptr.readPointer();
        return value.isNull() ? null : value;
    } catch (e) {
        return null;
    }
}

const tryReadInt = (ptr) => {
    try {
        return ptr.readInt();
    } catch (e) {
        return null;
    }
}

const isWritablePtr = (ptr) => {
    try {
        const range = Process.findRangeByAddress(ptr);
        return range !== null && range.protection.includes("w");
    } catch (e) {
        return false;
    }
}

const getRange = (ptr) => {
    try {
        return Process.findRangeByAddress(ptr);
    } catch (e) {
        return null;
    }
}

const getRangeProtection = (ptr) => {
    try {
        const range = getRange(ptr);
        return range === null ? "unknown" : range.protection;
    } catch (e) {
        return "unknown";
    }
}

const tryMatchScenePtr = (scenePtr, label) => {
    if (!isWritablePtr(scenePtr)) {
        return null;
    }

    const scene = tryReadInt(scenePtr);
    if (sceneNumberArray.includes(scene)) {
        console.log(`[hook] scene fallback matched: ${label} -> ${scene}, ptr: ${scenePtr}, protection: ${getRangeProtection(scenePtr)}`);
        return scenePtr;
    }
    return null;
}

const findScenePtrFallback = (a1) => {
    const firstOffsets = [0x38, 0x40, 0x48, 0x50, 0x58, 0x60];
    for (const firstOffset of firstOffsets) {
        const firstPtr = tryReadPtr(a1.add(firstOffset));
        if (firstPtr === null) {
            continue;
        }

        const firstRange = getRange(firstPtr);
        if (firstRange !== null && firstRange.protection.includes("w")) {
            for (let sceneOffset = 0; sceneOffset <= 0x900; sceneOffset += 4) {
                const matchedPtr = tryMatchScenePtr(firstPtr.add(sceneOffset), `[0x${firstOffset.toString(16)}, 0x${sceneOffset.toString(16)}]`);
                if (matchedPtr !== null) {
                    return matchedPtr;
                }
            }
        }

        for (let secondOffset = 0; secondOffset <= 0x900; secondOffset += 8) {
            const secondPtr = tryReadPtr(firstPtr.add(secondOffset));
            if (secondPtr === null) {
                continue;
            }
            const secondRange = getRange(secondPtr);
            if (secondRange === null || !secondRange.protection.includes("w")) {
                continue;
            }

            for (let sceneOffset = 0; sceneOffset <= 0x900; sceneOffset += 4) {
                const matchedPtr = tryMatchScenePtr(secondPtr.add(sceneOffset), `[0x${firstOffset.toString(16)}, 0x${secondOffset.toString(16)}, 0x${sceneOffset.toString(16)}]`);
                if (matchedPtr !== null) {
                    return matchedPtr;
                }
            }
        }
    }
    return null;
}

const onLoadStartHook = (a1, a2, config) => {
    let passConditionPtr = null;
    try {
        passConditionPtr = getScenePtr(a1, config);
    } catch (e) {
        console.log("[hook] unable to read scene:", e.message);
    }

    let scene = passConditionPtr === null ? null : tryReadInt(passConditionPtr);
    if (scene === patchedSceneNumber) {
        console.log("[hook] scene already patched:", scene);
        return;
    }

    if (!sceneNumberArray.includes(scene) && config.EnableSceneFallback !== false) {
        const fallbackScenePtr = findScenePtrFallback(a1);
        if (fallbackScenePtr !== null) {
            passConditionPtr = fallbackScenePtr;
            scene = passConditionPtr.readInt();
        }
    }

    console.log("[hook] scene:", scene);
    if (!sceneNumberArray.includes(scene)) {
        return;
    }
    console.log(`[hook] hook scene condition -> ${patchedSceneNumber}`);
    try {
        passConditionPtr.writeInt(patchedSceneNumber);
    } catch (e) {
        console.log(`[hook] unable to write scene ptr ${passConditionPtr}, protection: ${getRangeProtection(passConditionPtr)}, err: ${e.message}`);
    }

    // TODO: customize debugging endpoint
    // const websocketServerStringPtr = passArgs.add(8).readPointer().add(520);
    // VERBOSE && console.log("[hook] hook websocket server, original: ", websocketServerStringPtr.readUtf8String());
    // websocketServerStringPtr.writeUtf8String("ws://127.0.0.1:8189/");
}

const interceptor = (base, config) => {
    // xref: AppletIndexContainer::OnLoadStart
    Interceptor.attach(base.add(config.LoadStartHookOffset), {
        onEnter(args) {
            console.log("[inteceptor] AppletIndexContainer::OnLoadStart onEnter, indexContainer.this: ", this.context.rcx);
            // write dl to 0x1
            if ((this.context.rdx & 0xFF) !== 1) {
                this.context.rdx = (this.context.rdx & ~0xFF) | 0x1;
            }
            // handle others
            onLoadStartHook(this.context.rcx, this.context.rdx, config);
        },
        onLeave(retval) {
            // do nothing
        }
    })
}

const parseConfig = () => {
    const rawConfig = `@@CONFIG@@`;
    if (rawConfig.includes("@@")) {
        // test addresses
        return {
            Version: 13341,
            LoadStartHookOffset: "0x10009E0",
            CDPFilterHookOffset: "0x242E8E0",
            ResourceCachePolicyHookOffset: "0x1053730"
        }
    }
    return JSON.parse(rawConfig);
}

const main = () => {
    const config = parseConfig();
    const mainModule = getMainModule(config.Version);
    interceptor(mainModule.base, config);
    patchResourceCachePolicy(mainModule.base, config.ResourceCachePolicyHookOffset, config.Version);
    patchCDPFilter(mainModule.base, config.CDPFilterHookOffset, config.Version);
}

main();
