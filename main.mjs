import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { createRequire } from 'node:module';
import { create, all } from 'mathjs';
import YAML from 'yaml';
import cp from 'node:child_process';
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
                        // shorthand: "$LAST.toISOString" — skip $var paths, check global paths
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

// --- Interpreter Setup ---
const require = createRequire(import.meta.url);
const math = create(all);
const fsProxy = { ...fs };

global.math = math; global.os = os; global.process = process; global.YAML = YAML;
global.console = console; global.fs = fsProxy; global.Reflect = Reflect;
global.child_process = cp; global.cp = cp;
[Date, Map, Set, URL, Buffer, Array, Object, Number, BigInt, String, Boolean].forEach(c => global[c.name] = c);

let vars = { "$LAST": null, "$ERROR": null, "$ITEM": null, "$USAGE": null, "$INPUT": null, "$RETURN": null };
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
    NEW: async ([target, rawArgs], mon) => {
        const { f } = resolvePath(resolveArgs(target, mon));
        const args = resolveArgs(rawArgs || [], mon);
        vars["$LAST"] = new f(...args);
    },
    SET: ([name, val], mon) => vars[`$${name}`] = resolveArgs(val, mon),
    DEF: ([name, steps]) => functions[name] = steps,
    IMPORT: async ([src], mon, em, scanner) => {
        const url = resolveArgs(src, mon);
        const content = url.startsWith('http') 
            ? await (await fetch(url)).json() 
            : YAML.parse(fsProxy.readFileSync(url, 'utf8'));
        // Scan each imported function body before merging
        if (scanner) {
            for (const [name, body] of Object.entries(content)) {
                scanner.analyze(body);
            }
        }
        Object.assign(functions, content);
    },
    CALL: async ([name, input], mon, em, scanner) => {
        if (!functions[name]) throw new Error(`Fn Undefined: ${name}`);
        const prevInput = vars["$INPUT"];
        vars["$INPUT"] = resolveArgs(input, mon);
        await execute(functions[name], mon, em, scanner);
        vars["$INPUT"] = prevInput;
    },
    PIPE: async ([start, ...steps], mon, em, scanner) => {
        await execute([start], mon, em, scanner);
        for (const step of steps) {
            const [path, args] = Array.isArray(step) ? step : [step, ["$LAST"]];
            commands[path] ? await commands[path](args, mon, em, scanner) : await commands.EXEC([path, args], mon, em, scanner);
        }
    },
    IF: async ([cond, t, f], mon, em, scanner) => {
        const test = Array.isArray(cond) ? (await execute([cond], mon, em, scanner), vars["$LAST"]) : resolveArgs(cond, mon);
        await execute(test ? t : f, mon, em, scanner);
    },
    FOR_EACH: async ([listSpec, sub], mon, em, scanner) => {
        const list = resolveArgs(listSpec, mon);
        const limit = typeof list === 'number' ? list : (Array.isArray(list) ? list.length : 0);
        for (let i = 0; i < limit; i++) {
            vars["$ITEM"] = typeof list === 'number' ? i : list[i];
            await execute(sub, mon, em, scanner);
            if (i % 5000 === 0 && !em) mon.checkResources();
        }
    },
    TRY: async ([tryB, catchB], mon, em, scanner) => {
        try { await execute(tryB, mon, em, scanner); } 
        catch (e) { 
            if (e.type === "RETURN_SIGNAL") throw e;
            vars["$ERROR"] = e.message; 
            if (catchB) await execute(catchB, mon, em, scanner); 
        }
    }
};

async function execute(steps, mon, em = false, scanner = null) {
    if (!Array.isArray(steps)) return;
    for (const step of steps) {
        try {
            if (!em) mon.checkResources();
            const [path, args] = step;
            if (commands[path]) await commands[path](args, mon, em, scanner);
            else await commands.EXEC([path, args], mon, em, scanner);
        } catch (err) {
            if (err.type === "RETURN_SIGNAL") throw err;
            if (err.message === "QUOTA_EXCEEDED" && !em) {
                vars["$USAGE"] = mon.usage;
                vars["$ERROR"] = "QUOTA_EXCEEDED";
                if (functions.ON_QUOTA) await execute(functions.ON_QUOTA, mon, true, scanner);
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
        vars["$ERROR"] = e.message;
        const output = [vars["$ERROR"], null, null];
        console.log("```yaml");
        console.log(YAML.stringify(output).trim());
        console.log("```");
        process.exit(1);
    }

    // --- Runtime Instrumentation ---
    const mon = new ResourceMonitor(mani.quotas);
    mon.instrumentFs(global.fs);
    global.fetch = mon.instrumentFetch(global.fetch);

    try {
        await execute(prog, mon, false, scanner);
        if (!vars["$USAGE"]) vars["$USAGE"] = mon.usage;
        const output = [null, vars["$RETURN"] ?? vars["$LAST"], vars["$USAGE"]];
        console.log("✅ Execution Finished.");
        console.log("```yaml");
        console.log(YAML.stringify(output).trim());
        console.log("```");
        process.exit(0);
    } catch (e) {
        vars["$ERROR"] = e.message;
        if (!vars["$USAGE"]) vars["$USAGE"] = mon.usage;
        const output = [vars["$ERROR"], null, vars["$USAGE"]];
        console.log("❌ Execution Failed.");
        console.log("```yaml");
        console.log(YAML.stringify(output).trim());
        console.log("```");
        process.exit(1);
    }
}

boot().catch(e => { 
    if (e.message !== "HARD_STOP" && e.message !== "QUOTA_EXCEEDED" && !vars["$ERROR"]) {
        console.error("❌ Unexpected Error:", e.message); 
        process.exit(1);
    }
});
