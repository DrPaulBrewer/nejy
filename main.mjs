import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { createRequire } from 'node:module';
import YAML from 'yaml';
import cp from 'node:child_process';
import { loadRegistry } from './lib/buildMods.mjs';
import { SecurityScanner } from './security_scanner.mjs';
import { Command } from 'commander';
import { Worker } from 'node:worker_threads';
import ResourceMonitor from './monitor/index.js';
import { JSONRPCServer, JSONRPCClient } from 'json-rpc-2.0';

const DEFAULT_REGISTRY = [
    'config/security/registry/00-builtins.yaml',
    'config/security/registry/10-math.yaml',
    'config/security/registry/15-mathFunction.yaml',
    'config/security/registry/20-console.yaml',
    'config/security/registry/30-yaml-module.yaml',
    'config/security/registry/40-os.yaml',
    'config/security/registry/50-fs.yaml',
    'config/security/registry/60-net.yaml',
    'config/security/registry/80-json.yaml',
];

// ---------------------------------------------------------------------------
// Context-aware helpers
// ctx = { mods, vars, functions, mon, scanner }
//
// ---------------------------------------------------------------------------

const isVar = (k, ctx) => typeof k === 'string' && k.startsWith('$') && (k in ctx.vars);

const resolveArgs = (args, ctx) => {
    if (isVar(args, ctx)) return ctx.vars[args];
    if (Array.isArray(args)) {
        if (args[0] === 'LITERAL' && args.length === 2) {
            checkNoPrototypePollution(args[1]);
            return structuredClone(args[1]);
        }
        return args.map(a => resolveArgs(a, ctx));
    }
    if (args && typeof args === 'object') return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, resolveArgs(v, ctx)]));
    return args;
};

const resolvePath = (path, ctx) => {
    const pStr = String(path);
    const parts = pStr.split('.');
    // $-prefixed paths walk ctx.vars; others walk ctx.mods
    let fn = pStr.startsWith('$') ? ctx.vars : ctx.mods;
    let context = fn;
    for (const p of parts) {
        if (["prototype", "__proto__", "constructor"].includes(p)) throw new Error("SEC_BLOCK");
        context = fn; fn = (fn === null || fn === undefined) ? undefined : Reflect.get(Object(fn), p);
        if (fn === undefined) throw new Error(`Link Fail: ${path}`);
    }
    return { f: fn, c: context };
};

function removePP(obj) {
    if (obj !== null && typeof obj === 'object') {
        const proto = Object.getPrototypeOf(obj);
        if (proto === Object.prototype || proto === null) {
            try {
                const clean = structuredClone(obj);
                Object.setPrototypeOf(clean, null);
                delete clean.constructor;
                return clean;
            } catch (e) {
                return obj;
            }
        }
        if (proto === Array.prototype || Array.isArray(obj)) {
            try {
                // structuredClone creates a clean array with the default Array.prototype
                const clean = structuredClone(obj);
                delete clean.constructor;
                return clean;
            } catch (e) {
                return obj;
            }
        }
    }
    return obj;
}

