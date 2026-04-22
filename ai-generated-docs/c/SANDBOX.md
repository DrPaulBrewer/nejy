# SANDBOX
**Date:** 2026-04-22

## Overview
The `SANDBOX` command runs a subprogram within a completely isolated execution context. The subprogram has its own restricted variable scope (`ctx.vars`), its own registry capabilities, and optionally a different risk policy limit. The parent script can pass selective context or fully sandbox the subprogram to ensure strict boundaries.

## Syntax
```yaml
- ["SANDBOX", [{"policy": "LOW", "capabilities": [], "context": ["$varToExpose"]}, [
    ["Step1", ["..."]],
    ["SET", ["RETURN", "sandboxResult"]]
], "destVariable"]]
```

### Parameters
1. **Sandbox Options** *(Object or String)*: 
   - `"copy"`: Passing the string `"copy"` completely duplicates the parent's variables and policy into the sandbox.
   - **Object**: You can define granular rules:
     - `policy`: Overrides the policy risk level (e.g., `"LOW"`, `"MEDIUM"`).
     - `capabilities`: An array of module paths explicitly permitted inside the sandbox.
     - `context`: An array of variable names (e.g., `["$obj", "$foo"]`) from the parent context to expose inside the sandbox. If omitted, no parent variables are passed.
2. **Subprogram Steps** *(Array)*: The array of Nejy steps to execute inside the sandbox.
3. **Destination Variable** *(Optional String)*: The name of the variable in the *parent* context where the sandbox's `$RETURN` value will be stored.

## Usage Rules
- If `capabilities` is an empty array `[]` (or explicitly missing), the internal scanner restricts the inner program entirely. For example, if it tries to use `math.evaluate`, a `SEC_BLOCK` error will be thrown.
- Variables modified inside the sandbox do not affect the parent context unless explicitly extracted using the destination variable.
- Any unresolved variable inside a highly strict sandbox stays unresolved (and maps to `undefined`).

## Examples

**Isolating an Execution Block**
```yaml
- ["SET", ["obj", {"a": 1}]]
- ["SET", ["ignored", "hello"]]

# Run a sandboxed block that only has access to $obj, not $ignored
- ["SANDBOX", [{ "context": ["$obj"] }, [
    # modify $obj to prove isolation
    ["SET", ["obj", {"a": 2}]],
    ["SET", ["RETURN", "$obj"]]
], "childRet"]]

# parent $obj is still {"a": 1}, $childRet is {"a": 2}
- ["EXEC", ["console.log", ["Parent Obj:", "$obj", "Child Obj:", "$childRet"]]]
```
