# Implementation Plan: Mods Capability System

Based on MODS_DESIGN.md and MODS_DESIGN2.md discussions.

> "The first principle is that you must not fool yourself — and you are the easiest
> person to fool." — Richard Feynman

Each stage ends with passing tests before the next stage begins. Tests are written
*before or alongside* the code changes they verify.

---

## Overview of Stages

| Stage | What changes | Key risk |
|-------|-------------|----------|
| 0 | Baseline test suite | None — read only |
| 1 | Registry files + buildMods() | Registry format, import plumbing |
| 2 | run(program, context) refactor | Behavioral regression |
| 3 | Mods replaces global in resolvePath | Breaks things that relied on global |
| 4 | Scanner uses registry lookup | Over/under blocking |
| 5 | REQUEST command | Top-of-program enforcement |
| 6 | maxRisk to CLI/ENV | Breaking change to invocation |
| 7 | SANDBOX command | Context isolation |

---

## Stage 0 — Baseline Tests (No code changes)

Goal: Capture current behavior precisely before touching anything. These tests
will become regression tests throughout the refactor.

### New test file: `tests/security.test.mjs`

Tests that current behavior is already correct:

```
PASS: passing_program + low-risk → exit 0, null error
PASS: failing_program + low-risk → exit 1, SEC_BLOCK in error
PASS: pi.json + medium-net → QUOTA_EXCEEDED (i-timeout)
PASS: pi.json + low-risk → killed (e-timeout)
```

Tests that current behavior is WRONG (document known gaps):
These should FAIL now and PASS after Stage 3/4.

```
SHOULD_FAIL (gap): eval accessible at LOW risk
  program: ["EXEC", ["eval", ["1+1"]]]
  policy: low-risk
  expected: exit 1, SEC_BLOCK
  currently: exit 0 (gap!)

SHOULD_FAIL (gap): process.exit accessible at LOW risk
  program: ["EXEC", ["process.exit", [1]]]
  policy: low-risk
  expected: exit 1, SEC_BLOCK
  currently: exit 1 (correct exit code, wrong reason — process exits before YAML output)

SHOULD_FAIL (gap): Object.setPrototypeOf accessible at LOW risk
  program: ["EXEC", ["Object.setPrototypeOf", [{}, null]]]
  policy: low-risk
  expected: exit 1, SEC_BLOCK
  currently: exit 0 (gap!)
```

### New directory: `tests/programs/`
Small purpose-built programs for security tests (not examples):
```
tests/programs/
  use-eval.yaml
  use-process-exit.yaml
  use-object-setprototypeof.yaml
  use-math-evaluate.yaml
  use-fs-read.yaml
  use-fs-write.yaml
  use-child-process.yaml
  use-os-hostname.yaml
  request-math-only.yaml
  request-exceeds-policy.yaml
  sandbox-basic.yaml
```

---

## Stage 1 — Registry Files and buildMods()

### Files created:
```
config/security/registry/
  00-builtins.yaml
  10-math.yaml
  20-console.yaml
  30-yaml-module.yaml
  40-os.yaml
  50-fs.yaml
  60-net.yaml
  90-process.yaml    (documented, never loaded by default)
```

Each entry format:
```yaml
entries:
  - key: math
    src: import        # "global" | "import"
    module: mathjs
    risk: LOW          # worst-case risk for unlisted paths
    methods:           # complete listing of exposed methods and their risk
      math.evaluate: LOW
      math.compile: LOW
      math.import: HIGH
    setup:             # nejy program; $MODULE = raw import; $LAST → Mods[key]
      - ["EXEC", ["$MODULE.create", ["$MODULE.all"]]]
```

### New file: `lib/buildMods.mjs`

```js
export async function buildMods(registryFiles, maxRisk, miniExecutor) {
    const riskMap = { LOW: 0, MEDIUM: 1, HIGH: 2, INSANE: 3 };
    const maxLevel = riskMap[maxRisk];
    const mods = {};
    for (const file of registryFiles) {
        const entries = loadYaml(file).entries;
        for (const entry of entries) {
            const rawModule = entry.src === 'global'
                ? globalThis[entry.key.split('.')[0]]
                : await import(entry.module);
            const instance = entry.setup
                ? await miniExecutor(entry.setup, { $MODULE: rawModule })
                : rawModule;
            // Build plain object of only listed methods within maxRisk
            const node = {};
            for (const [methodPath, risk] of Object.entries(entry.methods ?? {})) {
                if (riskMap[risk] > maxLevel) continue;
                const methodName = methodPath.split('.').slice(1).join('.');
                node[methodName] = bindMethod(instance, methodName);
            }
            mods[entry.key] = node;
        }
    }
    return mods;
}
```

