import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { createRequire } from 'node:module';
import { create, all } from 'mathjs';
import YAML from 'yaml';
import cp from 'node:child_process';
import ResourceMonitor from './monitor/index.js';
import { buildMods } from './lib/buildMods.mjs';

/**
 * 1. SECURITY SCANNER
 * Performs static analysis before execution to enforce maxRisk limits.
 */
class SecurityScanner {
    constructor(manifest) {
        this.manifest = manifest;
        this.riskMap = { "LOW": 0, "MEDIUM": 1, "HIGH": 2, "INSANE": 3 };
        this.currentRisk = this.riskMap[manifest.maxRisk || "LOW"];
    }

    scan(program) {
        if (this.currentRisk >= 3) return; // INSANE skips scan
        this.analyze(program);
    }

    // Determine the required risk level for a raw callable path string.
    riskOf(pathStr) {
        if (typeof pathStr !== 'string') return "LOW";
        if (/prototype|__proto__|constructor/.test(pathStr))
            throw new Error(`SEC_BLOCK: Illegal access pattern in ${pathStr}`);
        if (pathStr === "fetch") return "MEDIUM";
        if (pathStr.startsWith('fs.') || pathStr.startsWith('fsProxy.') || pathStr.startsWith('os.'))
            return "MEDIUM";
        if (pathStr.startsWith('child_process') || pathStr.startsWith('cp.'))
            return "HIGH";
        if (pathStr === "Function" || pathStr.includes("Function"))
            return "INSANE";
        return "LOW";
    }

    checkPath(pathStr) {
        const required = this.riskOf(pathStr);
        if (this.riskMap[required] > this.currentRisk)
            throw new Error(`SEC_BLOCK: '${pathStr}' requires ${required} risk (Manifest: ${this.manifest.maxRisk})`);
    }

    analyze(steps) {
        if (!Array.isArray(steps)) return;
        for (const step of steps) {
            if (!Array.isArray(step)) continue;
            const [path, args = []] = step;

            // Check the command name itself
            this.checkPath(path);

            // For EXEC and NEW, also check the target callable path (args[0])
            if ((path === "EXEC" || path === "NEW") && Array.isArray(args) && typeof args[0] === 'string') {
                this.checkPath(args[0]);
            }

            // For PIPE, check string shorthand targets in each step element
            if (path === "PIPE" && Array.isArray(args)) {
                for (const pipeStep of args) {
                    if (typeof pipeStep === 'string') {
                        if (!pipeStep.startsWith('$')) this.checkPath(pipeStep);
                    } else if (Array.isArray(pipeStep)) {
                        this.analyze([pipeStep]);
                    }
                }
            }

            // Map IMPORT itself to MEDIUM
            if (path === "IMPORT") {
                const required = "MEDIUM";
                if (this.riskMap[required] > this.currentRisk)
                    throw new Error(`SEC_BLOCK: 'IMPORT' requires ${required} risk (Manifest: ${this.manifest.maxRisk})`);
            }

            // For fetch with method, check required level
            if (path === "fetch") {
                const options = (args && typeof args === 'object' && !Array.isArray(args)) ? args : (args[1] || {});
                const method = (options.method || "GET").toUpperCase();
                const required = method === "GET" ? "MEDIUM" : "HIGH";
                if (this.riskMap[required] > this.currentRisk)
                    throw new Error(`SEC_BLOCK: 'fetch' ${method} requires ${required} risk (Manifest: ${this.manifest.maxRisk})`);
            }

            // Recurse into all nested array blocks (IF branches, TRY, FOR_EACH body, DEF body, etc.)
            if (Array.isArray(args)) {
                args.filter(Array.isArray).forEach(branch => this.analyze(branch));
            }
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
    IMPORT: async ([src], ctx) => {
        const url = resolveArgs(src, ctx);
        const content = url.startsWith('http')
            ? await (await fetch(url)).json()
            : YAML.parse(fsProxy.readFileSync(url, 'utf8'));
        // Scan each imported function body before merging
        if (ctx.scanner) {
            for (const [name, body] of Object.entries(content)) {
                ctx.scanner.analyze(body);
            }
        }
        Object.assign(ctx.functions, content);
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
    }
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

    // --- Safety Gate ---
    const scanner = new SecurityScanner(mani);
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
    // Manifest may specify a custom registry list; otherwise use the default.
    const registryFiles = Array.isArray(mani.registry)
        ? mani.registry.map(name =>
            name.includes('/') ? name : `config/security/registry/${name}.yaml`)
        : DEFAULT_REGISTRY;

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
