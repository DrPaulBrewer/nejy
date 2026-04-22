# MATH
**Date:** 2026-04-22

## Overview
The `MATH` command defines a safe, high-performance mathematical function using the `mathjs` expression compiler ([https://mathjs.org/](https://mathjs.org/)) and stores it in the local context. Compiling a `MATH` function allows inner loops to execute at native JavaScript speeds. This is especially useful for CPU intensive operations. The function returned is an ordinary synchronous JavaScript function.  It can be used in other JavaScript contexts requiring functions like Array.map or Array.reduce.  If you want an async function or promise, use 'F' or 'CHILD' instead.

## Syntax
```yaml
- ["MATH", ["FunctionName", ["arg1", "arg2"], "math expression string"]]
```

### Parameters
1. **Function Name** *(String)*: The name of the variable to store the compiled math function.
2. **Formal Arguments** *(Array)*: An array of strings defining the parameters the math expression will expect. Object destructuring is also supported for mapping specific nested object keys.
3. **Expression** *(String)*: A valid `mathjs` expression.

## Examples

**Defining a mapper and reducer**
```yaml
- ["MATH", ["mapFunc", ["v", "i"], "1.0 / (1.0 + i)"]]
- ["MATH", ["reduceFunc", ["acc", "v", "i"], "acc + v"]]

- ["EXEC", ["Array", [1000000], {
    "chain": [
      ["fill",   [0]],
      ["map",    ["$mapFunc"]],
      ["reduce", ["$reduceFunc"]]
    ], 
    "into": "RETURN"
}]]
```
--> 1/1 + 1/2 + 1/3 + ... + 1/1,000,000

**Helpful Math.js Documentation Links:**
- **[Expression Syntax](https://mathjs.org/docs/expressions/syntax.html)**: Learn the rules of writing math expressions (operators, matrices, implicit multiplication).
- **[Function Reference](https://mathjs.org/docs/reference/functions.html)**: A complete list of all available math functions (e.g., `sin`, `log`, `matrix`, `mean`).

**Dynamic Mathematical Compilation**
If you need to construct a math formula at runtime dynamically, you would use `math.compile` via the `EXEC` command instead of `MATH`, but `MATH` is cleaner for static expressions.
