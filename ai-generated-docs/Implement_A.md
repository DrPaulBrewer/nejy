# Option A — TDD Implementation Plan

## Design Decisions (Resolved)

- `$LAST` is **removed entirely** from the language and runtime.
- `$RETURN` is the only output variable. The scanner enforces that `SET RETURN`
  occurs at most once as a direct assignment; subsequent mutations via method
  calls (`$RETURN.push`, etc.) are allowed.
- Script migration IS the test-creation step. All migrated scripts become the
  regression suite. Tests pass when all migrated scripts produce the same
  results as before.

## New Command Surface (Option A with A1, A3, A4)

### EXEC — extended syntax

```
[EXEC, [target, args]]              # result discarded (side-effects only)
[EXEC, [target, args, dest]]        # dest is a string → result stored in $dest
[EXEC, [target, args, {into: dest}]]           # object form, equivalent
[EXEC, [target, args, {promise: dest}]]        # store unresolved Promise in $dest (replaces PROMISE)
[EXEC, [target, args, {chain: [[m,a],...], into: dest}]]  # CHAIN decorator
[EXEC, [target, args, {compose: [fn,...], into: dest}]]   # COMPOSE decorator
```

`dest` of `RETURN` writes `$RETURN`. Positional string dest is preferred (A1).

### CHAIN semantics

Each `[method, args]` pair calls `acc = acc[method](...resolveArgs(args, ctx))`.
Intermediates never touch `ctx.vars`. `removePP` applied to final value only.

### COMPOSE semantics

Each step is `fn` (bare path) or `[fn, extraArgs]`.
Call: `acc = fn(acc)` or `acc = fn(acc, ...extraArgs)`. Left-to-right.
Intermediates never touch `ctx.vars`.

### NEW / LITERAL — extended

```
[NEW, [Class, args, dest]]          # result stored in $dest
[LITERAL, value, dest]              # result stored in $dest
```

### AWAIT — new command

```
[AWAIT, [srcVar, dest]]             # await $srcVar, store resolved value in $dest
```

### SANDBOX — extended

```
[SANDBOX, [opts, subprogram, dest]] # if $RETURN not set in child, result stored in $dest
```

### CHILD — extended

```
[CHILD, [funcName, args, dest]]     # child Promise stored in $dest (use AWAIT or Promise.allSettled)
```

### Commands REMOVED: `TO`, `PIPE`, `PROMISE`

### Math space-prefix extended

```
[" expr", scope, dest]              # result stored in $dest
```

### IF — condition must be a pre-computed variable (no inline step)

```yaml
- [EXEC, [someTest, [], condResult]]
- [IF, [$condResult, [...trueSteps], [...falseSteps]]]
```

---

## Phase 1 — Script Migration (TDD test creation)

Migration rules applied mechanically:

| Old pattern | New pattern |
|---|---|
| `[EXEC, [f, a]]` + `[SET, [x, $LAST]]` | `[EXEC, [f, a, x]]` |
| `[EXEC, [f, a]]` (discard result) | `[EXEC, [f, a]]` (unchanged — no dest) |
| `[NEW, [C, a]]` + `[SET, [x, $LAST]]` | `[NEW, [C, a, x]]` |
| `[LITERAL, v]` + `[SET, [x, $LAST]]` | `[LITERAL, v, x]` |
| `[PROMISE, [f, a]]` + `[SET, [x, $LAST]]` | `[EXEC, [f, a, {promise: x}]]` |
| `[TO, [x, step]]` | `[EXEC, [f, a, x]]` — inline the step |
| `[TO, [x, [PIPE, [...]]]]` | EXEC with `{chain:…, into: x}` |
| `[SET, [RETURN, $LAST]]` | fold into preceding step: use `RETURN` as dest |
| `[CHILD, [f, a]]` + `[SET, [x, $LAST]]` | `[CHILD, [f, a, x]]` |
| `[" expr", scope]` + `[SET, [x, $LAST]]` | `[" expr", scope, x]` |
| PIPE method chain | EXEC + CHAIN decorator |

