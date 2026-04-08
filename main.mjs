import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { createRequire } from 'node:module';
import { create, all } from 'mathjs';
import YAML from 'yaml';
import ResourceMonitor from './monitor/index.js';

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

    analyze(steps) {
        if (!Array.isArray(steps)) return;
        for (const step of steps) {
            if (!Array.isArray(step)) continue;
            const [path, args = []] = step;

            // Block Prototype Pollution
            if (typeof path === 'string' && /prototype|__proto__|constructor/.test(path)) {
                throw new Error(`SEC_BLOCK: Illegal access pattern in ${path}`);
            }

            let required = "LOW";

            // Map commands to Risk Levels
            if (path === "IMPORT") required = "MEDIUM";
            if (path === "fetch") {
                const options = (args && typeof args === 'object' && !Array.isArray(args)) ? args : (args[1] || {});
                const method = (options.method || "GET").toUpperCase();
                required = method === "GET" ? "MEDIUM" : "HIGH";
            }
            if (typeof path === 'string' && (path.startsWith('fs.') || path.startsWith('fsProxy.'))) {
                required = "MEDIUM";
            }
            if (typeof path === 'string' && (path.startsWith('child_process') || path.startsWith('cp.'))) {
                required = "HIGH";
            }
            if (path === "Function" || (typeof path === 'string' && path.includes("Function"))) {
                required = "INSANE";
            }

            if (this.riskMap[required] > this.currentRisk) {
                throw new Error(`SEC_BLOCK: '${path}' requires ${required} risk (Manifest: ${this.manifest.maxRisk})`);
            }

            // Recurse into all nested blocks (IF branches, TRY blocks, FOR_EACH body, DEF body)
            if (Array.isArray(args)) {
                args.filter(Array.isArray).forEach(branch => this.analyze(branch));
            }
        }
    }
}

// --- Interpreter Setup ---
const require = createRequire(import.meta.url);
const math = create(all);
const fsProxy = { ...fs };

global.math = math; global.os = os; global.process = process; global.YAML = YAML;
global.console = console; global.fs = fsProxy; global.Reflect = Reflect;
[Date, Map, Set, URL, Buffer, Array, Object, Number, BigInt, String, Boolean].forEach(c => global[c.name] = c);

let vars = { "$LAST": null, "$ERROR": null, "$ITEM": null, "$USAGE": null, "$INPUT": null };
const functions = {};

const isVar = (k) => typeof k === 'string' && k.startsWith('$');
const resolveArgs = (args, mon) => {
    if (isVar(args)) return vars[args] ?? args;
    if (Array.isArray(args)) return args.map(a => resolveArgs(a, mon));
    if (args && typeof args === 'object') return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, resolveArgs(v, mon)]));
    return args;
};

const resolvePath = (path) => {
    const pStr = String(path);
    const parts = pStr.split('.');
    let fn = pStr.startsWith('$') ? vars : global;
    let context = fn;
    for (const p of parts) {
        if (["prototype", "__proto__", "constructor"].includes(p)) throw new Error("SEC_BLOCK");
        context = fn; fn = Reflect.get(fn, p);
        if (fn === undefined) throw new Error(`Link Fail: ${path}`);
    }
    return { f: fn, c: context };
};

const commands = {
    EXEC: async ([target, rawArgs], mon) => {
        const { f, c } = resolvePath(resolveArgs(target, mon));
        const args = resolveArgs(rawArgs || [], mon).map(a => {
            if (a === "$VARS") return new Proxy(vars, {
                get: (t, p) => t[p] ?? global[p],
                set: (t, p, v) => { t[p] = v; return true; },
                has: (t, p) => p in t || p in global
            });
            return a;
        });
        const res = Reflect.apply(f, c, args);
        vars["$LAST"] = (res instanceof Promise) ? await res : res;
    },
    SET: ([name, val], mon) => vars[`$${name}`] = resolveArgs(val, mon),
    DEF: ([name, steps]) => functions[name] = steps,
    IMPORT: async ([src], mon) => {
        const url = resolveArgs(src, mon);
        const content = url.startsWith('http') 
            ? await (await fetch(url)).json() 
            : YAML.parse(fsProxy.readFileSync(url, 'utf8'));
        Object.assign(functions, content);
    },
    CALL: async ([name, input], mon, em) => {
        if (!functions[name]) throw new Error(`Fn Undefined: ${name}`);
        const prevInput = vars["$INPUT"];
        vars["$INPUT"] = resolveArgs(input, mon);
        await execute(functions[name], mon, em);
        vars["$INPUT"] = prevInput;
    },
    PIPE: async ([start, ...steps], mon, em) => {
        await execute([start], mon, em);
        for (const step of steps) {
            const [path, args] = Array.isArray(step) ? step : [step, ["$LAST"]];
            commands[path] ? await commands[path](args, mon, em) : await commands.EXEC([path, args], mon, em);
        }
    },
    IF: async ([cond, t, f], mon, em) => {
        const test = Array.isArray(cond) ? (await execute([cond], mon, em), vars["$LAST"]) : resolveArgs(cond, mon);
        await execute(test ? t : f, mon, em);
    },
    FOR_EACH: async ([listSpec, sub], mon, em) => {
        const list = resolveArgs(listSpec, mon);
        const limit = typeof list === 'number' ? list : (Array.isArray(list) ? list.length : 0);
        for (let i = 0; i < limit; i++) {
            vars["$ITEM"] = typeof list === 'number' ? i : list[i];
            await execute(sub, mon, em);
            if (i % 5000 === 0 && !em) mon.checkResources();
        }
    },
    TRY: async ([tryB, catchB], mon, em) => {
        try { await execute(tryB, mon, em); } 
        catch (e) { 
            if (e.type === "RETURN_SIGNAL") throw e;
            vars["$ERROR"] = e.message; 
            if (catchB) await execute(catchB, mon, em); 
        }
    }
};

async function execute(steps, mon, em = false) {
    if (!Array.isArray(steps)) return;
    for (const step of steps) {
        try {
            if (!em) mon.checkResources();
            const [path, args] = step;
            if (commands[path]) await commands[path](args, mon, em);
            else await commands.EXEC([path, args], mon, em);
        } catch (err) {
            if (err.type === "RETURN_SIGNAL") throw err;
            if (err.message === "QUOTA_EXCEEDED" && !em) {
                vars["$USAGE"] = mon.usage;
                if (functions.ON_QUOTA) await execute(functions.ON_QUOTA, mon, true);
                process.exit(1);
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
    scanner.scan(prog);
    console.log("🛡️  Safety Scan Passed.");

    // --- Runtime Instrumentation ---
    const mon = new ResourceMonitor(mani.quotas);
    mon.instrumentFs(global.fs);
    global.fetch = mon.instrumentFetch(global.fetch);

    await execute(prog, mon);
    console.log("✅ Execution Finished.");
}

boot().catch(e => { 
    if (e.message !== "HARD_STOP") console.error("❌", e.message); 
});
