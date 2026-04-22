# CHILD
**Date:** 2026-04-22

## Overview
The `CHILD` command executes a custom Nejy function (previously defined with the `F` command) asynchronously in a separate child Node.js process using `child_process.fork`. This allows for true parallel execution without blocking the main event loop, making it ideal for heavy CPU-bound tasks.

## Syntax
```yaml
- ["CHILD", ["functionName", ["arg1", "arg2"], "destPromiseVariable"]]
```

### Parameters
1. **Function Name** *(String)*: The name of the Nejy function (defined via `F`) to run in the child process. The function must have been defined such that its environment can be serialized over IPC.
2. **Arguments** *(Array)*: An array of arguments to pass into the child function.
3. **Destination Promise Variable** *(Optional String)*: The name of the variable to store the resulting Promise. Use the `AWAIT` command to wait for and retrieve the final result.

## Usage Rules
- `CHILD` can only be invoked if the script's policy is `HIGH` or `INSANE`. `LOW` and `MEDIUM` security profiles block all `child_process` execution.
- Variables and `MATH` functions captured in the `F` closure are automatically serialized and reconstructed in the child process via YAML.
- The child process's result is passed back to the parent and resolves the Promise.

## Examples

**Spawning and Awaiting a Background Task**
```yaml
# Define the heavy lifting function
- ["F", ["heavyTask", ["inputNum"], [
    ["EXEC", ["math.factorial", ["$inputNum"], "result"]],
    ["SET", ["RETURN", "$result"]]
]]]

# Spawn the task into the background
- ["CHILD", ["heavyTask", [1000], "bgTask"]]

# Await its result later
- ["AWAIT", ["$bgTask", "finalResult"]]
- ["EXEC", ["console.log", ["Result:", "$finalResult"]]]
```
