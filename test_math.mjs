import { create, all } from 'mathjs';
const math = create(all);
const ctx = { vars: {}, mods: {} };
const scope = new Proxy(new Map(), {
    get: (t, p) => {
        if (p === 'get') return (k) => Object.hasOwn(ctx.vars, k) ? ctx.vars[k] : (Object.hasOwn(ctx.mods, k) ? ctx.mods[k] : undefined);
        if (p === 'set') return (k, v) => { ctx.vars[k] = v; return t; };
        if (p === 'has') return (k) => Object.hasOwn(ctx.vars, k) || Object.hasOwn(ctx.mods, k);
        if (p === 'keys') return () => [...Object.keys(ctx.vars), ...Object.keys(ctx.mods)].values();
        const val = Reflect.get(t, p);
        return typeof val === 'function' ? val.bind(t) : val;
    }
});
math.evaluate(" A = 10 ", scope);
console.log(ctx.vars);
math.evaluate(" $A = 10 ", scope);
console.log(ctx.vars);
