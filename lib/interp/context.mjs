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
