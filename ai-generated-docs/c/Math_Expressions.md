# Math Expressions
**Date:** 2026-04-22

## Overview
While the `MATH` command is used to compile high-performance math functions, Nejy also supports **Inline Math Expressions**. Any command step where the first element is a string that begins with a **space character** (`" "`) is automatically treated as a direct math expression to be evaluated by `math.evaluate`.

This provides a lightweight, expressive way to perform mathematical calculations and assignments without the boilerplate of the `EXEC` command.

## Syntax
```yaml
- [" $x + $y", [], "destVariable"]
- [" $sum = $sum + 1"]
```

### Parameters
1. **Expression** *(String)*: A valid `mathjs` expression. **It must begin with a space character.**
2. **Arguments** *(Ignored)*: The second element in the array is ignored by the math expression evaluator, but is conventionally set to `[]` or `{}` to maintain Nejy's standard 3-element command structure.
3. **Destination Variable** *(Optional String)*: The name of the variable where the final evaluated result of the expression will be stored.

## Capabilities & Side-Effects

Because inline math expressions are evaluated directly against your local variable scope (using a proxy wrapper), you can use them to directly read, create, or modify context variables using the `=` assignment operator inside the expression itself. This is extremely useful for counters and accumulators.

```yaml
- ["SET", ["score", 10]]
- ["SET", ["multiplier", 2]]

# Using side-effects to modify variables directly
- [" $score = $score * $multiplier"]
- [" $score = $score + 5"]

# $score is now 25!
```

## Supported Math Functions
Nejy's math engine is powered by [Math.js](https://mathjs.org/). When you write expressions, you have access to a massive library of built-in mathematical constants and functions.

**Helpful Math.js Documentation Links:**
- **[Expression Syntax](https://mathjs.org/docs/expressions/syntax.html)**: Learn the rules of writing math expressions (operators, matrices, implicit multiplication).
- **[Function Reference](https://mathjs.org/docs/reference/functions.html)**: A complete list of all available math functions (e.g., `sin`, `log`, `matrix`, `mean`).

## Advanced: Usage with SANDBOX and required capabilities
Inline math expressions implicitly rely on the `math.evaluate` global capability. If you are running an inline expression inside a restrictive `SANDBOX`, you must explicitly declare `math.evaluate` in your sandbox's capability manifest; otherwise, the Security Scanner will block the execution.

```yaml
# Inside a highly restrictive sandbox, we must explicitly permit math.evaluate
- ["SANDBOX", [{"policy": "LOW", "capabilities": ["math.evaluate"]}, [
    ["SET", ["sum", 0]],
    [" $sum = $sum + 1"],
    ["SET", ["RETURN", "$sum"]]
], "result"]]
```
