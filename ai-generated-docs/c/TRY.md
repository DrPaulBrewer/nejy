# TRY
**Date:** 2026-04-22

## Overview
The `TRY` command allows safe execution of blocks of steps that might fail or throw an error. If an error occurs during the execution of the `try` block, execution immediately jumps to the optional `catch` block, and the error message is placed in the special `$ERROR` variable.

## Syntax
```yaml
- ["TRY", [
    # Try block steps
    ["EXEC", ["risky.operation", []]]
], [
    # Catch block steps (Optional)
    ["EXEC", ["console.log", ["Operation failed:", "$ERROR"]]]
]]
```

### Parameters
1. **Try Block** *(Array of Steps)*: The Nejy steps to execute.
2. **Catch Block** *(Optional Array of Steps)*: The steps to execute if an error is thrown within the try block.

## Examples

**Catching an Execution Error**
```yaml
- ["TRY", [
    ["EXEC", ["fs.readFileSync", ["/nonexistent/file.txt"]], "content"]
], [
    ["EXEC", ["console.log", ["Failed to read file because:", "$ERROR"]]],
    ["SET", ["content", "default fallback string"]]
]]
```

**Special Exceptions**
Note that `RETURN_SIGNAL` (an internal exception used to break out of closures early when returning values) bypasses the catch block. `TRY` purely catches standard execution errors, sandbox blockages (`SEC_BLOCK`), or runtime errors.
