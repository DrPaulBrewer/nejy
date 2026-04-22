# Race Conditions in the Nejy Command Interpreter

> [!NOTE]
> JavaScript (Node.js) is single-threaded, so "race condition" here means **interleaved async execution across `await` suspension points** — two coroutines sharing mutable state without synchronization. Any time an `await` suspends a coroutine, another queued microtask or I/O callback can run and mutate shared state before the first resumes.

---

## RC-1 — Shared `ctx.vars` Mutated by Concurrent Callers

**Files:** `lib/interp/commands.mjs`, `lib/interp/childCommand.mjs`

### Root Cause

`ctx` (and specifically `ctx.vars`) is a plain JavaScript object passed by reference through every command handler. Nothing prevents two concurrent callers from passing the **same** `ctx` object and interleaving writes to `ctx.vars["$LAST"]`, `ctx.vars["$ERROR"]`, `ctx.vars["$ITEM"]`, etc.

This becomes concrete with the `CHILD` command. `handleChildCommand` stores an **unresolved Promise** directly into `ctx.vars["$LAST"]` at line 173 and then returns:

```js
// childCommand.mjs line 173
ctx.vars["$LAST"] = promise;   // <-- raw Promise, not awaited
```

The caller (`run()`) does **not** await this — the `CHILD` command handler is invoked with `await`, but the handler itself puts a Promise into `$LAST` and returns immediately. Any subsequent step in `run()` that reads `$LAST` (e.g. a `SET`, `TO`, or `EXEC` step) will read the unresolved Promise object rather than the eventual result. Meanwhile, the background child process continues running and will later resolve the promise and push to `ctx.child_log` — even if execution of the parent program has already finished or the parent context has been torn down.

### Affected Code

```js
// commands.mjs — run() loop
export async function run(steps, ctx, em = false) {
    for (const step of steps) {
        // ...
        if (commands[path]) await commands[path](args, ctx, em);  // awaits handler...
        // ...
    }
}

// childCommand.mjs — handler returns immediately after storing unresolved promise
ctx.vars["$LAST"] = promise;   // not awaited inside the handler
// handler function returns (resolves), so run() continues to the next step
```

If a user program does:
```yaml
- [CHILD, [myFunc, [arg]]]
- [SET, [result, "$LAST"]]   # reads the Promise object, not the result
```

`$result` will be the raw Promise, not the child's return value.

---

## RC-2 — `SecurityScanner.requestList` Is Instance-Level Mutable State Reset Per `scan()`

**File:** `lib/interp/scanner.mjs`

### Root Cause

`SecurityScanner` stores `requestList` as an instance property that is **reset at the start of every `scan()` call** (line 54):

```js
// scanner.mjs line 54
this.requestList = null;
```

If the same `SecurityScanner` instance is used concurrently (e.g., in a server embedding that calls `nejyRun` in parallel for two different requests), the second call to `scan()` will reset `requestList` to `null` while the first call's `analyze()` is still awaited mid-way. This would corrupt the first call's REQUEST enforcement because `this.requestList` would become `null` (meaning "no restriction"), effectively **removing the capability whitelist** that was set on line 69:

```js
this.requestList = reqArgs;   // set by scan() for request #1
steps = program.slice(1);

await this.analyze(steps);    // <-- suspended here by async
// Meanwhile scan() for request #2 runs: this.requestList = null  ← corruption
```

`checkPath()` then reads `this.requestList` on line 101, and the null value causes the `pathInRequest` guard to be **skipped**, silently allowing paths that should be blocked:

```js
// scanner.mjs line 101
if (!skipRequestCheck && this.requestList !== null && !pathStr.startsWith('$')) {
    if (!pathInRequest(pathStr, this.requestList))
        throw new Error(`SEC_BLOCK: ...`);
}
```

In practice, `nejyRun` (called in `nejy.mjs`) creates a **new `SecurityScanner` per call**, so this does not trigger in the CLI. However, if a caller caches and reuses a `SecurityScanner` instance across concurrent invocations (which the API does not prevent), this is a security-relevant race condition.

---

## RC-3 — `ResourceMonitor.usage.fsBytes` Non-Atomic Check-then-Act

**File:** `monitor/index.js`

### Root Cause

The FS quota is enforced with a **check-then-act** pattern that is not atomic across async operations:

```js
// monitor/index.js line 40-45
const checkQuota = (bytes) => {
    if (this.usage.fsBytes + bytes > this.quotas.maxFsBytes) {
        throw new Error("FS_QUOTA_EXCEEDED");
    }
    this.usage.fsBytes += bytes;   // mutation happens after the check
};
```

For async FS methods (`promises.copyFile`, `promises.writeFile`, `promises.appendFile`), the sequence is:

