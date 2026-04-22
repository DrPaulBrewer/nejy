# LITERAL
**Date:** 2026-04-22

## Overview
The `LITERAL` command is used to safely inject complex JavaScript objects, arrays, or explicit strings into the runtime without them being evaluated as commands or variables. It structured-clones its arguments and ensures they are free from prototype pollution before storing or returning them.

## Syntax
```yaml
- ["LITERAL", [1, 2, 3], "destVariable"]
```
*(Inline Usage)* - Can be used as an argument to any other command, not just top level
```yaml
- ["EXEC", ["console.log", [ ["LITERAL", "$ignoredVar"] ]]] 
```
--> "$ignoredVar" is passed to console.log as a string, not resolved as a variable

### Parameters
1. **Value** *(Any)*: The raw value, array, object, or string to pass through.
2. **Destination Variable** *(Optional String)*: The variable name to store the value in (only applicable when used as a top-level command step).

## Examples

**Bypassing Variable Resolution**
If you need to pass a literal string that begins with a `$`, you must wrap it in `LITERAL`, otherwise Nejy will attempt to resolve it as a variable and it may resolve to `undefined`.
```yaml
- ["SET", ["myArray", ["LITERAL", ["$foo", "$bar"]]]]
```

**Safely Defining Data Structures**
```yaml
- ["FOR_EACH", [["LITERAL", [1, 2, 3, 4, 5]], [
    ["EXEC", ["console.log", ["$ITEM"]]]
]]]
```