const commands = {
    EXEC: async ([target, rawArgs], ctx, em) => {
        const { f, c } = resolvePath(resolveArgs(target, ctx), ctx);
        const args = resolveArgs(rawArgs || [], ctx).map(a => {
            if (a === "$VARS") return new Proxy(new Map(), {
                // Falls back to ctx.mods so programs can pass $VARS as a scope object
                // (e.g., math.evaluate(expr, $VARS) where expr references mods like os.freemem).
                // This is safe: ctx.mods is already risk-filtered; it is NOT raw global.
                get: (t, p) => {
                    if (p === 'get') return (k) => Object.hasOwn(ctx.vars, k) ? ctx.vars[k] : (Object.hasOwn(ctx.mods, k) ? ctx.mods[k] : undefined);
                    if (p === 'set') return (k, v) => { ctx.vars[k] = v; return t; };
                    if (p === 'has') return (k) => Object.hasOwn(ctx.vars, k) || Object.hasOwn(ctx.mods, k);
                    if (p === 'keys') return () => [...Object.keys(ctx.vars), ...Object.keys(ctx.mods)].values();
                    const val = Reflect.get(t, p);
                    return typeof val === 'function' ? val.bind(t) : val;
                }
            });
            return a;
        });
        const res = Reflect.apply(f, c, args);
        ctx.vars["$LAST"] = removePP((res instanceof Promise) ? await res : res);
    },
    NEW: async ([target, rawArgs], ctx) => {
        const { f } = resolvePath(resolveArgs(target, ctx), ctx);
        const args = resolveArgs(rawArgs || [], ctx);
        ctx.vars["$LAST"] = new f(...args);
    },
    LITERAL: (args, ctx) => {
        ctx.vars["$LAST"] = structuredClone(args);
    },
    SET: ([name, val], ctx) => { ctx.vars[`$${name}`] = resolveArgs(val, ctx); },
    DEF: ([name, steps], ctx) => { ctx.functions[name] = steps; },
    REQUEST: () => {
        // Fully handled at scan time — no-op at runtime.
        // scan() validates position, items, and risk before execution begins.
    },
    IMPORT: async ([src], ctx) => {
        const url = resolveArgs(src, ctx);
        const content = url.startsWith('http')
            ? await (await fetch(url)).json()
            : YAML.parse(fsProxy.readFileSync(url, 'utf8'));

        if (Array.isArray(content)) {
            // ── New-style library: array program with optional REQUEST ──────────────
            let libRequestList = null;
            let libBody = content;

            if (content.length > 0 && Array.isArray(content[0]) && content[0][0] === 'REQUEST') {
                const libReqArgs = content[0][1];
                if (!Array.isArray(libReqArgs))
                    throw new Error(`SEC_BLOCK: imported library REQUEST must be a literal list`);
                libRequestList = libReqArgs;
                libBody = content.slice(1);

                // Validate library's REQUEST:
                //   (a) each item must be within the manifest's maxRisk
                //   (b) each item must be in the parent's REQUEST (if the parent has one)
                if (ctx.scanner) {
                    for (const req of libRequestList) {
                        if (typeof req !== 'string')
                            throw new Error(`SEC_BLOCK: library REQUEST items must be strings`);
                        ctx.scanner.checkPath(req, true); // (a) maxRisk check
                        if (ctx.scanner.requestList !== null &&
                            !pathInRequest(req, ctx.scanner.requestList)) { // (b) subset check
                            throw new Error(
                                `SEC_BLOCK: imported library requests '${req}' ` +
                                `which is not granted by this program's REQUEST`);
                        }
                    }
                }
            }

            // Create a library-scoped scanner that enforces the library's own REQUEST.
            const libScanner = ctx.scanner
                ? new SecurityScanner(ctx.scanner.manifest, ctx.scanner.registryEntries)
                : null;
            if (libScanner) libScanner.requestList = libRequestList;

            // Build library specific mods using parent's maxRisk ceiling, but narrowed by libRequestList
            // Note: ctx.scanner.manifest and registryEntries are used (available if scanner is active).
            const libMods = ctx.scanner
                ? await buildMods(
                    ctx.scanner.registryEntries,
                    ctx.scanner.manifest.maxRisk ?? 'LOW',
                    libRequestList
                )
                : ctx.mods;

            // Extract only DEF commands from the library (libraries export functions, not side effects).
            for (const step of libBody) {
                if (!Array.isArray(step)) continue;
                const [cmd, args] = step;
                if (cmd === 'DEF') {
                    const [name, body] = Array.isArray(args) ? args : [args, []];
                    if (libScanner && Array.isArray(body)) libScanner.analyze(body);
                    if (name && body) ctx.functions[name] = { body, mods: libMods };
                }
                // Non-DEF top-level steps in libraries are silently ignored.
                // (Libraries only export function definitions.)
            }
        } else if (content && typeof content === 'object') {
            // ── Old-style library: plain object map { fnName: steps } ─────────────
            // Backwards compatible: functions inherit the parent's effective capabilities.
            if (ctx.scanner) {
                for (const [name, body] of Object.entries(content)) {
                    ctx.scanner.analyze(body);
                }
            }
            for (const [name, body] of Object.entries(content)) {
                ctx.functions[name] = { body, mods: ctx.mods };
            }
        }
    },
    CALL: async ([name, input], ctx, em) => {
        if (!ctx.functions[name]) throw new Error(`Fn Undefined: ${name}`);
        const fnEntry = ctx.functions[name];
        // Handle both new-style { body, mods } and old-style plain arrays
        const body = Array.isArray(fnEntry) ? fnEntry : fnEntry.body;
        const fnMods = Array.isArray(fnEntry) ? ctx.mods : fnEntry.mods;

        const prevInput = ctx.vars["$INPUT"];
        const prevMods = ctx.mods;

        ctx.vars["$INPUT"] = resolveArgs(input, ctx);
        ctx.mods = fnMods;

        await run(body, ctx, em);

        ctx.vars["$INPUT"] = prevInput;
        ctx.mods = prevMods;
    },
    PIPE: async ([start, ...steps], ctx, em) => {
        await run([start], ctx, em);
        for (const step of steps) {
            const [path, args] = Array.isArray(step) ? step : [step, ["$LAST"]];
            commands[path]
                ? await commands[path](args, ctx, em)
                : await commands.EXEC([path, args], ctx, em);
        }
    },
    IF: async ([cond, t, f], ctx, em) => {
        const test = Array.isArray(cond)
            ? (await run([cond], ctx, em), ctx.vars["$LAST"])
            : resolveArgs(cond, ctx);
        await run(test ? t : f, ctx, em);
    },
    FOR_EACH: async ([listSpec, sub], ctx, em) => {
        const list = resolveArgs(listSpec, ctx);
        const limit = typeof list === 'number' ? list : (Array.isArray(list) ? list.length : 0);
        for (let i = 0; i < limit; i++) {
            ctx.vars["$ITEM"] = typeof list === 'number' ? i : list[i];
            await run(sub, ctx, em);
            if (i % 5000 === 0 && !em) ctx.mon.checkResources();
        }
    },
    TRY: async ([tryB, catchB], ctx, em) => {
        try { await run(tryB, ctx, em); }
        catch (e) {
            if (e.type === "RETURN_SIGNAL") throw e;
            ctx.vars["$ERROR"] = e.message;
            if (catchB) await run(catchB, ctx, em);
        }
    },
    /**
     * TO — run a code block, capture $LAST into a named variable.
     * Syntax: ["TO", ["varname", code]]   ← same 2-element convention as every other command
     *
     * code can be:
     *   - a single step:    ["callable", args]
     *   - a block of steps: [["step1", ...], ["step2", ...]]
     *
     * Disambiguation: if code[0] is a string it is a single step (wrap it);
     * if code[0] is an array it is already a block. This is structurally
     * unambiguous — single steps always begin with a string path, blocks
     * always begin with a step array.
     */
    TO: async ([varname, code], ctx, em) => {
        const block = (Array.isArray(code) && typeof code[0] === 'string') ? [code] : code;
        await run(block, ctx, em);
        ctx.vars[`$${varname}`] = ctx.vars["$LAST"];
    },
    SANDBOX: async ([initOpts, subprogram], ctx, em) => {
        let childPolicy = ctx.scanner ? ctx.scanner.manifest.maxRisk : 'LOW';
        let childCapabilities = ctx.scanner ? ctx.scanner.requestList : null;
        let childVars = {};

        if (initOpts === 'copy') {
            childVars = structuredClone(ctx.vars);
        } else {
            if (initOpts.policy) childPolicy = initOpts.policy;
            if (initOpts.capabilities) {
                childCapabilities = initOpts.capabilities;
            } else if (initOpts.capabilities === undefined) {
                childCapabilities = [];
            }

            if (initOpts.context === "$VARS") {
                childVars = structuredClone(ctx.vars);
            } else if (Array.isArray(initOpts.context)) {
                for (const v of initOpts.context) {
                    if (isVar(v, ctx)) {
                        childVars[v] = structuredClone(ctx.vars[v]);
                    } else if (typeof v === 'string' && v.startsWith('$') && ctx.vars[v] !== undefined) {
                        childVars[v] = structuredClone(ctx.vars[v]);
                    }
                }
                // Always carry over basic runtime context variables
                childVars["$LAST"] = structuredClone(ctx.vars["$LAST"] ?? null);
                childVars["$ERROR"] = structuredClone(ctx.vars["$ERROR"] ?? null);
                childVars["$ITEM"] = structuredClone(ctx.vars["$ITEM"] ?? null);
                childVars["$USAGE"] = structuredClone(ctx.vars["$USAGE"] ?? null);
                childVars["$INPUT"] = structuredClone(ctx.vars["$INPUT"] ?? null);
                childVars["$RETURN"] = structuredClone(ctx.vars["$RETURN"] ?? null);
            } else if (initOpts.context && typeof initOpts.context === 'object') {
                for (const [k, v] of Object.entries(initOpts.context)) {
                    childVars[k] = structuredClone(resolveArgs(v, ctx) ?? null);
                }
                childVars["$LAST"] = structuredClone(ctx.vars["$LAST"] ?? null);
                childVars["$ERROR"] = structuredClone(ctx.vars["$ERROR"] ?? null);
                childVars["$ITEM"] = structuredClone(ctx.vars["$ITEM"] ?? null);
                childVars["$USAGE"] = structuredClone(ctx.vars["$USAGE"] ?? null);
                childVars["$INPUT"] = structuredClone(ctx.vars["$INPUT"] ?? null);
                childVars["$RETURN"] = structuredClone(ctx.vars["$RETURN"] ?? null);
            } else {
                 childVars = {
                     "$LAST": structuredClone(ctx.vars["$LAST"] ?? null),
                     "$ERROR": structuredClone(ctx.vars["$ERROR"] ?? null),
                     "$ITEM": structuredClone(ctx.vars["$ITEM"] ?? null),
                     "$USAGE": structuredClone(ctx.vars["$USAGE"] ?? null),
                     "$INPUT": structuredClone(ctx.vars["$INPUT"] ?? null),
                     "$RETURN": structuredClone(ctx.vars["$RETURN"] ?? null)
                 };
            }
        }

        const registryEntries = ctx.scanner ? ctx.scanner.registryEntries : [];
        const childMods = await buildMods(registryEntries, childPolicy, childCapabilities);

        if (childMods.fs && ctx.mon) ctx.mon.instrumentFs(childMods.fs);

        const childCtx = {
            mods: childMods,
            vars: childVars,
            functions: { ...ctx.functions }, // shallow copy functions
            mon: ctx.mon,
            scanner: ctx.scanner ? new SecurityScanner(
                 { ...ctx.scanner.manifest, maxRisk: childPolicy },
                 registryEntries
            ) : null
        };
        if (childCtx.scanner) childCtx.scanner.requestList = childCapabilities;

        await run(subprogram, childCtx, em);

        if (childCtx.vars["$RETURN"] !== undefined) {
             ctx.vars["$LAST"] = structuredClone(childCtx.vars["$RETURN"]);
        }
    },
};