### Migration: `tests/programs/`

**use-os-hostname.yaml**
```yaml
# BEFORE
- [EXEC, [os.hostname, []]]
- [SET, [RETURN, $LAST]]
# AFTER
- [EXEC, [os.hostname, [], RETURN]]
```

**use-literal.yaml**
```yaml
# BEFORE
- [LITERAL, {some: object, with: [1,2,3]}]
- [SET, [RETURN, $LAST]]
# AFTER
- [LITERAL, {some: object, with: [1,2,3]}, RETURN]
```

**use-math-evaluate.yaml** (pattern: EXEC+SET→RETURN)
```yaml
# AFTER (generic pattern)
- [REQUEST, [math.evaluate]]
- [EXEC, [math.evaluate, ["2^10"], RETURN]]
```

**use-promise-all.yaml**
```yaml
# BEFORE
- [PROMISE, [Promise.resolve, [Hello]]]
- [SET, [p1, $LAST]]
- [PROMISE, [Promise.resolve, [World]]]
- [SET, [p2, $LAST]]
- [EXEC, [Promise.all, [[$p1, $p2]]]]
- [SET, [RETURN, $LAST]]
# AFTER
- [EXEC, [Promise.resolve, [Hello], {promise: p1}]]
- [EXEC, [Promise.resolve, [World], {promise: p2}]]
- [EXEC, [Promise.all, [[$p1, $p2]], RETURN]]
```

**request-os-module.yaml**
```yaml
# BEFORE
- [REQUEST, [os, console.log]]
- [EXEC, [os.hostname, []]]
- [EXEC, [console.log, [Hostname:, $LAST]]]
# AFTER
- [REQUEST, [os, console.log]]
- [EXEC, [os.hostname, [], host]]
- [EXEC, [console.log, [Hostname:, $host]]]
```

**request-math-and-console.yaml** / **request-math-use-console.yaml** — same pattern.

**use-eval.yaml** — no change (no $LAST, just EXEC+SET→RETURN migration).

**use-fs-read.yaml**, **use-fs-write.yaml**, **use-child-process.yaml**,
**use-process-exit.yaml**, **use-object-setprototypeof.yaml**,
**use-inline-literal.yaml**, **use-inline-literal-proto.yaml** — apply EXEC+SET→dest pattern.

**child-all-functions.yaml**
```yaml
# BEFORE (last two lines)
- [CHILD, [calc_pi, [100]]]
- [PROMISE, [$LAST.then, [[F, [cb, [res], [[SET, [RETURN, $res]]]]]]]
# AFTER
- [CHILD, [calc_pi, [100], piPromise]]
- [AWAIT, [piPromise, RETURN]]
```

### Migration: `tests/` (JSON programs)

**child_command.json**
```json
[
  ["F", ["getVal", [], [["SET", ["RETURN", 1]]]]],
  ["CHILD", ["getVal", [], "p"]],
  ["EXEC", ["Promise.all", [["$p"]], "RETURN"]]
]
```

**child_nested.json** — apply CHILD+dest, remove Promise.resolve wrapping if only used to capture $LAST.

**child_parallel.json**
```json
["CHILD", ["cpuTask", [], "p1"]],
["CHILD", ["cpuTask", [], "p2"]],
["CHILD", ["cpuTask", [], "p3"]],
["CHILD", ["cpuTask", [], "p4"]],
["EXEC", ["Promise.allSettled", [["$p1","$p2","$p3","$p4"]], "RETURN"]]
```

### Migration: `examples/`

**examples/simple/failing_program.json**
```json
[
  ["console.log", ["Attempting unauthorized shell execution..."]],
  ["EXEC", ["child_process.execSync", ["whoami"], "current_user"]],
  ["console.log", ["Found user:", "$current_user"]]
]
```
*(Still expected to be BLOCKED at LOW and MEDIUM.)*

