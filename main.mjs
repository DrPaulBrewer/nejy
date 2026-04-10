import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { createRequire } from 'node:module';
import { create, all } from 'mathjs';
import YAML from 'yaml';
import cp from 'node:child_process';
import ResourceMonitor from './monitor/index.js';
import { buildMods, loadRegistry, effectiveRisk } from './lib/buildMods.mjs';

/**
 * 1. SECURITY SCANNER
 * Performs static analysis before execution.
 * Stage 4: riskOf() now delegates to effectiveRisk() against the loaded registry.
 * Unknown paths return null, which is treated as INSANE (blocked by default).
 */

// Interpreter-level commands are exempt from registry risk checks.
// Programs cannot inject new command names; these are hard-coded in the interpreter.
const KNOWN_COMMANDS = new Set([
    "EXEC", "NEW", "SET", "DEF", "CALL", "PIPE", "IF", "FOR_EACH", "TRY", "IMPORT", "TO", "REQUEST"
]);

/**
 * Returns true if pathStr is covered by the requestList.
 *   "math"        covers "math.evaluate", "math.compile", … (module-prefix match)
 *   "console.log" covers "console.log" only           (exact-method match)
 * requestList === null means no REQUEST was declared → everything is allowed.
 */
function pathInRequest(pathStr, requestList) {
    if (!requestList) return true; // no REQUEST → full manifest capabilities
    return requestList.some(req =>
        pathStr === req ||              // exact method match
        pathStr.startsWith(req + '.')   // module-prefix match
    );
}

class SecurityScanner {
    /**
     * @param {object}   manifest        - parsed manifest JSON (has maxRisk)
     * @param {object[]} registryEntries - flat array of parsed registry entries from loadRegistry()
     */
    constructor(manifest, registryEntries = []) {
        this.manifest = manifest;
        this.riskMap = { "LOW": 0, "MEDIUM": 1, "HIGH": 2, "INSANE": 3 };
        this.currentRisk = this.riskMap[manifest.maxRisk || "LOW"];
        this.registryEntries = registryEntries;
        this.requestList = null; // set by scan() when program begins with REQUEST
    }

    scan(program) {
        if (this.currentRisk >= 3) return; // INSANE skips scan

        this.requestList = null;
        let steps = program;

        // If the program begins with REQUEST, extract and validate it.
        // REQUEST must be the literal first step; its argument must be a literal list.
        if (Array.isArray(program) && program.length > 0 &&
            Array.isArray(program[0]) && program[0][0] === 'REQUEST') {
            const reqArgs = program[0][1];
            if (!Array.isArray(reqArgs))
                throw new Error(`SEC_BLOCK: REQUEST argument must be a literal list`);
            for (const req of reqArgs) {
                if (typeof req !== 'string')
                    throw new Error(`SEC_BLOCK: REQUEST items must be strings`);
                this.checkPath(req, true); // validate within maxRisk; skip subset check
            }
            this.requestList = reqArgs;
            steps = program.slice(1); // scan the body after REQUEST
        }

        this.analyze(steps);
    }

    /**
     * Return the required risk level for a callable path string.
     * Delegates to effectiveRisk() against the registry.
     * $-prefixed paths (variable method calls) can’t be verified statically — treated as LOW.
     * Paths missing from the registry are treated as INSANE (unknown = blocked by default).
     */
    riskOf(pathStr) {
        if (typeof pathStr !== 'string') return "LOW";
        // Variable method calls (e.g. $dateObj.toISOString) — can’t verify statically.
        if (pathStr.startsWith('$')) return "LOW";
        // Registry lookup; null = not in registry = INSANE.
        return effectiveRisk(pathStr, this.registryEntries) ?? "INSANE";
    }

