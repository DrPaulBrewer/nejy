# FOR_EACH
**Date:** 2026-04-22

## Overview
The `FOR_EACH` command provides looping execution over arrays or a specific number of numeric iterations. During each iteration, the special `$ITEM` variable is automatically injected into the local context with the current array value (or the numeric index).

## Syntax
```yaml
- ["FOR_EACH", ["$myList", [
    ["Step1", ["..."]]
]]]

- ["FOR_EACH", [1000, [
    ["Step1", ["..."]]
]]]
```

### Parameters
1. **List Specifier** *(Array, Variable, or Number)*: The collection to iterate over. 
   - If it resolves to an Array, the loop iterates over its elements.
   - If it resolves to a Number `N`, the loop iterates `N` times (from `0` to `N - 1`).
2. **Sub-program Steps** *(Array)*: An array of Nejy steps to execute during each iteration.

## Examples

**Iterating over an Array**
```yaml
- ["SET", ["fruits", ["LITERAL", ["apple", "banana", "cherry"]]]]
- ["FOR_EACH", ["$fruits", [
    ["EXEC", ["console.log", ["Processing:", "$ITEM"]]]
]]]
```

**Iterating N Times**
This runs the loop 1,000,000 times, with `$ITEM` taking values from `0` to `999999`.
```yaml
- ["SET", ["sum", 0]]
- ["MATH", ["compileMath", ["$sum = $sum + ((-1)^$ITEM / (2 * $ITEM + 1))"], "compiledMath"]]
- ["FOR_EACH", [1000000, [
    ["EXEC", ["$compiledMath.evaluate", ["$VARS"]]]
]]]
```

**Resource Management Note**
The Nejy interpreter automatically monitors system resources (CPU/Memory limits based on the sandbox policy). Every 5,000 iterations inside a `FOR_EACH` loop, the resource monitor (`ctx.mon.checkResources()`) is pinged to ensure the script hasn't exceeded its quota. If it has, the loop terminates immediately with a `QUOTA_EXCEEDED` error. For extremely long loops or CPU intensive operations, consider using the `ON_QUOTA` command to handle resource usage more granularly.
