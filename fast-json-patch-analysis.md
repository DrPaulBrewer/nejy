# Analysis: Simplifying `nejy` with `fast-json-patch`

The `fast-json-patch` library is currently listed in `package.json` and registered in `config/security/registry/available/80-json.yaml` under the `jsonpatch` module, but it is not directly utilized within the interpreter's core JavaScript logic.

There are several code sections within `nejy` that could be significantly simplified or made clearer by incorporating `npm:fast-json-patch`.

## 1. Deep Assignment in `SET` and `TO` Commands (`lib/interp/commands.mjs`)
Currently, the `SET` and `TO` commands use the `dot-prop` library to handle assigning values to deeply nested objects inside the context variables:

```javascript
// Current Implementation in lib/interp/commands.mjs
import { setProperty } from 'dot-prop';

SET: ([name, val], ctx) => {
    setProperty(ctx.vars, `$${name}`, resolveArgs(val, ctx));
},
TO: async ([varname, code], ctx, em) => {
    // ... code execution
    setProperty(ctx.vars, `$${varname}`, ctx.vars["$LAST"]);
}
```

**How `fast-json-patch` Simplifies This:**
While `dot-prop` is great for simple dot-notation access (e.g., `$myVar.nested.prop`), it severely limits the user's ability to easily mutate arrays or perform complex structural changes (such as deleting a key or moving a value). Using `fast-json-patch` to process deep assignments (or by introducing a dedicated `PATCH` command that applies RFC 6902 patches) would allow the interpreter to support arbitrary mutations:
* `applyOperation(ctx.vars, { op: 'add', path: '/$myVar/nestedArray/-', value: newItem })`
* `applyOperation(ctx.vars, { op: 'remove', path: '/$myVar/obsoleteKey' })`

This would eliminate the need for `nejy` script writers to use clunky `EXEC` chains to invoke native Array or Object methods (like `$LAST.push` or `delete`) simply to modify their script's internal state.

## 2. Deep Property Resolution in `lib/interp/context.mjs`
The interpreter resolves nested variable arguments and target execution paths using `dot-prop`'s `getProperty` and `hasProperty`.

```javascript
// Current Implementation in lib/interp/context.mjs
import { getProperty, hasProperty, parsePath } from 'dot-prop';

export const isVar = (k, ctx) => {
    // ...
    if (k.includes('.')) return hasProperty(ctx.vars, k);
    return false;
};

export const resolveArgs = (args, ctx) => {
    if (isVar(args, ctx)) {
        if (Object.hasOwn(ctx.vars, args)) return ctx.vars[args];
        return getProperty(ctx.vars, args);
    }
    // ...
}
```

**How `fast-json-patch` Simplifies This:**
`fast-json-patch` includes `getValueByPointer(document, pointer)`. If the language design transitions to using JSON Pointers (e.g., `/$myVar/nested/prop`) instead of or alongside dot notation, `getValueByPointer` could cleanly replace `getProperty`. JSON Pointers naturally handle property keys containing dots (`.`), which currently trick `dot-prop` and require special fast-path checks like `Object.hasOwn(baseObj, pStr)`.

## 3. Custom Path Traversal in `lib/buildMods.mjs`
To resolve nested capability rules and module targets safely without pulling in external runtime libraries during setup, `buildMods.mjs` implements its own naive dot-path traverser:

```javascript
// Current Implementation in lib/buildMods.mjs
function getNestedProp(obj, dotPath) {
  return dotPath.split('.').reduce((o, k) => o?.[k], obj);
}
```

**How `fast-json-patch` Simplifies This:**
This wheel-reinvention could be replaced. If `fast-json-patch` (or `json-pointer`) was utilized universally across the codebase as the standard traversal mechanism, `getNestedProp` could be removed entirely, enforcing a single, standardized, thoroughly tested strategy for object introspection. This reduces maintenance burden and aligns the interpreter's behavior across static scanning, module building, and runtime evaluation.