    checkPath(pathStr, skipRequestCheck = false) {
        if (typeof pathStr !== 'string') return;
        // Prototype-chain attacks are always blocked (also caught by resolvePath at runtime).
        if (/prototype|__proto__|constructor/.test(pathStr))
            throw new Error(`SEC_BLOCK: Illegal access pattern in '${pathStr}'`);
        const required = this.riskOf(pathStr);
        if (this.riskMap[required] > this.currentRisk)
            throw new Error(`SEC_BLOCK: '${pathStr}' requires ${required} risk (Manifest: ${this.manifest.maxRisk})`);
        // REQUEST enforcement: when a REQUEST is declared, all callable paths must be in it.
        // $-prefixed paths are runtime variable method calls — cannot be verified statically.
        if (!skipRequestCheck && this.requestList !== null && !pathStr.startsWith('$')) {
            if (!pathInRequest(pathStr, this.requestList))
                throw new Error(`SEC_BLOCK: '${pathStr}' was not declared in this program's REQUEST`);
        }
    }

    analyze(steps) {
        if (!Array.isArray(steps)) return;
        for (const step of steps) {
            if (!Array.isArray(step)) continue;
            const [path, args = []] = step;

            // REQUEST is only valid as the first step of the top-level program.
            // scan() strips it before calling analyze(), so any REQUEST still present
            // here must be misplaced (inside a DEF body, IF branch, etc.) — block it.
            if (path === 'REQUEST') {
                throw new Error(`SEC_BLOCK: REQUEST must be the first command of the program`);
            }

            // Named interpreter commands are exempt from registry risk checks.
            // Non-command paths are shorthand callables (e.g. ["math.evaluate", [...]]).
            if (!KNOWN_COMMANDS.has(path)) {
                this.checkPath(path);
            }

            // For EXEC and NEW, check the explicit target callable path.
            if ((path === "EXEC" || path === "NEW") && Array.isArray(args) && typeof args[0] === 'string') {
                this.checkPath(args[0]);
            }

            // For PIPE, check string-shorthand step targets.
            if (path === "PIPE" && Array.isArray(args)) {
                for (const pipeStep of args) {
                    if (typeof pipeStep === 'string') {
                        if (!pipeStep.startsWith('$')) this.checkPath(pipeStep);
                    } else if (Array.isArray(pipeStep)) {
                        this.analyze([pipeStep]);
                    }
                }
            }

            // IMPORT requires at least MEDIUM risk.
            if (path === "IMPORT") {
                if (this.riskMap["MEDIUM"] > this.currentRisk)
                    throw new Error(`SEC_BLOCK: 'IMPORT' requires MEDIUM risk (Manifest: ${this.manifest.maxRisk})`);
            }

            // fetch with non-GET methods requires HIGH risk (registry marks fetch as MEDIUM for GET).
            if (path === "fetch") {
                const options = (args && typeof args === 'object' && !Array.isArray(args)) ? args : (args[1] || {});
                const method = (options.method || "GET").toUpperCase();
                if (method !== "GET" && this.riskMap["HIGH"] > this.currentRisk)
                    throw new Error(`SEC_BLOCK: 'fetch' ${method} requires HIGH risk (Manifest: ${this.manifest.maxRisk})`);
            }

            // Explicitly recurse into code branches only — NOT into data args.
            // The old generic filter(Array.isArray) treated data arrays (e.g. SET values,
            // EXEC arg arrays) as code, causing false positives under strict registry checking.
            if (path === 'IF') {
                // cond may be an inline step array; t and f are step-arrays (branches)
                if (Array.isArray(args[0])) this.analyze([args[0]]);  // cond as inline step
                if (Array.isArray(args[1])) this.analyze(args[1]);    // true branch
                if (Array.isArray(args[2])) this.analyze(args[2]);    // false branch
            } else if (path === 'FOR_EACH') {
                if (Array.isArray(args[1])) this.analyze(args[1]);    // loop body
            } else if (path === 'TRY') {
                if (Array.isArray(args[0])) this.analyze(args[0]);    // try block
                if (Array.isArray(args[1])) this.analyze(args[1]);    // catch block
            } else if (path === 'DEF') {
                if (Array.isArray(args[1])) this.analyze(args[1]);    // function body
            } else if (path === 'TO') {
                // Same disambiguation as the interpreter: string-first = single step, else block
                const code = args[1];
                if (Array.isArray(code)) {
                    if (typeof code[0] === 'string') this.analyze([code]);  // single step
                    else this.analyze(code);                                // block of steps
                }
            }
            // PIPE: already fully handled in the explicit PIPE block above.
            // EXEC, NEW, SET, CALL, IMPORT: args are data — no branch recursion.
        }
    }
}

