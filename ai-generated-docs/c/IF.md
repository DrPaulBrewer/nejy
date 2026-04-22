# IF
**Date:** 2026-04-22

## Overview
The `IF` command provides branching conditional execution. It evaluates a condition and then executes either a "true" branch or a "false" branch of steps.

## Syntax
```yaml
- ["IF", ["$conditionVariable", [
    ["Step1", ["..."]]
], [
    ["FallbackStep", ["..."]]
]]]
```

### Parameters
1. **Condition** *(Variable or Value)*: The condition to evaluate. Usually a variable (like `"$isValid"`) resolving to a truthy or falsy value.
2. **True Branch** *(Array of Steps)*: The Nejy steps to execute if the condition evaluates to true.
3. **False Branch** *(Array of Steps, Optional)*: The Nejy steps to execute if the condition evaluates to false.

## Examples

**Basic Conditional Logging**
```yaml
- ["EXEC", ["math.random", [], "rand"]]
- ["EXEC", ["math.larger", ["$rand", 0.5], "isLarge"]]
- ["IF", ["$isLarge", [
    ["EXEC", ["console.log", ["Number is larger than 0.5"]]]
], [
    ["EXEC", ["console.log", ["Number is 0.5 or smaller"]]]
]]]
```