### New test file: `tests/buildMods.test.mjs`

```
TEST: buildMods at LOW risk
  - mods.math.evaluate is a function
  - mods.math.import is undefined (HIGH > LOW)
  - mods.Object.setPrototypeOf is undefined (HIGH > LOW)
  - mods.Object.keys is a function
  - mods.fs is undefined (lowest fs method is MEDIUM)
  - mods.eval is undefined (not in registry)
  - mods.process is undefined (not loaded)

TEST: buildMods at MEDIUM risk
  - mods.fs.readFileSync is a function
  - mods.fs.writeFileSync is undefined (HIGH > MEDIUM)
  - mods.os.hostname is a function
  - mods.os.networkInterfaces is undefined (HIGH > MEDIUM)

TEST: buildMods at HIGH risk
  - mods.fs.writeFileSync is a function
  - mods.child_process.execSync is a function
  - mods.child_process.fork is undefined (INSANE > HIGH)
  - mods.eval is undefined (not in registry at any level)
  - mods.process is undefined (not in any default manifest)

TEST: setup program runs in isolation
  - After buildMods, vars does not contain $MODULE
  - mods.math is a configured mathjs instance, not the raw module
```

---

## Stage 2 — run(program, context) Refactor

Goal: Move all mutable execution state into a context object. No change to
external behavior — the 30 integration tests must still pass unchanged.

### Context object shape:
```js
{
    mods,       // capability map (built by buildMods)
    vars,       // { $LAST, $ERROR, $ITEM, $USAGE, $INPUT, $RETURN }
    functions,  // DEF'd functions
    mon,        // ResourceMonitor
    scanner,    // SecurityScanner (null during setup)
}
```

### Changes to `main.mjs`:
- Remove module-level `vars`, `functions`
- Rename `execute(steps, mon, em, scanner)` to `run(steps, ctx, emergencyMode)`
- All commands receive `ctx` instead of individual `mon`, `em`, `scanner` args
- `boot()` creates the context, scans the program, calls `run()`
- Registry setup uses `run(setup, { vars: { $MODULE }, mon: nullMon, scanner: null })`

### Tests: `tests/context-isolation.test.mjs`

```
TEST: vars are isolated between two run() calls
  - run program A that sets $FOO
  - run program B in separate context
  - program B cannot see $FOO

TEST: functions are isolated between contexts
  - DEF a function in context A
  - cannot CALL it in context B

TEST: 30 integration tests still pass (run existing suite)
```

---

## Stage 3 — Mods Replaces Global in resolvePath

Goal: `resolvePath` walks `ctx.mods` instead of `global`. Unreachable paths
(eval, process, Reflect.setPrototypeOf) now produce Link Fail at runtime.

### Changes:
```js
// Before:
let fn = pStr.startsWith('$') ? vars : global;

// After:
let fn = pStr.startsWith('$') ? ctx.vars : ctx.mods;
```

### $VARS proxy fix:
```js
// Before: exposes all of global as fallback
get: (t, p) => t[p] ?? global[p]

// After: exposes only vars; Mods NOT exposed via $VARS
get: (t, p) => t[p]
// Programs must explicitly pass mods values as arguments; not auto-scoped
```

### Tests: `tests/mods-containment.test.mjs`

Using the programs created in Stage 0:

```
TEST: eval is unreachable at any risk level
  program: use-eval.yaml
  policy: high-net (maxRisk=HIGH)
  expected: exit 1, Link Fail: eval (or SEC_BLOCK if scanner catches first)

TEST: process.exit is unreachable at any risk level
  program: use-process-exit.yaml
  policy: high-net
  expected: exit 1, Link Fail: process.exit

TEST: Object.setPrototypeOf is unreachable at LOW risk
  program: use-object-setprototypeof.yaml
  policy: low-risk (maxRisk=LOW)
  expected: exit 1, blocked (not in Mods at LOW)

TEST: Object.setPrototypeOf IS reachable at HIGH risk
  program: use-object-setprototypeof.yaml
  policy: high-net (maxRisk=HIGH)
  expected: exit 0 (it's in registry at HIGH)

TEST: math.evaluate works at LOW risk
  program: use-math-evaluate.yaml
  policy: low-risk
  expected: exit 0

TEST: fs.readFileSync works at MEDIUM, blocked at LOW
  program: use-fs-read.yaml
  policy: low-risk → exit 1
  policy: medium-net → exit 0

TEST: fs.writeFileSync blocked at MEDIUM, available at HIGH
  program: use-fs-write.yaml
  policy: medium-net → exit 1
  policy: high-net → exit 0

TEST: 30 integration tests still pass
```

