# Analysis of the `MATH` Command vs `math.evaluate`

This document analyzes the execution model, purity, and variable lookup interactions of mathematical operations in `nejy`, specifically contrasting the native `MATH` command with the use of `EXEC` targeting the Math.js module.

## 1. Purity and Side Effects

Mathematical operations in `nejy` can be executed in two primary ways, resulting in radically different side-effect behaviors.

### The `MATH` Command: Pure Functions
Functions created using the `MATH` command are strictly **pure** and do not mutate context variables.

When a `MATH` function is evaluated, the command handler constructs an entirely isolated `Map` containing only the formal parameters mapped to the provided arguments (supporting destructuring as needed). This isolated scope is passed directly into Math.js's evaluation engine.

Because it operates entirely on this independent, local `Map`, a `MATH` function cannot reach out to modify global `$VARS`.

**Pure Usage Example:**
In `examples/array-ops/test1.json`, mathematical functions map over arrays purely:

```json
[
  ["MATH", ["mapFunc", ["v", "i"], "1.0 / (1.0 + i)"]],
  ["MATH", ["reduceFunc", ["acc", "v", "i"], "acc + v"]],
  ["NEW", ["Array", [1000000]]],
  ["EXEC", ["$LAST.fill", [0]]],
  ["SET", ["arr", "$LAST"]],
  ["EXEC", ["$arr.map", ["$mapFunc"]]],
  ["EXEC", ["$LAST.reduce", ["$reduceFunc"]]]
]
```
The variables `v`, `i`, and `acc` exist only temporarily inside the evaluation scope.

### `EXEC` with `math.evaluate`: Side Effects Allowed
Conversely, executing `math.evaluate` (or evaluating a pre-compiled Math.js expression) and passing the global `$VARS` reference allows for **side effects** (mutation) directly within the context.

Math.js supports variable assignments within its expressions (e.g., `x = y + 1`). When the scope passed to Math.js is the `nejy` context `$VARS` object itself, these assignment operations directly mutate the `nejy` state.

**Side Effect Usage Example:**
In `examples/cpu_intensive/pi-math.json`, the `$sum` variable is directly mutated on each iteration using an assignment inside the expression literal, modifying the `$sum` property of `$VARS`:

```json
[
  ["SET", ["sum", 0]],
  ["FOR_EACH", [
    1000000000,
    [
      ["EXEC", ["math.evaluate", ["$sum = $sum + ((-1)^$ITEM / (2 * $ITEM + 1))", "$VARS"]]]
    ]
  ]]
]
```

## 2. Interaction with Variable Lookups

The way `MATH` and `math.*` execute determines how variables are resolved within the expression literal string.

### Lookups within the `MATH` Command
When the `MATH` command generates a function, variable lookups within the expression string resolve strictly against the formal parameter names declared in the definition.

In `lib/interp/commands.mjs`:
```javascript
const fn = (...actualArgs) => {
    const scope = new Map();
    for (const map of paramMappings) {
        // ... parameter mapping logic ...
        scope.set(map.cleanName, actualArgs[map.idx]);
    }
    return compiled.evaluate(scope);
};
```

If a literal expression body uses a variable name, Math.js searches this constructed `Map`. If the literal expression contains references to variables that are not declared as formal arguments, they will evaluate to `undefined` (or potentially throw depending on the Math.js configuration), because the `MATH` command *does not merge `$VARS` into the local scope*.

Furthermore, `MATH` strictly rejects pass-by-reference arguments (`&`), meaning a reference to the global `$VARS` cannot be smuggled into the formal parameter list.

### Lookups within `math.evaluate` (using `$VARS`)
When `math.evaluate` is called via `EXEC` and provided with `"$VARS"`, the variable lookups occur directly against the `nejy` context object.

Because `nejy` variables are conventionally prefixed with `$`, the Math.js literal string must include the `$` character to match the property name on the `$VARS` object. For example, in the expression `$sum = $sum + ...`, Math.js looks for the property named `"$sum"` on the provided `$VARS` scope object and reads/writes to it.

```json
- ["SET", ["A", 10]]
- ["SET", ["B", 20]]
- ["EXEC", ["math.evaluate", ["$A + $B", "$VARS"]]]
```
In this scenario, `math.evaluate` successfully locates `"$A"` and `"$B"` directly within the passed `$VARS` scope.