1. Coroutine A calls `promises.copyFile` → calls `stat()` → **suspends** at `await stat()`
2. Coroutine B calls `promises.writeFile` → calls `checkQuota(B_bytes)` → **passes** (fsBytes still low)
3. Coroutine A resumes → calls `checkQuota(A_bytes)` → **passes** (B_bytes not yet added)
4. Both `fsBytes += bytes` run → combined total **exceeds** the quota silently

Concretely in `promises.copyFile`:

```js
// monitor/index.js lines 144-148
fsModule.promises.copyFile = async (src, dest, ...args) => {
    const stats = await fsModule.promises.stat(src);  // <-- await point
    checkQuota(stats.size);   // <-- another coroutine may have consumed quota during await
    return originalPromisesCopyFile.apply(...);
};
```

The callback-based `copyFile` version has the same issue:

```js
// monitor/index.js lines 108-120
fsModule.stat(src, (err, stats) => {   // async callback
    // ...
    checkQuota(stats.size);            // quota state may have changed since the outer call
    return originalCopyFile.apply(...);
});
```

---

## RC-4 — `ctx.vars["$ITEM"]` Shared Across Nested/Concurrent `FOR_EACH` Loops

**File:** `lib/interp/commands.mjs`

### Root Cause

`FOR_EACH` writes the loop variable into the **parent context** `ctx.vars["$ITEM"]` on every iteration:

```js
// commands.mjs line 194
ctx.vars["$ITEM"] = typeof list === 'number' ? i : list[i];
await run(sub, ctx, em);
```

If the loop body (`sub`) contains an `EXEC` call that invokes an async function returning a Promise that is awaited, control yields. If that async function itself eventually triggers another `FOR_EACH` on the **same `ctx`**, the inner loop overwrites `ctx.vars["$ITEM"]` while the outer loop depends on it.

A more direct scenario: if a user-defined `F` function is called from within `FOR_EACH` and that function happens to share the same `ctx` (possible if passed `$VARS` or via closure capture), both loops will contend on `$ITEM`.

```js
// FOR_EACH in commands.mjs
for (let i = 0; i < limit; i++) {
    ctx.vars["$ITEM"] = list[i];   // written every iteration
    await run(sub, ctx, em);       // if sub's async path re-enters FOR_EACH on same ctx → corruption
}
```

Note: the `F` command does create a child context with its own `vars`, so direct recursion via `F` is safe. The hazard is specifically if the **same `ctx` object** is handed to two concurrent `run()` invocations (e.g., via `PROMISE` command leaving a Promise that resolves and mutates `ctx` later while the parent `run()` has moved on).

---

## RC-5 — `PROMISE` Command Stores Unresolved Promise in `$LAST`; Later Reads Are Unsynchronized

**File:** `lib/interp/commands.mjs`

### Root Cause

The `PROMISE` command is explicitly designed to **not await** the result:

```js
// commands.mjs line 46
ctx.vars["$LAST"] = (res instanceof Promise) ? res : removePP(res);
```

This is intentional — it lets users start async work and later `await` or collect it. However, there is no mechanism to prevent subsequent interpreter steps from reading `$LAST` before the promise resolves, and no synchronization is enforced when the promise eventually settles and tries to write back to `ctx.vars`.

If the promise's `.then()` or resolution path mutates `ctx.vars` (e.g., via a callback that calls a nejy function referencing the shared context), it will race with the sequential `run()` loop that may be modifying `ctx.vars["$LAST"]` for subsequent steps.

```js
// A program like:
// [PROMISE, ["someAsyncFn", []]]       <- stores Promise in $LAST
// [SET, [myResult, "$LAST"]]           <- $myResult = Promise (not resolved value)
// ... many steps later ...
// async fn resolves and (if it has a side-effect on ctx) mutates ctx.vars
```

The concern is less about `$LAST` itself (that is the documented behavior) and more about the **lack of any fence** between the promise's resolution callback and the ongoing sequential execution of the `run()` loop on the same `ctx`.

---

## Summary Table

| # | Location | Shared Mutable State | Trigger |
|---|----------|----------------------|---------|
| RC-1 | `childCommand.mjs:173` | `ctx.vars["$LAST"]` | CHILD stores raw Promise; subsequent steps read wrong value |
| RC-2 | `scanner.mjs:54,69,101` | `scanner.requestList` | Reusing scanner instance across concurrent `scan()` calls |
| RC-3 | `monitor/index.js:40-45,108-148` | `this.usage.fsBytes` | Async FS quota check-then-act with await points between check and increment |
| RC-4 | `commands.mjs:194` | `ctx.vars["$ITEM"]` | Nested or concurrent FOR_EACH on same ctx |
| RC-5 | `commands.mjs:46` | `ctx.vars` | PROMISE resolution callback races with sequential run() loop |
