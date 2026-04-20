import { checkNoPrototypePollution } from './scanner.mjs';

import { getProperty, hasProperty, parsePath } from 'dot-prop';

export const isVar = (k, ctx) => {
    if (typeof k !== 'string' || !k.startsWith('$')) return false;
    if (Object.hasOwn(ctx.vars, k)) return true;
    if (k.includes('.')) return hasProperty(ctx.vars, k);
    return false;
};

export const resolveArgs = (args, ctx) => {
    if (isVar(args, ctx)) {
        if (Object.hasOwn(ctx.vars, args)) return ctx.vars[args];
        return getProperty(ctx.vars, args);
    }
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

export const resolvePath = (path, ctx) => {
    const pStr = String(path);

    // $-prefixed paths walk ctx.vars; others walk ctx.mods
    let baseObj = pStr.startsWith('$') ? ctx.vars : ctx.mods;

    // Fast path: Exact match on object key (useful for literal keys like "Promise.all" in ctx.mods)
    if (Object.hasOwn(baseObj, pStr)) {
        return { f: baseObj[pStr], c: baseObj };
    }

    // Check for prototype pollution in any part of the path
    const parsed = parsePath(pStr);
    for (const p of parsed) {
        if (["prototype", "__proto__", "constructor"].includes(String(p))) throw new Error("SEC_BLOCK");
    }

    if (parsed.length === 1) {
        const fn = getProperty(baseObj, parsed);
        if (fn === undefined) throw new Error(`Link Fail: ${path}`);
        return { f: fn, c: baseObj };
    } else {
        const parentPath = parsed.slice(0, -1);
        const context = getProperty(baseObj, parentPath);
        const fn = getProperty(baseObj, parsed);
        if (fn === undefined) throw new Error(`Link Fail: ${path}`);
        return { f: fn, c: context };
    }
};

export function removePP(obj) {
    if (obj !== null && typeof obj === 'object') {
        const proto = Object.getPrototypeOf(obj);
        const isPlainObject = proto === Object.prototype || proto === null;
        const isArray = proto === Array.prototype || Array.isArray(obj);

        if (isPlainObject || isArray) {
            try {
                const clean = structuredClone(obj);
                if (isPlainObject) {
                    Object.setPrototypeOf(clean, null);
                }
                delete clean.constructor;
                return clean;
            } catch (e) {
                return obj;
            }
        }
    }
    return obj;
}


/**
 * Validates a formal argument name or destructured object against prototype pollution.
 * Optionally rejects pass-by-reference (&).
 * Invokes the `onValidArg` callback for each valid bound variable name, allowing
 * runtime command handlers (like F and MATH) to customize their processing.
 *
 * @param {string|object} formalArg
 * @param {boolean} allowRef
 * @param {string} cmdName Used for error messages
 * @param {Function} [onValidArg] Signature: (propName, cleanName, isRef)
 */
export const processFormalArg = (formalArg, allowRef, cmdName, onValidArg) => {
    if (typeof formalArg === 'string') {
        if (/prototype|__proto__|constructor/.test(formalArg)) {
            throw new Error(`SEC_BLOCK: Illegal argument name '${formalArg}'`);
        }
        if (!allowRef && formalArg.startsWith('&')) {
            throw new Error(`${cmdName === 'MATH' ? 'Command parsing error' : 'SEC_BLOCK'}: ${cmdName} does not support pass-by-reference (& prefix)`);
        }
        if (onValidArg) {
            const isRef = formalArg.startsWith('&');
            const cleanName = isRef ? formalArg.slice(1) : formalArg;
            onValidArg(null, cleanName, isRef);
        }
    } else if (formalArg && typeof formalArg === 'object') {
        for (const [key, mapTo] of Object.entries(formalArg)) {
            if (/prototype|__proto__|constructor/.test(key) ||
                (typeof mapTo === 'string' && /prototype|__proto__|constructor/.test(mapTo))) {
                throw new Error(`SEC_BLOCK: Illegal argument name in destructuring`);
            }
            if (!allowRef && typeof mapTo === 'string' && mapTo.startsWith('&')) {
                throw new Error(`${cmdName === 'MATH' ? 'Command parsing error' : 'SEC_BLOCK'}: ${cmdName} does not support pass-by-reference (& prefix)`);
            }
            if (onValidArg) {
                const isRef = typeof mapTo === 'string' && mapTo.startsWith('&');
                const cleanName = isRef ? mapTo.slice(1) : mapTo;
                onValidArg(key, cleanName, isRef);
            }
        }
    } else {
        throw new Error(`SEC_BLOCK: Invalid formal argument type: ${typeof formalArg}`);
    }
};

export const createVarsProxy = (ctx) => {
    return new Proxy(new Map(), {
        // Falls back to ctx.mods so programs can pass $VARS as a scope object
        // (e.g., math.evaluate(expr, $VARS) where expr references mods like os.freemem).
        // This is safe: ctx.mods is already risk-filtered; it is NOT raw global.
        get: (t, p) => {
            if (p === 'get') return (k) => Object.hasOwn(ctx.vars, k) ? ctx.vars[k] : (Object.hasOwn(ctx.mods, k) ? ctx.mods[k] : undefined);
            if (p === 'set') return (k, v) => {
                const finalKey = k.startsWith('$') ? k : `$${k}`;
                ctx.vars[finalKey] = v;
                return t;
            };
            if (p === 'has') return (k) => Object.hasOwn(ctx.vars, k) || Object.hasOwn(ctx.mods, k);
            if (p === 'keys') return () => [...Object.keys(ctx.vars), ...Object.keys(ctx.mods)].values();
            const val = Reflect.get(t, p);
            return typeof val === 'function' ? val.bind(t) : val;
        }
    });
};