**examples/os/health_pipe.yaml**
```yaml
- [EXEC, [console.log, [--- Gathering System Data ---]]]
- [EXEC, [Date, [], {chain: [[toISOString, []]], into: utcTime}]]
- [EXEC, [os.hostname, [], host]]
- [" 100 - (os.freemem() / os.totalmem() * 100)", {}, pct]
- [SET, [entries, [
    [hostname, $host],
    [memory_usage_pct, $pct],
    [timestamp_utc, $utcTime]
  ]]]
- [EXEC, [Object.fromEntries, [$entries], {compose: [
    YAML.stringify,
    [console.log, ["\n📋 Final Health Snapshot:\n"]]
  ], into: _}]]
```

**examples/array-ops/test2.yaml**
```yaml
- [MATH, [mapFunc,    [v, i], "1.0 / (1.0 + i)"]]
- [MATH, [reduceFunc, [acc, v, i], "acc + v"]]
- [EXEC, [Array, [1000000], {chain: [
    [fill,   [0]],
    [map,    [$mapFunc]],
    [reduce, [$reduceFunc]]
  ], into: RETURN}]]
```

**examples/cpu_intensive/pi-pipe.yaml**
```yaml
- [EXEC, [console.log, [--- Pi Calculation ---]]]
- [SET, [sum, 0]]
- [EXEC, [math.compile, ["$sum = $sum + ((-1)^$ITEM / (2 * $ITEM + 1))"], compiledMath]]
- [F, [ON_QUOTA, [USAGE, "&VARS"], [
    [EXEC, [math.multiply, [$VARS.sum, 4], piVal]],
    [EXEC, [console.log, ["🏁 Final Pi: ", $piVal]]],
    [EXEC, [console.log, ["🔢 Iterations:", $VARS.ITEM]]],
    [EXEC, [console.log, ["📊 Usage:", $USAGE]]]
  ]]]
- [FOR_EACH, [1000000000, [[EXEC, [$compiledMath.evaluate, [$VARS]]]]]]
```

**examples/crypto/symmetric-decrypt.yaml** — the 40+ EXEC+SET pairs each become
`[EXEC, [target, args, varName]]`. Example:
```yaml
# BEFORE
- [EXEC, [fs.readFileSync, [examples/crypto/symmetric-ciphertext-input.txt, utf8]]]
- [SET, [ciphertext, $LAST]]
# AFTER
- [EXEC, [fs.readFileSync, [examples/crypto/symmetric-ciphertext-input.txt, utf8], ciphertext]]
```
Apply same rule to all 40+ pairs. The final step becomes `[EXEC, [..., RETURN]]`.

**examples/p-tools/p-timeout.yaml**
```yaml
- [EXEC, [Promise.resolve, [Fast Success!], {promise: fastPromise}]]
- [EXEC, [pTimeout, [$fastPromise, {milliseconds: 100}], RETURN]]
- [console.log, [pTimeout Result:, $RETURN]]
```

**examples/p-tools/p-lazy.yaml**, **p-limit.yaml**, **p-queue.yaml**, **p-series.yaml** —
apply EXEC+SET→dest pattern throughout.

### Migration: `tests/redteam/`

Redteam scripts are attack payloads. They must still be **blocked** after migration.
The migration makes them syntactically valid under the new format; the scanner/runtime
must still reject them.

**high-escalation-reflect-prototype.yaml**
```yaml
- [SET, [arr, []]]
- [EXEC, [Reflect.get, [$arr, map], step1]]
- [EXEC, [Reflect.get, [$step1, constructor], step2]]
- [EXEC, [Reflect.apply, [$step2, null, ["return globalThis"]], step3]]
- [EXEC, [Reflect.apply, [$step3, null, []], step4]]
- [EXEC, [console.log, [Pwned Global:, $step4]]]
```
*(Expected: still BLOCKED by scanner at LOW/MEDIUM/HIGH.)*

**high-pipe-variable-string-bypass.yaml** — `PIPE` is gone; rewrite as EXEC with
variable target. The scanner must still block `$malicious_target` calls that
resolve to `child_process.execSync` at runtime (runtime risk enforcement).

