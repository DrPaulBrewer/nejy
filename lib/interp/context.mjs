import { checkNoPrototypePollution } from './scanner.mjs';

export const isVar = (k, ctx) => typeof k === 'string' && k.startsWith('$') && (k in ctx.vars);

export const resolveArgs = (args, ctx) => {
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

export const resolvePath = (path, ctx) => {
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

export function removePP(obj) {
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
