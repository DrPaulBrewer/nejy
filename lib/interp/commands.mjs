import fs from 'node:fs';
import YAML from 'yaml';
import { setProperty } from 'dot-prop';
import { resolveArgs, resolvePath, removePP, isVar, processFormalArg, createVarsProxy } from './context.mjs';
import { SecurityScanner } from './scanner.mjs';
import { buildMods, pathInRequest } from '../buildMods.mjs';
import { create, all } from 'mathjs';
import { handleChildCommand } from './childCommand.mjs';

const math = create(all);
const fsProxy = { ...fs };

// ---------------------------------------------------------------------------
// Internal helper: store a result in ctx.vars under a named dest.
// dest may be a bare name like "host" or prefixed "$host"; RETURN is special.
// ---------------------------------------------------------------------------
function storeResult(dest, val, ctx) {
    if (!dest) return;
    const key = dest.startsWith('$') ? dest : `$${dest}`;
    setProperty(ctx.vars, key, val);
}

// ---------------------------------------------------------------------------
// Internal helper: parse the optional third element of an EXEC args array.
// Returns { dest, chain, compose, promise }
// ---------------------------------------------------------------------------
function parseExecDest(thirdArg) {
    if (thirdArg === undefined || thirdArg === null) {
        return { dest: null, chain: null, compose: null, promise: false };
    }
    if (typeof thirdArg === 'string') {
        return { dest: thirdArg, chain: null, compose: null, promise: false };
    }
    if (typeof thirdArg === 'object') {
        return {
            dest:    thirdArg.into    ?? thirdArg.promise ?? null,
            chain:   thirdArg.chain   ?? null,
            compose: thirdArg.compose ?? null,
            promise: 'promise' in thirdArg,
        };
    }
    return { dest: null, chain: null, compose: null, promise: false };
}

const carryOverBasicVars = (childVars, ctx) => {
    const basicVars = ["$ERROR", "$ITEM", "$USAGE", "$INPUT", "$RETURN"];
    for (const v of basicVars) {
        childVars[v] = structuredClone(ctx.vars[v] ?? null);
    }
    return childVars;
};

export const commands = {
    EXEC: async ([target, rawArgs, thirdArg], ctx, em) => {
        const { dest, chain, compose, promise } = parseExecDest(thirdArg);
        const { f, c } = resolvePath(target, ctx);
        if (typeof f !== 'function') {
            throw new Error(`Type Error: Target '${target}' does not resolve to a function`);
        }

        const args = resolveArgs(rawArgs || [], ctx).map(a => {
            if (a === "$VARS") return createVarsProxy(ctx);
            return a;
        });

        let res = Reflect.apply(f, c, args);

        // CHAIN: apply successive method calls on the accumulated value
        if (chain) {
            let acc = (res instanceof Promise) ? await res : res;
            for (const [method, chainArgs] of chain) {
                const resolvedChainArgs = resolveArgs(chainArgs || [], ctx);
                acc = acc[method](...resolvedChainArgs);
                if (acc instanceof Promise) acc = await acc;
            }
            res = acc;
            storeResult(dest, removePP(res), ctx);
            return;
        }

        // COMPOSE: apply successive functions left-to-right
        if (compose) {
            let acc = (res instanceof Promise) ? await res : res;
            for (const step of compose) {
                const [fnPath, extraArgs] = Array.isArray(step) ? step : [step, []];
                const { f: cf, c: cc } = resolvePath(fnPath, ctx);
                const extra = resolveArgs(extraArgs || [], ctx);
                acc = Reflect.apply(cf, cc, [acc, ...extra]);
                if (acc instanceof Promise) acc = await acc;
            }
            res = acc;
            storeResult(dest, removePP(res), ctx);
            return;
        }

        // PROMISE mode: store the raw (potentially unresolved) promise
        if (promise) {
            storeResult(dest, res, ctx);
            return;
        }

        // Default: await and store
        const finalVal = removePP((res instanceof Promise) ? await res : res);
        if (dest) storeResult(dest, finalVal, ctx);
    },

    AWAIT: async ([srcVar, dest], ctx) => {
        const key = (typeof srcVar === 'string' && srcVar.startsWith('$')) ? srcVar : `$${srcVar}`;
        const thenable = ctx.vars[key];
        if (thenable == null || typeof thenable.then !== 'function') {
            throw new Error(`AWAIT: '${key}' is not a thenable (got ${typeof thenable})`);
        }
        const resolved = removePP(await thenable);
        if (dest) storeResult(dest, resolved, ctx);
    },

    NEW: async ([target, rawArgs, dest], ctx) => {
        const { f } = resolvePath(target, ctx);
        if (typeof f !== 'function') {
            throw new Error(`Type Error: Target '${target}' does not resolve to a function`);
        }
        const args = resolveArgs(rawArgs || [], ctx);
        const val = new f(...args);
        if (dest) storeResult(dest, val, ctx);
    },

    LITERAL: (args, ctx, em, thirdArg) => {
        const val = structuredClone(args);
        if (thirdArg) storeResult(thirdArg, val, ctx);
    },

    SET: ([name, val], ctx) => {
        setProperty(ctx.vars, `$${name}`, resolveArgs(val, ctx));
    },

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
                formalArgs.pop();
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
                        if (stepsStr.includes(`"${varName}"`) || stepsStr.includes(`"${funcName}"`)) {
                            if (ctx.vars[varName] !== undefined) {
                                capturedVars[varName] = ctx.vars[varName];
                            }
                        }
                    }
                }
            }
        }

        const fn = async (...actualArgs) => {
            const childVars = { ...capturedVars };

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

            const ret = childCtx.vars["$RETURN"];
            return removePP(structuredClone(ret));
        };

        const varName = name.startsWith('$') ? name : `$${name}`;
        ctx.vars[varName] = fn;
        if (ctx.history && Array.isArray(ctx.history)) {
            ctx.history.push(["F", [name, formalArgsOriginal, steps]]);
        }
    },

    MATH: ([name, formalArgs, expr], ctx) => {
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
    },

    IF: async ([cond, t, f], ctx, em) => {
        const test = resolveArgs(cond, ctx);
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

    CHILD: handleChildCommand,

    SANDBOX: async ([initOpts, subprogram, dest], ctx, em) => {
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

        if (childCtx.vars["$RETURN"] !== undefined && dest) {
            storeResult(dest, structuredClone(childCtx.vars["$RETURN"]), ctx);
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
            const [path, args, thirdArg] = step;
            if (typeof path === 'string' && path.startsWith(' ')) {
                if (!ctx.mods.math || typeof ctx.mods.math.evaluate !== 'function') {
                    throw new Error(`Type Error: Target 'math.evaluate' does not resolve to a function`);
                }
                const res = ctx.mods.math.evaluate(path.trim(), createVarsProxy(ctx));
                const finalVal = removePP((res instanceof Promise) ? await res : res);
                if (thirdArg) storeResult(thirdArg, finalVal, ctx);
            }
            else if (commands[path]) await commands[path](args, ctx, em, thirdArg);
            else await commands.EXEC([path, args, thirdArg], ctx, em);
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
