# MODS_DESIGN2.md — Revised Capability System

This document incorporates feedback on MODS_DESIGN.md and challenges where appropriate.

---

## Response to Each Drawback

### 1. Don't put the whole module in Mods — only explicitly listed methods

Instead of `Mods.math = new Proxy(mathInstance, ...)`, build `Mods.math` as a plain
object containing only the explicitly listed function bindings:

```js
Mods.math = {
  evaluate: mathInstance.evaluate.bind(mathInstance),
  max:      mathInstance.max.bind(mathInstance),
  // ... only what the registry lists
};
// math.import is simply absent — not extractable, not callable
```

This solves method extraction (#1 in drawbacks) structurally rather than defensively:
`$math.import` cannot be extracted because it is not in `Mods.math` at all.
No proxy is needed for enforcement; a proxy can still be used as defense-in-depth.

**Note**: With explicit listing, the module's base `risk` field in the registry
becomes a documentation/auditing signal rather than a runtime default. Its main
remaining purpose is to tell the scanner what to assume about any path that resolves
to this namespace but isn't explicitly listed.

---

### 2. Isolated execution context — `run(program, context)`

**The technical claim to challenge**: "boot() has only one execution context."
This is true today, but the deeper issue is that `vars` and `functions` are
module-level mutable objects shared between setup and user execution. Even if we
add a separate setup phase, they share state unless explicitly isolated.

**Solution**: Introduce a `run(program, context)` function as the fundamental
execution primitive:

```js
async function run(program, context) {
    // context = { mods, vars, functions, mon, scanner }
    // All execution state is in context, not in module-level globals
    ...
}
```

This has several consequences:

- **Setup isolation**: Registry setup programs call `run(setup, setupContext)`
  where `setupContext.vars` starts fresh. `$MODULE` is in that vars object.
  After setup, `setupContext` is discarded. The main program's context never
  sees `$MODULE`.

- **Unscanned executor**: `run()` itself does not scan. It is the bare executor.
  The scanning step happens *before* calling `run()`, in a separate function
  that validates the program against the context's scanner and mods.

- **User programs**: At boot, create a clean context with built Mods, then
  scan the user program against it, then call `run(program, cleanContext)`.

- **SANDBOX command** (see #10): A `SANDBOX` step calls `run(subprogram,
  restrictedContext)` where restrictedContext is a subset of the current context.

---

### 3. Module risk defaults: INSANE as base for dangerous modules

**User proposal**: If any methods of a module are INSANE, declare the module as
INSANE and override safe methods as LOW/MEDIUM/HIGH rather than declaring LOW
and overriding up.

**Agreement with qualifications**: This is correct *as a registry authoring
convention* for modules with dangerous defaults (Object, Reflect, process, fs).
The rule of thumb:

- If the module's un-overridden methods are **mostly safe**, use `risk: LOW`
  as the base and override dangerous methods up (e.g. `math`, `Array`, `Date`)
- If the module's un-overridden methods are **mostly dangerous** or the module
  as a whole grants elevated access, use `risk: HIGH` or `risk: INSANE` as the
  base and override safe methods down (e.g. `Object`, `Reflect`, `fs`, `process`)

**Challenge**: If solution #1 is fully implemented (only explicit listings in Mods),
the base `risk` of a module is only a fallback for paths that are in the namespace
but not in the explicit listing. With explicit listing, those paths are never in
Mods anyway. So the base risk is a belt-and-suspenders signal — still worth
getting right for documentation, scanner logic, and defense in depth, but not
the primary safety mechanism.

Revised example registry entries:

```yaml
# Object: INSANE base because setPrototypeOf, defineProperty are INSANE-class
- key: Object
  src: global
  risk: INSANE
  methods:
    Object.keys: LOW
    Object.values: LOW
    Object.entries: LOW
    Object.fromEntries: LOW
    Object.assign: LOW
    Object.freeze: LOW
    Object.is: LOW
    Object.create: LOW       # safe without prototype argument
    Object.defineProperty: HIGH
    Object.setPrototypeOf: HIGH

# fs: INSANE base; read methods carved out
- key: fs
  src: import
  module: node:fs
  risk: INSANE
  methods:
    fs.readFileSync: MEDIUM
    fs.readdirSync: MEDIUM
    fs.statSync: MEDIUM
    fs.existsSync: MEDIUM
    fs.writeFileSync: HIGH
    fs.appendFileSync: HIGH
    fs.unlinkSync: HIGH
    fs.mkdirSync: HIGH
    fs.chmodSync: INSANE
    fs.chownSync: INSANE
```

Note: renamed `overrides` to `methods` to clarify that this is the complete
listing, not just exceptions.

---

### 4. Hot paths / performance

Lower priority. Deferred.

---

### 5. Config file protection

Registry files in `config/security/registry/` should be owned by root or a
privileged user, readable but not writable by the script's runtime user
(ideally `nobody`). This is a deployment concern, not a code concern.

---

### 6. Isolated execution solves setup isolation

Covered under #2. `run(program, context)` with fresh contexts per phase.

---

### 7. mathjs $VARS scope — partial challenge

**User claim**: The mathjs `math.evaluate` issue is solved if the functions aren't
in the scope.

**Partial agreement**: If `$VARS` falls back to `Mods` instead of `global`, and
`Mods` doesn't contain `process` or `eval`, those can no longer be reached through
a mathjs expression.

**Remaining concern**: `$VARS` still exposes *all* of the current `Mods` as the
expression scope. If a program runs at HIGH risk and `child_process` is in Mods,
then `math.evaluate("child_process.execSync('id')", $VARS)` may succeed because
`child_process` *is* in the scope via the Mods fallback.

**Mitigation**: `$VARS` should expose only `vars` (user-set variables), not Mods.
A separate `$MODS` could be provided explicitly if a program needs to pass module
references into an expression evaluator. This way `$VARS` is safe to pass to any
external expression evaluator.

---

### 8. Registry load ordering

Registry filenames are prefixed with a two-digit number to control load order:

```
config/security/registry/
  00-builtins.yaml
  10-math.yaml
  20-console.yaml
  30-os.yaml
  40-fs.yaml
  50-net.yaml
  90-process.yaml    # documented but not referenced by any manifest
```

The manifest lists registry files by base name (without the prefix), or by full
filename. The loader sorts files numerically when loading all from a directory.

---

### 9. maxRisk as a command-line parameter bounded by ENV

**Proposal**: Move `maxRisk` out of the manifest and into the CLI:

```bash
node main.mjs program.yaml manifest.json --maxRisk=MEDIUM
```

Bounded by an environment variable:
```bash
export NEJY_MAX_RISK=HIGH  # operator ceiling
node main.mjs program.yaml manifest.json --maxRisk=INSANE
# actual maxRisk = min(INSANE, HIGH) = HIGH
```

The manifest retains `capabilities` (what the program needs) and `registry`
(which modules are available). `maxRisk` is the runtime policy applied by the
operator.

**Benefit**: Separates program requirements (manifest) from operator policy (CLI/ENV).
The same manifest can be run at different risk levels; the operator controls the cap.

**Challenge/concern**: The manifest is no longer self-contained. To reproduce
what actually ran, you need both the manifest and the CLI invocation. In container
or CI environments, this is an auditability tradeoff. Consider logging the
effective `maxRisk` at boot (as part of the YAML output header or stderr) to
maintain a complete execution record.

**Proposed minimum risk**: The manifest could declare `minRisk: MEDIUM` to signal
that this program *requires* at least MEDIUM capabilities. If the operator provides
a maxRisk below minRisk, boot fails with a clear error rather than silently degrading.

---

### 10. SANDBOX command for reducing capabilities in subprograms

A `SANDBOX` command that calls `run(subprogram, restrictedContext)`:

```yaml
["SANDBOX", {maxRisk: "LOW", capabilities: ["math", "console"]},
  [
    ["EXEC", ["math.evaluate", ["$untrustedInput"]]],
    ["SET", ["result", "$LAST"]]
  ]
]
```

Rules:
- The SANDBOX context can only be *equal to or more restricted* than the current
  context — never more permissive. Attempting to grant capabilities not in the
  parent context throws at scan time.
- `vars` in the sandbox starts as a copy of the parent's vars (or a subset),
  and changes inside the sandbox do not propagate back unless explicitly returned
  via `$RETURN`.
- The scanner pre-validates the sandbox body against the *sandbox's* restricted
  capabilities before executing, not the parent's.
- This enables a useful pattern: a HIGH-risk program can safely run untrusted
  subprograms at LOW risk.

---

## Revised Registry Entry Structure

```yaml
entries:
  - key: math
    src: import          # "global" | "import"
    module: mathjs       # npm specifier; only if src=import
    risk: LOW            # base risk for any unlisted path in this namespace
    methods:             # complete listing of exposed methods and their risk
      math.evaluate: LOW
      math.compile: LOW
      math.parse: LOW
      math.max: LOW
      math.min: LOW
      math.import: HIGH  # extends mathjs scope
    setup:               # nejy program; runs in isolated context via run()
      - ["EXEC", ["$MODULE.create", ["$MODULE.all"]]]
      # $LAST → placed into Mods["math"] as a plain object of bound methods
```

---

## Revised Boot Sequence

```
1. Load registry files (sorted by filename prefix)
2. For each registry entry:
   a. Acquire $MODULE (global or import)
   b. Run setup via run(setup, { vars: { $MODULE }, mon: nullMon }) — isolated context
   c. Build Mods[key] as plain object with only listed methods bound from $LAST
3. Parse CLI: effectiveMaxRisk = min(--maxRisk CLI arg, NEJY_MAX_RISK env)
4. Build final Mods by filtering: only methods where risk <= effectiveMaxRisk
5. Load and parse user program
6. Scan user program against final Mods (path must exist in Mods + risk check)
7. run(userProgram, { mods: finalMods, vars: fresh {}, functions: {}, mon, scanner })
8. Output YAML result block
```

---

## What This Changes in main.mjs

| Current | Revised |
|---------|---------|
| Module-level `vars`, `functions` | Moved into `context` object passed to `run()` |
| `global` as callable surface | `Mods` built from registry |
| Scanner uses blacklist | Scanner checks path against Mods keys |
| `$VARS` falls back to `global` | `$VARS` exposes only vars (not Mods) |
| Single boot() function | boot() orchestrates; run() is the primitive executor |
| maxRisk in manifest | maxRisk from CLI, bounded by ENV |
| No SANDBOX | SANDBOX command calls run() with restricted context |