---

## Stage 4 — Scanner Uses Registry Lookup

Goal: Replace the blacklist in SecurityScanner with a registry-based lookup.
Unrecognized paths are blocked at scan time, not just runtime.

### New function: `effectiveRisk(pathStr, registry)`
1. Exact match in any entry's `methods` → return that level
2. Longest prefix match in entry `key` values → return entry's `risk`
3. No match → null (SEC_BLOCK immediately)

### Updated `checkPath()`:
```js
checkPath(pathStr) {
    if (pathStr.startsWith('$')) return; // runtime value; checked by Mods at runtime
    const risk = effectiveRisk(pathStr, this.registry);
    if (risk === null)
        throw new Error(`SEC_BLOCK: '${pathStr}' not in capability registry`);
    if (riskMap[risk] > this.maxLevel)
        throw new Error(`SEC_BLOCK: '${pathStr}' requires ${risk} risk`);
}
```

### Tests: `tests/scanner-registry.test.mjs`

```
TEST: eval blocked by scanner at all risk levels (not in registry)
  expected: SEC_BLOCK, not in capability registry

TEST: process.exit blocked by scanner at all risk levels
  expected: SEC_BLOCK, not in capability registry

TEST: math.evaluate passes scanner at LOW
TEST: fs.readFileSync passes scanner at MEDIUM, blocked at LOW
TEST: Object.setPrototypeOf passes scanner at HIGH, blocked at MEDIUM/LOW
TEST: child_process.fork blocked by scanner at all levels (INSANE, not in manifest)
TEST: unknown.someMethod blocked (not in registry at any level)

TEST: 30 integration tests still pass
```

---

## Stage 5 — REQUEST Command + IMPORT Interaction

Goal: Programs declare required capabilities. REQUEST must appear at the start
of the program (before any EXEC, NEW, PIPE, CALL, IF, FOR_EACH, TRY).

### Semantics:
```yaml
["REQUEST", ["math", "console.log", "os.hostname", "fs.readFileSync"]]
```

- Module name (e.g., `"math"`) → grant all methods of that module within maxRisk
- Method name (e.g., `"fs.readFileSync"`) → grant exactly that method
- Effective Mods = intersection of (built Mods from manifest) ∩ (REQUESTed set)
- Any EXEC outside requested set → SEC_BLOCK (even if within maxRisk)
- Missing REQUEST → all manifest-permitted Mods available (backwards compatible)
- REQUEST of something that exceeds maxRisk → SEC_BLOCK at REQUEST time

### Position enforcement:
- Scanner checks that REQUEST only appears before any executable commands at top level
- REQUEST inside a DEF body or IF branch → SEC_BLOCK (not permitted)

### REQUEST + IMPORT Interaction

Programs are intended to be reusable as libraries. A saved program can be
IMPORTed by another. This means an imported file may itself contain a REQUEST
line declaring what it needs.

**Invariant: imported program's REQUEST must be a subset of the parent's effective Mods.**

An importable library is a program array, just like a normal program:
```yaml
# lib/pi-tools.yaml
- ["REQUEST", ["math", "console.log"]]
- ["DEF", ["computePi",
    [["EXEC", ["math.evaluate", ["4 * sum / n"]]]]
  ]]
- ["DEF", ["formatResult",
    [["EXEC", ["console.log", ["Pi ≈", "$INPUT"]]]]
  ]]
```

Parent program:
```yaml
- ["REQUEST", ["math", "console.log", "fs.readFileSync"]]
- ["IMPORT", ["./lib/pi-tools.yaml"]]
- ["CALL", ["computePi", []]]
```

**At IMPORT time, the interpreter must:**
1. Load and parse the file
2. Detect format:
   - **Array** → new-style program; extract REQUEST from top (if any)
   - **Object (map)** → old-style function map; no REQUEST (backwards compatible)
3. For new-style: verify imported REQUEST ⊆ parent's effective Mods
   - Library requests `["math", "console.log"]`, parent only requested `["math"]`
     → SEC_BLOCK (parent cannot grant console.log to the library)
   - Library requests `["fs.writeFileSync"]` (HIGH) under MEDIUM policy
     → SEC_BLOCK
