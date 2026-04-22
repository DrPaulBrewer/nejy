# AWAIT
**Date:** 2026-04-22

## Overview
The `AWAIT` command is used to synchronize concurrent or asynchronous operations. It takes a variable that contains a Promise (a "thenable") and pauses execution of the Nejy script until the Promise resolves, optionally storing the resolved result into a destination variable.

## Syntax
```yaml
- ["AWAIT", ["sourcePromiseVar", "destVariable"]]
```

### Parameters
1. **Source Variable** *(String)*: The name of the variable holding the Promise to await. Can be formatted as `"$varName"` or `"varName"`.
2. **Destination Variable** *(Optional String)*: The name of the variable to store the resolved result into.

## Examples

**Awaiting a Promise**
`AWAIT` is typically used after an `EXEC` command that executed in promise mode or a `CHILD` command that spawned an asynchronous background task.
```yaml
# Start a child process that returns a promise
- ["CHILD", ["myBackgroundTask", [], "taskPromise"]]

# Do some other work...
- ["EXEC", ["console.log", ["Waiting for background task..."]]]

# Wait for the task to finish and store its result
- ["AWAIT", ["$taskPromise", "taskResult"]]
```