// --- Interpreter Setup (module-level globals kept for internal use) ---
const require = createRequire(import.meta.url);
const math = create(all);
const fsProxy = { ...fs };

// Programs no longer access these via global — they use ctx.mods.
// Kept for internal interpreter use (IMPORT reads files, monitor reads process).
global.math = math; global.os = os; global.YAML = YAML;
global.console = console; global.fs = fsProxy; global.Reflect = Reflect;
global.child_process = cp; global.cp = cp;
[Date, Map, Set, URL, Buffer, Array, Object, Number, BigInt, String, Boolean].forEach(c => global[c.name] = c);

// Default registry files loaded when manifest doesn’t specify its own.
// 90-process.yaml is intentionally excluded from all default manifests.
const DEFAULT_REGISTRY = [
    'config/security/registry/00-builtins.yaml',
    'config/security/registry/10-math.yaml',
    'config/security/registry/20-console.yaml',
    'config/security/registry/30-yaml-module.yaml',
    'config/security/registry/40-os.yaml',
    'config/security/registry/50-fs.yaml',
    'config/security/registry/60-net.yaml',
];

// ---------------------------------------------------------------------------
// Context-aware helpers
// ctx = { mods, vars, functions, mon, scanner }
//
// NOTE (Stage 2): ctx.mods is currently set to `global` so that resolvePath
// behaviour is unchanged. Stage 3 will replace global with the buildMods result.
// ---------------------------------------------------------------------------

const isVar = (k) => typeof k === 'string' && k.startsWith('$');

const resolveArgs = (args, ctx) => {
    if (isVar(args)) return ctx.vars[args] ?? args;
    if (Array.isArray(args)) return args.map(a => resolveArgs(a, ctx));
    if (args && typeof args === 'object') return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, resolveArgs(v, ctx)]));
    return args;
};

const resolvePath = (path, ctx) => {
    const pStr = String(path);
    const parts = pStr.split('.');
    // $-prefixed paths walk ctx.vars; others walk ctx.mods (currently global)
    let fn = pStr.startsWith('$') ? ctx.vars : ctx.mods;
    let context = fn;
    for (const p of parts) {
        if (["prototype", "__proto__", "constructor"].includes(p)) throw new Error("SEC_BLOCK");
        context = fn; fn = Reflect.get(fn, p);
        if (fn === undefined) throw new Error(`Link Fail: ${path}`);
    }
    return { f: fn, c: context };
};

