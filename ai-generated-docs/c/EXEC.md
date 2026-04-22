# EXEC
**Date:** 2026-04-22

## Overview
The `EXEC` command is the primary workhorse of the Nejy interpreter. It evaluates a path, resolves its arguments, executes the corresponding function or method, and (optionally) stores the result into a specified destination variable.

## Syntax
```yaml
- ["EXEC", ["target.path", ["arg1", "$arg2"], "destVariable"]]
- ["EXEC", ["target.path", ["arg1", "$arg2"], { "into": "destVariable", "chain": [...] }]]
```

### Parameters
1. **Target Path** *(String)*: The dot-separated path to the function or method to execute. 
   - If it begins with a `$`, it refers to a variable in the local context (e.g., `"$dateObj.toISOString"`).
   - If not, it refers to an authorized capability in the global registry (e.g., `"math.add"`, `"console.log"`).
2. **Arguments** *(Array)*: An array of arguments to pass to the function. Nejy variables (strings starting with `$`) will be automatically resolved. Use `["LITERAL", "$foo"]` if you explicitly want to pass the literal string `"$foo"`.
3. **Configuration/Destination** *(Optional)*:
   - **String**: If provided as a string, it acts as the name of the destination variable where the result will be stored (e.g., `"myResult"` sets `$myResult`).
   - **Object**: Can provide advanced execution decorators:
     - `into`: The destination variable.
     - `chain`: An array of `[methodName, [args]]` arrays to sequentially invoke on the result before storing.
     - `compose`: An array of `[functionPath, [args]]` arrays to sequentially pass the result into before storing.
     - `promise`: Can be `true` (if `into` is used for the destination) or a string specifying the destination variable itself (e.g. `{"promise": "myDest"}`). If used, it stores the raw Promise instead of `await`ing it (useful for parallel execution followed by `AWAIT`).

## Examples

**Basic Execution**
```yaml
- ["EXEC", ["console.log", ["--- Calculating Pi ---"]]]
- ["EXEC", ["math.multiply", ["$sum", 4], "piVal"]]
```

**Using the CHAIN Decorator**
The `chain` decorator is highly optimized for sequential method chaining (e.g. array manipulation).
```yaml
- ["EXEC", ["Array", [1000000], {
    "chain": [
      ["fill", [0]],
      ["map", ["$mapFunc"]],
      ["reduce", ["$reduceFunc"]]
    ],
    "into": "result"
}]]
```

**Using the COMPOSE Decorator**
While `chain` is used for method chaining (e.g., `res.map()`), the `compose` decorator is used for function composition (e.g., `B(A(res))`). It passes the accumulated result as the *first argument* to a sequence of global or local functions.
```yaml
- ["EXEC", ["fs.readFileSync", ["config.yaml", "utf8"], {
    "compose": [
      ["YAML.parse"],           # Parses the raw string into an object
      ["Object.keys"]           # Extracts the keys from the parsed object
    ],
    "into": "configKeys"
}]]
```

If the functions in the composition chain require additional arguments, you can pass them as a second element in the step's array. The accumulated result is always injected as the *first* argument, followed by any additional arguments you provide:
```yaml
- ["EXEC", ["math.add", [5, 10], {
    "compose": [
      ["math.multiply", [2]],     # Evaluates: math.multiply((5 + 10), 2)
      ["math.subtract", [5]]      # Evaluates: math.subtract(30, 5)
    ],
    "into": "result"              # Final result is 25
}]]
```