**high-exec-variable-string-bypass.yaml**, **high-run-variable-string-bypass.yaml**,
**high-new-promise.yaml** — apply dest migration, verify still blocked.

---

## Phase 2 — Source Code Implementation

Work in this order to ensure each change is independently testable.

### Step 1 — `nejy.mjs`

- Remove `$LAST` from initial `ctx.vars` (line 99).
- Change return: `result: ctx.vars["$RETURN"]` (remove `?? ctx.vars["$LAST"]`).
- Remove `$LAST` from `carryOverBasicVars` list (currently in `commands.mjs:14`).

### Step 2 — `lib/buildMods.mjs`

- `resolveMiniArg` (line 56): remove the `if (arg === '$LAST') return last;` branch.
  The mini-executor's `last` variable is still fine internally; just don't expose it
  as `$LAST`.

### Step 3 — `lib/interp/context.mjs`

- `carryOverBasicVars` (line 14): remove `"$LAST"` from the `basicVars` array.

### Step 4 — `lib/interp/commands.mjs` (core changes)

#### 4a. Helper: `parseExecDest(thirdArg)`

New internal function. Given the optional third element of the EXEC args array:
- If `string` → `{ dest: thirdArg, chain: null, compose: null, promise: false }`
- If `object` with `chain` → `{ dest: obj.into, chain: obj.chain, compose: null, promise: false }`
- If `object` with `compose` → `{ dest: obj.into, chain: null, compose: obj.compose, promise: false }`
- If `object` with `promise` → `{ dest: obj.promise, chain: null, compose: null, promise: true }`
- If `object` with `into` only → `{ dest: obj.into, chain: null, compose: null, promise: false }`
- If `undefined` → `{ dest: null, chain: null, compose: null, promise: false }`

Validates `dest` is not `prototype`/`__proto__`/`constructor`.

#### 4b. `EXEC` rewrite

```js
EXEC: async ([target, rawArgs, thirdArg], ctx, em) => {
  const { dest, chain, compose, promise } = parseExecDest(thirdArg);
  const { f, c } = resolvePath(target, ctx);
  if (typeof f !== 'function') throw new Error(`Type Error: ...`);
  const args = resolveArgs(rawArgs || [], ctx).map(a =>
    a === "$VARS" ? createVarsProxy(ctx) : a);

  let res = Reflect.apply(f, c, args);
  if (!(res instanceof Promise) || promise) {
    // sync or intentionally keeping promise
  } else {
    res = await res;
  }

  if (chain) {
    let acc = (res instanceof Promise) ? await res : res;
    for (const [method, chainArgs] of chain) {
      const resolvedChainArgs = resolveArgs(chainArgs || [], ctx);
      acc = acc[method](...resolvedChainArgs);
      if (acc instanceof Promise) acc = await acc;
    }
    res = acc;
  }

  if (compose) {
    let acc = (res instanceof Promise) ? await res : res;
    for (const step of compose) {
      const [fn, extraArgs] = Array.isArray(step) ? step : [step, []];
      const { f: cf, c: cc } = resolvePath(fn, ctx);
      const extra = resolveArgs(extraArgs || [], ctx);
      acc = Reflect.apply(cf, cc, [acc, ...extra]);
      if (acc instanceof Promise) acc = await acc;
    }
    res = acc;
  }

  const finalVal = promise ? res : removePP(res instanceof Promise ? await res : res);
  if (dest) storeResult(dest, finalVal, ctx);
},
```

`storeResult(dest, val, ctx)` — internal helper:
```js
function storeResult(dest, val, ctx) {
  const key = dest.startsWith('$') ? dest : `$${dest}`;
  setProperty(ctx.vars, key, val);
}
```

#### 4c. `PROMISE` command — **REMOVE** entirely.

#### 4d. `NEW` command

Add `dest` as optional third arg in args array: `[target, rawArgs, dest]`.
Use `storeResult(dest, new f(...args), ctx)` if dest provided.
Remove `ctx.vars["$LAST"]` write.

#### 4e. `LITERAL` command