const commands = {
    EXEC: async ([target, rawArgs], ctx, em) => {
        const { f, c } = resolvePath(resolveArgs(target, ctx), ctx);
        const args = resolveArgs(rawArgs || [], ctx).map(a => {
            if (a === "$VARS") return new Proxy(ctx.vars, {
                // Falls back to ctx.mods so programs can pass $VARS as a scope object
                // (e.g., math.evaluate(expr, $VARS) where expr references mods like os.freemem).
                // This is safe: ctx.mods is already risk-filtered; it is NOT raw global.
                get: (t, p) => t[p] ?? ctx.mods[p],
                set: (t, p, v) => { t[p] = v; return true; },
                has: (t, p) => p in t || p in ctx.mods
            });
            return a;
        });
        const res = Reflect.apply(f, c, args);
        ctx.vars["$LAST"] = (res instanceof Promise) ? await res : res;
    },
    NEW: async ([target, rawArgs], ctx) => {
        const { f } = resolvePath(resolveArgs(target, ctx), ctx);
        const args = resolveArgs(rawArgs || [], ctx);
        ctx.vars["$LAST"] = new f(...args);
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

            // Extract only DEF commands from the library (libraries export functions, not side effects).
            for (const step of libBody) {
                if (!Array.isArray(step)) continue;
                const [cmd, args] = step;
                if (cmd === 'DEF') {
                    const [name, body] = Array.isArray(args) ? args : [args, []];
                    if (libScanner && Array.isArray(body)) libScanner.analyze(body);
                    if (name && body) ctx.functions[name] = body;
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
            Object.assign(ctx.functions, content);
        }
    },
    CALL: async ([name, input], ctx, em) => {
        if (!ctx.functions[name]) throw new Error(`Fn Undefined: ${name}`);
        const prevInput = ctx.vars["$INPUT"];
        ctx.vars["$INPUT"] = resolveArgs(input, ctx);
        await run(ctx.functions[name], ctx, em);
        ctx.vars["$INPUT"] = prevInput;
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

async function boot() {
    const [progP, maniP] = process.argv.slice(2);
    if (!progP || !maniP) {
        console.error("Usage: node main.mjs <program.yaml> <manifest.json>");
        process.exit(1);
    }

    const prog = YAML.parse(fs.readFileSync(progP, 'utf8'));
    const mani = YAML.parse(fs.readFileSync(maniP, 'utf8'));

    // --- Determine registry files (used by both scanner and buildMods) ---
    const registryFiles = Array.isArray(mani.registry)
        ? mani.registry.map(name =>
            name.includes('/') ? name : `config/security/registry/${name}.yaml`)
        : DEFAULT_REGISTRY;

    const registryEntries = loadRegistry(registryFiles);

    // --- Safety Gate ---
    // Scanner now uses registry entries instead of a hardcoded blacklist.
    const scanner = new SecurityScanner(mani, registryEntries);
    try {
        scanner.scan(prog);
        console.log("🛡️  Safety Scan Passed.");
    } catch (e) {
        const output = [e.message, null, null];
        console.log("```yaml");
        console.log(YAML.stringify(output).trim());
        console.log("```");
        process.exit(1);
    }

    // --- Build capability Mods ---
    const mods = await buildMods(registryFiles, mani.maxRisk ?? 'LOW');

    // Instrument the capabilities that need resource tracking.
    // These mutate the already-built mods object in place.
    const mon = new ResourceMonitor(mani.quotas);
    if (mods.fs)    mon.instrumentFs(mods.fs);
    if (mods.fetch !== undefined) {
        // Replace the Proxy with a properly monitored fetch implementation.
        mods.fetch = mon.instrumentFetch(globalThis.fetch);
    }

    const ctx = {
        mods,
        vars: {
            "$LAST": null, "$ERROR": null, "$ITEM": null,
            "$USAGE": null, "$INPUT": null, "$RETURN": null
        },
        functions: {},
        mon,
        scanner,
    };

    try {
        await run(prog, ctx, false);
        if (!ctx.vars["$USAGE"]) ctx.vars["$USAGE"] = ctx.mon.usage;
        const output = [null, ctx.vars["$RETURN"] ?? ctx.vars["$LAST"], ctx.vars["$USAGE"]];
        console.log("✅ Execution Finished.");
        console.log("```yaml");
        console.log(YAML.stringify(output).trim());
        console.log("```");
        process.exit(0);
    } catch (e) {
        if (!ctx.vars["$USAGE"]) ctx.vars["$USAGE"] = ctx.mon.usage;
        const output = [e.message, null, ctx.vars["$USAGE"]];
        console.log("❌ Execution Failed.");
        console.log("```yaml");
        console.log(YAML.stringify(output).trim());
        console.log("```");
        process.exit(1);
    }
}

boot().catch(e => {
    if (e.message !== "HARD_STOP" && e.message !== "QUOTA_EXCEEDED") {
        console.error("❌ Unexpected Error:", e.message);
        process.exit(1);
    }
});
