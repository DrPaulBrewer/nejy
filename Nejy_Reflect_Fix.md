# Nejy Reflect.get Native Error - Root Cause Analysis

## The Issue
When evaluating command pathways in `main.mjs` (e.g., executing `["$packetString.match"]`), Nejy executes `resolvePath` which iteratively unwraps dot notation properties until it finds the ultimate function to run. 

Currently, `resolvePath` looks like this:
```javascript
const resolvePath = (path, ctx) => {
    ...
    for (const p of parts) {
        if (["prototype", "__proto__", "constructor"].includes(p)) throw new Error("SEC_BLOCK");
        context = fn; fn = Reflect.get(fn, p);
        if (fn === undefined) throw new Error(`Link Fail: ${path}`);
    }
    ...
```

The ECMAScript standard strictly governs the `Reflect` API. Unlike traditional Javascript dynamic property access (`myString.match`), `Reflect.get(target, property)` enforces a hard type-check on the `target`. If `target` is a scalar primitive (a bare `string`, `number`, or `boolean`), it fatally throws a Native `TypeError: Reflect.get called on non-object`. 

Consequently, Nejy scripts inherently crash whenever attempting to call standard prototype methods on basic scalar strings, bypassing the registry mechanisms entirely. 

## The Fix Strategy
To correct this interpreter bug without circumventing the safety envelopes provided by `Reflect`, we can safely replicate standard JS execution mapping by passing the target through the `Object()` box wrapper. 

Wrapping a primitive through `Object()` momentarily elevates it to its complex Object representation (e.g., coercing `"abc"` to `[String: "abc"]`), upon which prototypal property lookup safely executes. Crucially, calling `Object()` on an existing object performs a zero-cost pass-through (returning it unmutated), ensuring no complex instances are structurally skewed.

## Proposed Code Change (`main.mjs`)

```diff
@@ -211,7 +211,7 @@
     let context = fn;
     for (const p of parts) {
         if (["prototype", "__proto__", "constructor"].includes(p)) throw new Error("SEC_BLOCK");
-        context = fn; fn = Reflect.get(fn, p);
+        context = fn; fn = (fn === null || fn === undefined) ? undefined : Reflect.get(Object(fn), p);
         if (fn === undefined) throw new Error(`Link Fail: ${path}`);
     }
```

This tiny modification cleanly protects Nejy against null-referenced crashes while permanently solving the `Reflect.get called on non-object` exception for unboxed strings!