Signature becomes `([value, dest], ctx)` (dest as second element of args).
Use `storeResult` if dest provided. Remove `$LAST` write.

#### 4f. `TO` command — **REMOVE** entirely.

#### 4g. `PIPE` command — **REMOVE** entirely.

#### 4h. `SANDBOX` command

Add optional third positional element for dest. After `await run(subprogram, childCtx, em)`,
use `storeResult(dest, childCtx.vars["$RETURN"], ctx)` instead of writing `$LAST`.

#### 4i. `AWAIT` command — **NEW**

```js
AWAIT: async ([srcVar, dest], ctx) => {
  const key = srcVar.startsWith('$') ? srcVar : `$${srcVar}`;
  const thenable = ctx.vars[key];
  if (thenable == null || typeof thenable.then !== 'function')
    throw new Error(`AWAIT: $${srcVar} is not a thenable`);
  const resolved = removePP(await thenable);
  if (dest) storeResult(dest, resolved, ctx);
},
```

#### 4j. Math space-prefix (in `run()`)

`run()` line ~296: after evaluating the math expression, check if `step[2]`
is a dest string. Use `storeResult` if provided; do NOT write `$LAST`.

#### 4k. `IF` inline condition

`commands.mjs:186`: remove `ctx.vars["$LAST"]` read. The condition in `IF`
must now be a resolved value (variable ref or literal). If `cond` is an array
(inline step), throw an error directing users to pre-compute. This is a
**breaking change** that is covered by script migration.

#### 4l. `F` return capture (in F closure, line 129)

`const ret = childCtx.vars["$RETURN"] ?? childCtx.vars["$LAST"]`
→ `const ret = childCtx.vars["$RETURN"]`

The body of F functions is itself migrated (uses `[SET, [RETURN, ...]]` or
`[EXEC, [..., RETURN]]`).

#### 4m. `run()` cleanup

Remove the `ctx.vars["$LAST"]` write in the math space-prefix branch.
The `run()` loop itself no longer touches `$LAST`.

### Step 5 — `lib/interp/childCommand.mjs`

- Parse the third element of the command args as `dest`.
- Change `ctx.vars["$LAST"] = promise` → `storeResult(dest, promise, ctx)`.
- Throw if no `dest` is provided (CHILD always requires a destination).

### Step 6 — `lib/interp/scanner.mjs`

#### 6a. `HANDLED_COMMANDS`
Remove: `PIPE`, `TO`, `PROMISE`.
Add: `AWAIT`.

#### 6b. Validate EXEC decorator in `analyze()`

When `path === 'EXEC'` and `args[2]` is an object:
- `{chain: [...]}`: iterate each `[methodName, chainArgs]`, check `methodName`
  for PP, scan `chainArgs` via `checkDataForLiterals`.
- `{compose: [...]}`: each step entry — if bare string, `checkPath(step)`;
  if `[fn, extra]`, `checkPath(fn)` and `checkDataForLiterals(extra)`.
- `{into: dest}` / `{promise: dest}`: `checkPath` dest as a `$dest` var name
  for PP only.
- Positional string dest (third arg is a string): same PP check.

#### 6c. `AWAIT` in `analyze()`

```js
case 'AWAIT':
  // args[0] is srcVar (variable, checked at runtime)
  // args[1] is dest (check for PP)
  if (args[1] && typeof args[1] === 'string') {
    this.checkPath(args[1].startsWith('$') ? args[1] : `$${args[1]}`);
  }
  break;
```

#### 6d. `NEW` / `LITERAL` dest

Check `args[2]` (NEW) or `args[1]` (LITERAL) for PP if present.

#### 6e. SANDBOX dest

Check `args[2]` for PP if present.

#### 6f. `$RETURN` single-SET enforcement (scanner)

In `analyze()`, track a `Set<string> returnSetPaths`. When `SET` targets
`RETURN`, check if already set in the current path; warn or error.
**Note**: This is complex with branching (IF/FOR_EACH). Initial implementation:
emit a scan-time error only if `SET RETURN` appears more than once at the
**same nesting level** of a linear block. Method-call mutations (via EXEC on
`$RETURN.*`) are always allowed and not counted.