4. Scan each DEF body against the *library's own* REQUEST capabilities
   (not the parent's full capabilities)
5. Merge DEF'd functions into parent's `functions` map as `{ steps, mods }` pairs,
   where `mods` is the library's effective Mods at IMPORT time
6. At CALL time, run the function against its own `mods`, not the caller's

This means a function always runs under the capabilities of the file it was
DEFined in — regardless of who calls it or from where.

**Recursive IMPORT — subset chain rule:**
```
grandchild REQUEST ⊆ child REQUEST ⊆ parent REQUEST ⊆ maxRisk
```
Each IMPORT step verifies the subset relationship at that hop.

**Old-style import (backwards compat):** if the loaded content is a plain object
(map of `{fnName: steps}`), it has no REQUEST. Its functions inherit the parent's
effective Mods for scanning and execution. A warning is emitted.

### Tests: `tests/request.test.mjs`

```
TEST: program with correct REQUEST runs fine
  ["REQUEST", ["math", "console.log"]]
  then uses math.evaluate and console.log
  policy: low-risk → exit 0

TEST: program without REQUEST gets full manifest capabilities (backwards compat)
  policy: low-risk, uses math.evaluate → exit 0

TEST: program EXECs un-REQUESTed capability → SEC_BLOCK
  ["REQUEST", ["math"]]
  ["EXEC", ["console.log", ["hello"]]]  ← not requested
  expected: exit 1, SEC_BLOCK

TEST: REQUEST of capability exceeding maxRisk → SEC_BLOCK
  ["REQUEST", ["fs.writeFileSync"]]  ← HIGH
  policy: low-risk (maxRisk=LOW)
  expected: exit 1, SEC_BLOCK at REQUEST time

TEST: REQUEST of entire module grants all allowed methods
  ["REQUEST", ["os"]]
  policy: medium-net
  os.hostname available; os.networkInterfaces blocked (HIGH > MEDIUM)

TEST: REQUEST after EXEC → SEC_BLOCK (wrong position)
  ["EXEC", ["console.log", ["hi"]]]
  ["REQUEST", ["math"]]
  expected: exit 1, SEC_BLOCK (REQUEST not at top)

TEST: IMPORT library with REQUEST that is subset of parent → OK
  parent requests ["math", "console.log", "os.hostname"]
  library requests ["math", "console.log"]  ← subset
  expected: import succeeds; library functions callable

TEST: IMPORT library with REQUEST that exceeds parent → SEC_BLOCK
  parent requests ["math"]
  library requests ["math", "fs.readFileSync"]  ← fs not in parent
  expected: exit 1, SEC_BLOCK at IMPORT time

TEST: IMPORT library with REQUEST that exceeds maxRisk → SEC_BLOCK
  library requests ["fs.writeFileSync"]  ← HIGH under MEDIUM policy
  expected: exit 1, SEC_BLOCK at IMPORT time

TEST: IMPORT old-style map (backwards compat) — no REQUEST, still works
  imported file: { "greet": [["EXEC", ["console.log", ["hi"]]]] }
  expected: CALL greet succeeds; function inherits parent capabilities

TEST: IMPORT nested — grandchild REQUEST must be subset of child REQUEST
  grandchild requests ["math"]
  child requests ["math", "console.log"]
  parent requests ["math", "console.log", "os.hostname"]
  expected: all imports succeed

TEST: CALL imported function is bounded by library's REQUEST, not caller's
  library declares REQUEST ["math"] only
  library DEF body would need fs.readFileSync (not in library REQUEST)
  expected: exit 1, SEC_BLOCK at IMPORT time (scan of DEF body fails)

TEST: 30 integration tests still pass (no REQUEST = backwards compat)
```


---

## Stage 6 — maxRisk to CLI / ENV

Goal: Remove `maxRisk` from manifest. Move to `--maxRisk` CLI arg, bounded by
`NEJY_MAX_RISK` environment variable.

### New invocation:
```bash
# Old:
node main.mjs program.yaml manifest.json

# New:
node main.mjs program.yaml manifest.json --maxRisk=MEDIUM
NEJY_MAX_RISK=HIGH node main.mjs program.yaml manifest.json --maxRisk=INSANE
# effective = min(INSANE, HIGH) = HIGH
```

### Manifest gains `minRisk`:
```json
{
  "registry": ["builtins", "math", "console", "os"],
  "capabilities": ["math", "console.log", "os.hostname"],
  "minRisk": "LOW"
}
```

If effective maxRisk < minRisk → boot fails with clear error.

### Logged in output:
```yaml
# header in stderr at boot:
nejy v0.52.0 | effectiveMaxRisk: MEDIUM | program: pi.yaml | manifest: medium-net.json
```

### Tests: `tests/maxrisk-cli.test.mjs`

```
TEST: --maxRisk=LOW blocks fs.readFileSync
TEST: --maxRisk=MEDIUM allows fs.readFileSync
TEST: NEJY_MAX_RISK=LOW caps --maxRisk=HIGH to LOW
TEST: manifest minRisk=MEDIUM + --maxRisk=LOW → boot failure, clear error
TEST: missing --maxRisk defaults to LOW
TEST: 30 integration tests updated for new CLI invocation
```

---

## Stage 7 — SANDBOX Command

Goal: Run a subprogram with a restricted subset of current capabilities.

### Semantics:
```yaml
["SANDBOX", ["console.log"],   ← capabilities granted (subset of current)
  [                            ← subprogram
    ["EXEC", ["console.log", ["safe"]]],
    ["SET", ["result", "42"]]
  ]
]
```

- Capabilities: list of module/method names, same syntax as REQUEST — must be subset of current context
- vars: starts as a copy of parent vars ($LAST, $ERROR, etc. are visible)
- Changes inside sandbox do NOT propagate back to parent vars
- $RETURN in sandbox → becomes $LAST in parent after SANDBOX completes
- functions: sandbox sees parent functions (read-only)
- Scanner validates sandbox body against sandbox capabilities, not parent

### Tests: `tests/sandbox.test.mjs`

```
TEST: sandbox restricts capabilities below parent
  parent: HIGH (has fs.writeFileSync)
  sandbox: ["console.log"]
  sandbox body tries fs.writeFileSync → SEC_BLOCK

TEST: sandbox cannot escalate above parent
  parent: LOW
  sandbox: ["fs.writeFileSync"]  ← HIGH, exceeds parent LOW
  expected: SEC_BLOCK at SANDBOX declaration

TEST: var isolation — sandbox changes don't propagate
  parent sets $FOO = "hello"
  sandbox sets $FOO = "modified"
  after sandbox, parent's $FOO is still "hello"

TEST: $RETURN propagates out of sandbox
  sandbox sets $RETURN = 42
  parent's $LAST = 42 after SANDBOX

TEST: nested SANDBOX
  outer sandbox: ["math", "console.log"]
  inner sandbox: ["console.log"]  ← subset of outer, valid
  inner body tries math.evaluate → SEC_BLOCK

TEST: 30 integration tests still pass
```

---

## Test Programs Needed (tests/programs/)

| File | Purpose |
|------|---------|
| `use-eval.yaml` | `["EXEC", ["eval", ["1+1"]]]` |
| `use-process-exit.yaml` | `["EXEC", ["process.exit", [0]]]` |
| `use-object-setprototypeof.yaml` | `["EXEC", ["Object.setPrototypeOf", [{}, null]]]` |
| `use-math-evaluate.yaml` | `["EXEC", ["math.evaluate", ["1+1"]]]` |
| `use-fs-read.yaml` | `["EXEC", ["fs.readFileSync", ["package.json", "utf8"]]]` |
| `use-fs-write.yaml` | `["EXEC", ["fs.writeFileSync", ["/tmp/t.txt", "hi"]]]` |
| `use-child-process.yaml` | `["EXEC", ["child_process.execSync", ["echo hi"]]]` |
| `use-os-hostname.yaml` | `["EXEC", ["os.hostname", []]]` |
| `request-math-only.yaml` | REQUEST math; use math + console.log (latter blocked) |
| `request-exceeds-policy.yaml` | REQUEST fs.writeFileSync under low-risk |
| `lib-with-request.yaml` | Library with REQUEST ["math", "console.log"] + DEF computePi |
| `lib-exceeds-parent.yaml` | Library REQUEST includes capability parent doesn't have |
| `lib-old-style.json` | Old map-style library (backwards compat) |
| `sandbox-basic.yaml` | SANDBOX with restricted caps |
| `sandbox-escape-attempt.yaml` | SANDBOX body tries to exceed its caps |

---

## Summary: What Each Stage Proves

| Stage | "We are not fooling ourselves because..." |
|-------|------------------------------------------|
| 0 | We documented the current gaps; we know what is broken |
| 1 | buildMods produces exactly the correct function set per risk level |
| 2 | run(context) is behaviorally identical to the old execute (30 tests pass) |
| 3 | eval and process are truly unreachable — not just scanner-blocked |
| 4 | Unknown paths fail at scan time, not silently at runtime |
| 5 | Programs cannot use capabilities they didn't request; imported libraries cannot exceed parent's grant |
| 6 | Operators can independently cap risk from manifest authors |
| 7 | A sandboxed subprogram cannot affect parent state or escalate |
