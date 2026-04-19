import fs from 'node:fs';
import YAML from 'yaml';
import { resolveArgs, resolvePath, removePP, isVar, processFormalArg } from './context.mjs';
import { SecurityScanner } from './scanner.mjs';
import { buildMods, pathInRequest } from '../buildMods.mjs';
import { create, all } from 'mathjs';
import { handleChildCommand } from './childCommand.mjs';

const math = create(all);
const fsProxy = { ...fs };

const carryOverBasicVars = (childVars, ctx) => {
    const basicVars = ["$LAST", "$ERROR", "$ITEM", "$USAGE", "$INPUT", "$RETURN"];
    for (const v of basicVars) {
        childVars[v] = structuredClone(ctx.vars[v] ?? null);
    }
    return childVars;
};

export const commands = {
    EXEC: async ([target, rawArgs], ctx, em) => {
        const { f, c } = resolvePath(target, ctx);
        if (typeof f !== 'function') {
            throw new Error(`Type Error: Target '${target}' does not resolve to a function`);
        }

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
    PROMISE: async ([target, rawArgs], ctx, em) => {
        const { f, c } = resolvePath(target, ctx);
        if (typeof f !== 'function') {
            throw new Error(`Type Error: Target '${target}' does not resolve to a function`);
        }

        const args = resolveArgs(rawArgs || [], ctx).map(a => {
            if (a === "$VARS") return new Proxy(new Map(), {
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
        ctx.vars["$LAST"] = (res instanceof Promise) ? res : removePP(res);
    },
    NEW: async ([target, rawArgs], ctx) => {
        const { f } = resolvePath(target, ctx);
        if (typeof f !== 'function') {
            throw new Error(`Type Error: Target '${target}' does not resolve to a function`);
        }
        const args = resolveArgs(rawArgs || [], ctx);
        ctx.vars["$LAST"] = new f(...args);
    },
    LITERAL: (args, ctx) => {
        ctx.vars["$LAST"] = structuredClone(args);
    },
    SET: ([name, val], ctx) => { ctx.vars[`$${name}`] = resolveArgs(val, ctx); },
    F: ([name, formalArgsOriginal, steps], ctx) => {
        const readOnlyProxy = (obj) => new Proxy(obj, {
            set: () => { throw new Error("SEC_BLOCK: Cannot modify parent context from F function"); },
            defineProperty: () => { throw new Error("SEC_BLOCK: Cannot modify parent context from F function"); },
            deleteProperty: () => { throw new Error("SEC_BLOCK: Cannot modify parent context from F function"); },
            setPrototypeOf: () => { throw new Error("SEC_BLOCK: Cannot modify parent context from F function"); }
        });

        let includesAllFunctions = false;
        let formalArgs = [...formalArgsOriginal];
        for (let i = 0; i < formalArgs.length; i++) {
            if (typeof formalArgs[i] === 'string' && formalArgs[i].toLowerCase() === 'all functions') {
                if (i !== formalArgs.length - 1) {
                    throw new Error("Command parsing error: 'all Functions' must be the last parameter");
                }
                includesAllFunctions = true;
                formalArgs.pop(); // Remove the pseudo-parameter so it doesn't try to map it
                break;
            }
        }

        const capturedVars = {};
        if (includesAllFunctions) {
            const stepsStr = JSON.stringify(steps);
            if (ctx.history && Array.isArray(ctx.history)) {
                for (const item of ctx.history) {
                    if (item[0] === 'F' || item[0] === 'MATH') {
                        const funcName = item[1][0];
                        const varName = funcName.startsWith('$') ? funcName : `$${funcName}`;
                        // Use basic string matching on serialized steps
                        if (stepsStr.includes(`"${varName}"`) || stepsStr.includes(`"${funcName}"`)) {
                            if (ctx.vars[varName] !== undefined) {
                                capturedVars[varName] = ctx.vars[varName]; // Copy by reference at definition time
                            }
                        }
                    }
                }
            }
        }

        const fn = async (...actualArgs) => {
            const childVars = { ...capturedVars };

            // Map actual arguments to formal argument names
            for (let i = 0; i < formalArgs.length; i++) {
                const actualArg = actualArgs[i];
                processFormalArg(formalArgs[i], true, 'F', (propKey, cleanName, isRef) => {
                    const argName = cleanName.startsWith('$') ? cleanName : `$${cleanName}`;
                    const val = propKey === null ? actualArg : actualArg?.[propKey];
                    if (val !== undefined) {
                        childVars[argName] = isRef ? val : structuredClone(val);
                    } else {
                        childVars[argName] = null;
                    }
                });
            }

            const childCtx = {
                mods: readOnlyProxy(ctx.mods),
                vars: childVars,
                mon: ctx.mon,
                scanner: ctx.scanner,
                history: Array.isArray(ctx.history) ? [...ctx.history] : undefined
            };

            await run(steps, childCtx, false);

            const ret = childCtx.vars["$RETURN"] ?? childCtx.vars["$LAST"];
            return removePP(structuredClone(ret));
        };

        const varName = name.startsWith('$') ? name : `$${name}`;
        ctx.vars[varName] = fn;
        if (ctx.history && Array.isArray(ctx.history)) {
            ctx.history.push(["F", [name, formalArgsOriginal, steps]]);
        }
    },
    MATH: ([name, formalArgs, expr], ctx) => {
        // Build an array of destructured parameter mappings at creation time.
        // mapping object matches formal argument indices to { keyPath: string, cleanName: string }
        const paramMappings = [];

        for (let i = 0; i < formalArgs.length; i++) {
            processFormalArg(formalArgs[i], false, 'MATH', (propKey, cleanName) => {
                paramMappings.push({ idx: i, prop: propKey, cleanName });
            });
        }

        const compiled = math.compile(expr);

        const fn = (...actualArgs) => {
            const scope = new Map();
            for (const map of paramMappings) {
                if (map.prop === null) {
                    scope.set(map.cleanName, actualArgs[map.idx]);
                } else {
                    const argVal = actualArgs[map.idx];
                    scope.set(map.cleanName, argVal ? argVal[map.prop] : undefined);
                }
            }
            return compiled.evaluate(scope);
        };

        const varName = name.startsWith('$') ? name : `$${name}`;
        ctx.vars[varName] = fn;
        if (ctx.history && Array.isArray(ctx.history)) {
            ctx.history.push(["MATH", [name, formalArgs, expr]]);
        }
    },
    REQUEST: () => {
        // Fully handled at scan time — no-op at runtime.
        // scan() validates position, items, and risk before execution begins.
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
     * Syntax: ["TO", ["varname", code]]   ← same 2-element convention as every command
     */
    TO: async ([varname, code], ctx, em) => {
        const block = (Array.isArray(code) && typeof code[0] === 'string') ? [code] : code;
        await run(block, ctx, em);
        ctx.vars[`$${varname}`] = ctx.vars["$LAST"];
    },
    CHILD: handleChildCommand,
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
                carryOverBasicVars(childVars, ctx);
            } else if (initOpts.context && typeof initOpts.context === 'object') {
                for (const [k, v] of Object.entries(initOpts.context)) {
                    childVars[k] = structuredClone(resolveArgs(v, ctx) ?? null);
                }
                carryOverBasicVars(childVars, ctx);
            } else {
                carryOverBasicVars(childVars, ctx);
            }
        }

        const registryEntries = ctx.scanner ? ctx.scanner.registryEntries : [];
        const childMods = await buildMods(registryEntries, childPolicy, childCapabilities);

        if (childMods.fs && ctx.mon) ctx.mon.instrumentFs(childMods.fs);

        const childCtx = {
            mods: childMods,
            vars: childVars,
            mon: ctx.mon,
            scanner: ctx.scanner ? new SecurityScanner(
                 { ...ctx.scanner.manifest, maxRisk: childPolicy },
                 registryEntries
            ) : null,
            history: Array.isArray(ctx.history) ? structuredClone(ctx.history) : undefined
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
 * @param {object}  ctx   - { mods, vars, mon, scanner }
 * @param {boolean} em    - emergency mode (skip resource checks)
 */
export async function run(steps, ctx, em = false) {
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
                if (typeof ctx.vars["$ON_QUOTA"] === 'function') {
                    try {
                        await ctx.vars["$ON_QUOTA"](ctx.mon.usage, ctx.vars);
                    } catch (quotaErr) {
                        if (quotaErr.message !== "QUOTA_EXCEEDED" && quotaErr.message !== "HARD_STOP") {
                            throw quotaErr;
                        }
                    }
                }
                throw err;
            }
            throw err;
        }
    }
}