---

## Phase 3 — JS Test File Updates

### `tests/command_f.test.mjs`

- All `assert.equal(ctx.vars.$LAST, ...)` → assert on `ctx.vars.$RETURN` or
  the named dest variable used in that test's program.
- The inline programs in each test must be migrated using the same rules as
  the YAML scripts (replace `$LAST` references with named variables).
- The `"all functions"` test uses `TO` — migrate that inline program too.

### `tests/integration.test.mjs`

- No `$LAST` references in the test harness itself. ✅
- The `expectReturn` values are checked against the YAML output's `returnVal`
  field (which now comes purely from `$RETURN`). No harness changes needed.
- Remove the `use-promise-all.yaml` entry's `expectReturn` if the script
  no longer sets `$RETURN` (it does, so keep as-is after migration).

### `tests/sandbox/sandbox.test.mjs`

- Programs in tests that use `TO`, `$LAST`, or `PIPE` must be migrated.
  - Test `'SANDBOX: "copy" isolates...'`: change `[SET, [RETURN, ["$foo","$LAST"]]]`
    to `[SET, [RETURN, ["$foo", "$sandboxResult"]]]` where `sandboxResult` is
    the dest of the SANDBOX command.
  - Test `'SANDBOX: empty config'`: change `TO` to EXEC+dest.
  - Test `'SANDBOX: context array'`: change `TO` and `$LAST` references.

### `tests/math-map-context.test.mjs`

- The YAML string in the test that ends with `[SET, [RETURN, $LAST]]` →
  migrate to use dest on the preceding EXEC.

### Other `.test.mjs` files

- `buildMods.test.mjs` — check for any `$LAST` in mini-programs; unlikely.
- `context-isolation.test.mjs` — the test programs use `$LAST`; migrate.
- `request.test.mjs` — check for `$LAST`; migrate inline programs.
- `security.test.mjs` — check for `PIPE`/`TO`/`PROMISE`; migrate.
- `redteam.test.mjs` — harness only reads exit codes; no `$LAST` in harness.

---

## Phase 4 — Final Verification

```bash
npm run test:all
```

All tests pass when:
1. All migrated YAML/JSON scripts execute without errors (where they were
   previously expected to succeed).
2. All scripts expected to be blocked are still blocked.
3. Quota-exceeded scripts still hit quota.
4. `expectReturn` values match in integration tests.

---

## Quick Reference: Files Changed

| File | Change |
|------|--------|
| `nejy.mjs` | Remove `$LAST` from initial vars; remove `?? $LAST` fallback |
| `lib/buildMods.mjs` | Remove `$LAST` special case in `resolveMiniArg` |
| `lib/interp/context.mjs` | Remove `$LAST` from `carryOverBasicVars` |
| `lib/interp/commands.mjs` | EXEC: add dest/chain/compose/promise; NEW/LITERAL: add dest; add AWAIT; remove TO/PIPE/PROMISE; fix IF; fix F return |
| `lib/interp/childCommand.mjs` | Require dest arg; store promise in dest not $LAST |
| `lib/interp/scanner.mjs` | Remove TO/PIPE/PROMISE from HANDLED_COMMANDS; add AWAIT; scan decorator objects; check dest PP |
| All `tests/programs/*.yaml` | Migrate $LAST to named dests |
| All `tests/*.json` | Migrate $LAST to named dests |
| All `tests/redteam/*.yaml` | Migrate $LAST to named dests (attacks still blocked) |
| All `examples/**/*.yaml` | Migrate $LAST to named dests, PIPE to CHAIN |
| `tests/command_f.test.mjs` | Update assertions and inline programs |
| `tests/sandbox/sandbox.test.mjs` | Migrate inline programs |
| `tests/math-map-context.test.mjs` | Migrate inline YAML |
| Other `.test.mjs` files | Spot-check and migrate $LAST references |