/**
 * Core execution primitive. All mutable state lives in ctx.
 * Does NOT scan — scanning must be done before calling run().
 *
 * @param {Array}   steps - program steps to execute
 * @param {object}  ctx   - { mods, vars, functions, mon, scanner }
 * @param {boolean} em    - emergency mode (skip resource checks)
 */
async function run(steps, ctx, em = false) {
    if (!Array.isArray(steps)) return;
    for (const step of steps) {
        try {
            if (!em) ctx.mon.checkResources();
            const [path, args] = step;
            if (commands[path]) await commands[path](args, ctx, em);
            else await commands.EXEC([path, args], ctx, em);
        } catch (err) {
            if (err.type === "RETURN_SIGNAL") throw err;
            if (err.message === "QUOTA_EXCEEDED" && !em) {
                ctx.vars["$USAGE"] = ctx.mon.usage;
                ctx.vars["$ERROR"] = "QUOTA_EXCEEDED";
                if (ctx.functions.ON_QUOTA) await run(ctx.functions.ON_QUOTA, ctx, true);
                throw err;
            }
            throw err;
        }
    }
}

function loadSetup(policyName, filename = "unknown") {
    const policyPath = policyName.includes('/')
        ? policyName
        : `config/security/policies/${policyName.toLowerCase()}.json`;

    if (!fs.existsSync(policyPath)) {
        console.error(`❌ Policy file not found: ${policyPath}`);
        process.exit(1);
    }
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

    const riskMap = { "LOW": 0, "MEDIUM": 1, "HIGH": 2, "INSANE": 3 };
    const maxRisk = policy.maxRisk || "LOW";

    if (process.env.NEJY_MAX_RISK) {
        const envVal = process.env.NEJY_MAX_RISK;
        if (riskMap[envVal] === undefined) {
            console.error(`❌ Invalid NEJY_MAX_RISK environment variable: ${envVal}`);
            process.exit(1);
        }
        if (riskMap[maxRisk] > riskMap[envVal]) {
            console.error(`❌ Boot Failure: Requested policy maxRisk (${maxRisk}) exceeds environment limit NEJY_MAX_RISK (${envVal})`);
            process.exit(1);
        }
    }

    console.error(`nejy v0.51.0 | effectiveMaxRisk: ${maxRisk} | program: ${filename.split('/').pop()} | manifest: ${policyPath.split('/').pop()}`);

    const registryEntries = loadRegistry(DEFAULT_REGISTRY);
    const scanner = new SecurityScanner(policy, registryEntries);
    return { policy, registryEntries, scanner };
}

