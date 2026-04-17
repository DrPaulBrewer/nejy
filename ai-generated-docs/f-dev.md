# `F` Command Developer Documentation

This document serves as technical documentation for developers working on the `nejy` interpreter. It details the internal mechanics of the `F` command.

## Overview
The `F` command replaces the legacy `DEF` and `CALL` mechanisms. Unlike `DEF` which simply stored raw AST step arrays inside a separate `ctx.functions` state bucket, `F` generates an actual asynchronous JavaScript function and stores it directly into the execution context's variable pool (`ctx.vars`).

Because `F` creates a real JS function, it relies natively on the `EXEC` command for invocation rather than needing a custom `CALL` handler.

---

## 1. Context Isolation and Protection
When an `F` function is invoked, it runs inside a newly generated child context. To prevent malicious or poorly written scripts from modifying the parent environment, `F` utilizes a `readOnlyProxy`.

### Proxy Implementation (`lib/interp/commands.mjs`)
```javascript
const readOnlyProxy = (obj) => new Proxy(obj, {
    set: () => { throw new Error("SEC_BLOCK: Cannot modify parent context from F function"); },
    defineProperty: () => { throw new Error("SEC_BLOCK: Cannot modify parent context from F function"); },
    deleteProperty: () => { throw new Error("SEC_BLOCK: Cannot modify parent context from F function"); },
    setPrototypeOf: () => { throw new Error("SEC_BLOCK: Cannot modify parent context from F function"); }
});
```

This proxy wraps `ctx.mods` during child context initialization. `ctx.vars` is completely isolated; the child gets a brand new `{}` object populated only with explicitly passed formal arguments. The resource monitor (`ctx.mon`) is passed by reference so the worker can continue tracking global quota consumption correctly.

---

## 2. Argument Processing and Destructuring
The `F` command maps the incoming `actualArgs` provided during an `EXEC` call to the `formalArgs` defined in the AST.

By default, nejy uses `structuredClone()` to deeply copy data as it crosses the function boundary, enforcing strict isolation. However, to support performance-critical workloads (like `$USAGE` reporting) and live context passing (`$VARS`), `F` supports by-reference argument parsing via the `&` operator. It also supports object destructuring.

### The `processArg` Helper (`lib/interp/commands.mjs`)
```javascript
const processArg = (formalArg, actualArg, childVars) => {
    if (typeof formalArg === 'string') {
        // ... (Prototype Pollution check omitted for brevity)
        const isRef = formalArg.startsWith('&');
        const cleanName = isRef ? formalArg.slice(1) : formalArg;
        const argName = cleanName.startsWith('$') ? cleanName : `$${cleanName}`;

        if (actualArg !== undefined) {
            childVars[argName] = isRef ? actualArg : structuredClone(actualArg);
        } else {
            childVars[argName] = null;
        }
    } else if (formalArg && typeof formalArg === 'object') {
        for (const [key, mapTo] of Object.entries(formalArg)) {
            // ... (Prototype Pollution check omitted for brevity)
            const isRef = typeof mapTo === 'string' && mapTo.startsWith('&');
            const cleanName = isRef ? mapTo.slice(1) : mapTo;
            const argName = cleanName.startsWith('$') ? cleanName : `$${cleanName}`;

            const val = actualArg?.[key];
            if (val !== undefined) {
                childVars[argName] = isRef ? val : structuredClone(val);
            } else {
                childVars[argName] = null;
            }
        }
    }
};
```

---

## 3. Prototype Pollution Defenses
The `SecurityScanner` and the runtime `F` implementation work together to ensure that function argument declarations cannot be used to pollute the JavaScript prototype chain.

### Static Scanning (`lib/interp/scanner.mjs`)
The static scanner verifies the function name itself:
```javascript
case 'F':
    if (args[0] && typeof args[0] === 'string') {
        // Function name is safe enough here as literal or string, but check for PP
        if (/prototype|__proto__|constructor/.test(args[0])) {
            throw new Error(`SEC_BLOCK: Illegal function name '${args[0]}'`);
        }
    }
    if (Array.isArray(args[2])) await this.analyze(args[2]);    // function body
    break;
```

### Runtime Checks (`lib/interp/commands.mjs`)
At runtime, `processArg` strictly checks every formal argument string and every key/value in an object destructuring mapping:
```javascript
if (/prototype|__proto__|constructor/.test(formalArg)) {
     throw new Error(`SEC_BLOCK: Illegal argument name '${formalArg}'`);
}
```

---

## 4. Execution and Return values
When the returned JS async function is called via `EXEC`, it triggers `run(steps, childCtx, false)`. Once the AST finishes processing, the function determines what to return to the parent.

```javascript
const fn = async (...actualArgs) => {
    // ... [Argument mapping into childVars] ...

    const childCtx = {
        mods: readOnlyProxy(ctx.mods),
        vars: childVars,
        mon: ctx.mon,
        scanner: ctx.scanner
    };

    await run(steps, childCtx, false);

    // If $RETURN is set, yield it. Otherwise, yield the final $LAST value.
    const ret = childCtx.vars["$RETURN"] ?? childCtx.vars["$LAST"];

    // removePP sanitizes the return object from prototype pollution
    // before it crosses back to the parent execution context.
    return removePP(structuredClone(ret));
};
```