function processOutput(errorMsg, result, usage) {
    console.log(errorMsg ? "❌ Execution Failed." : "✅ Execution Finished.");
    console.log("```yaml");
    console.log(YAML.stringify([errorMsg, result, usage]).trim());
    console.log("```");
}

const program = new Command();

program
    .name('nejy')
    .description('Nejy Runtime: Sandboxed JSON/YAML Interpreter')
    .version('0.51.0');

program.command('scan')
    .description('Statically analyze a program without executing it')
    .argument('<file>', 'Path to the .json or .yaml program')
    .option('-p, --policy <policy>', 'Policy level to enforce (LOW, MEDIUM, HIGH)', 'LOW')
    .action((file, options) => {
        const prog = YAML.parse(fs.readFileSync(file, 'utf8'));
        const { scanner } = loadSetup(options.policy, file);

        try {
            scanner.scan(prog);
            console.log("🛡️  Safety Scan Passed.");
            process.exit(0);
        } catch (e) {
            console.error(`❌ ${e.message}`);
            process.exit(1);
        }
    });

program.command('run')
    .description('Scan and execute a nejy program')
    .argument('<file>', 'Path to the .json or .yaml program')
    .option('-p, --policy <policy>', 'Policy level to enforce (LOW, MEDIUM, HIGH)', 'LOW')
    .action(async (file, options) => {
        const prog = YAML.parse(fs.readFileSync(file, 'utf8'));
        const { policy, registryEntries, scanner } = loadSetup(options.policy, file);

        let scannedProg = prog;
        try {
            scannedProg = scanner.scan(prog) ?? prog;
        } catch (e) {
            processOutput(e.message, null, null);
            process.exit(1);
        }

        const activeWorkers = new Map();
        const rpcServer = new JSONRPCServer();
        let nextWorkerId = 1;
        const mon = new ResourceMonitor(policy.quotas);
        const quotaSab = new SharedArrayBuffer(3 * 4); // 3x Int32: [isExhausted, fsBytes, memoryMb]
        const quotaArray = new Int32Array(quotaSab);

        function createWorker(id, code, targetPolicy, requestList, isRoot = false) {
            const workerIdNumber = isRoot ? 0 : nextWorkerId++;
            const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
                workerData: { scannedProg: code, policy: targetPolicy, registryEntries, requestList, program: code, workerId: workerIdNumber, quotaSab }
            });

            const rpcClient = new JSONRPCClient((request) => worker.postMessage(request));

            activeWorkers.set(id, { worker, rpcClient });

            worker.on('message', (msg) => {
                if (msg.type === "done") {
                    if (isRoot) {
                        processOutput(msg.errorMsg, msg.result, msg.usage);
                        process.exit(msg.errorMsg ? 1 : 0);
                    } else {
                        activeWorkers.delete(id);
                    }
                } else if (msg.type === "error") {
                    if (isRoot) {
                        if (msg.errorMsg === "HARD_STOP" || msg.errorMsg === "QUOTA_EXCEEDED") {
                            console.error(`❌ Fatal Error: ${msg.errorMsg}`);
                        }
                        processOutput(msg.errorMsg, null, msg.usage);
                        process.exit(1);
                    } else {
                        activeWorkers.delete(id);
                        console.error(`❌ Sub-worker '${id}' failed: ${msg.errorMsg}`);
                    }
                } else if (msg.jsonrpc) {
                    if (msg.method) {
                        // Request from worker to supervisor
                        rpcServer.receive(msg, { id }).then((response) => {
                            if (response) worker.postMessage(response);
                        });
                    } else {
                        // Response from worker to supervisor
                        rpcClient.receive(msg);
                    }
                }
            });

            worker.on('error', (err) => {
                activeWorkers.delete(id);
                if (isRoot) {
                    console.error(`❌ Worker failed: ${err.message}`);
                    processOutput(err.message, null, null);
                    process.exit(1);
                } else {
                    console.error(`❌ Sub-worker '${id}' crashed: ${err.message}`);
                }
            });

            return worker;
        }

        rpcServer.addMethod('Worker.spawn', async ({ id, code, policy: spawnPolicy, parentCapabilities }) => {
            if (activeWorkers.has(id)) {
                throw new Error(`Worker ID '${id}' already exists.`);
            }

            const childScanner = new SecurityScanner(spawnPolicy, registryEntries);
            childScanner.requestList = parentCapabilities;
            let scannedSubProg;
            try {
                scannedSubProg = childScanner.scan(code) ?? code;
            } catch (e) {
                throw new Error(`Security scan failed for worker '${id}': ${e.message}`);
            }

            createWorker(id, scannedSubProg, spawnPolicy, childScanner.requestList, false);
            return id;
        });

        rpcServer.addMethod('Worker.rpc_call', async ({ targetId, method, params }) => {
            const target = activeWorkers.get(targetId);
            if (!target) {
                throw new Error(`Target worker '${targetId}' not found.`);
            }

            return target.rpcClient.request(method, params);
        });

        // Supervisor Loop to update memory/CPU
        const monitorInterval = setInterval(() => {
            try {
                mon.usage.fsBytes += Atomics.exchange(quotaArray, 1, 0); // Pull FS bytes
                const isCpuBound = Atomics.load(quotaArray, 2) > 0;
                if (!isCpuBound) mon.checkResources();
                // If we get here, not exhausted. Update SAB so workers can see
                Atomics.store(quotaArray, 0, 0); // isExhausted = 0
            } catch (err) {
                Atomics.store(quotaArray, 0, 1); // isExhausted = 1
                clearInterval(monitorInterval);
                console.error(`❌ Fatal Error: ${err.message}`);
                processOutput(err.message, null, mon.usage);
                process.exit(1);
            }
        }, 100);
        createWorker("root", scannedProg, policy, scanner.requestList, true);
    });

program.parse(process.argv);
