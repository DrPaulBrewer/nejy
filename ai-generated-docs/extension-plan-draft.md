# Draft: nejy User-Contributed Extension System via npm

> **Status:** Draft rev 3 — expanded §10 (commands).
> **Date:** 2026-04-19

---

## 1. Vision

Let anyone publish a nejy capability extension as a plain npm package. An operator installs it with:

```bash
npm i nejy-ext-cool-thing -S
```

After opt-in in the policy file, scripts running under an appropriate policy gain access to the new capability — subject to the same risk-gating, scanning, and quota machinery that governs built-in capabilities. The nejy project **does not control or curate the ecosystem.** If someone wants to publish and use `cryptoid-nejy-extension`, that is their business.

---

## 2. Architecture Recap (Relevant Parts)

The registry YAML files — loaded by `loadRegistry()`, fed to `buildMods()` and `SecurityScanner()` — are the single choke point for what is callable. Nothing is callable in a nejy program unless it appears in a loaded registry entry AND its risk level is within the active policy. Extensions must hook into this system, not bypass it.

`F` and `MATH` commands register callables into `ctx.vars` and record themselves in `ctx.history`. The `run()` primitive processes steps linearly. These are the injection points for startup nejy code.

---

## 3. Extension Manifest: `package.json` as the Source of Truth

> [!IMPORTANT]
> A key design decision, updated from the previous draft: **no separate registry YAML file is required.** The extension's entire declaration lives in a `"nejy"` key in its `package.json`. This is simpler (single artifact), readable by npm tooling, and consistent with how other tools (Babel, ESLint, etc.) use `package.json`.

### 3.1  `package.json` shape

```json
{
  "name": "nejy-ext-csv",
  "version": "1.0.0",
  "type": "module",
  "nejy": {
    "format": 1,
    "entries": [
      {
        "key": "csv",
        "src": "import",
        "module": "nejy-ext-csv",
        "risk": "MEDIUM",
        "methods": {
          "csv.parse":     "MEDIUM",
          "csv.stringify": "LOW"
        }
      }
    ],
    "startup": [
      ["MATH", ["csvRowCount", ["data"], "length(data)"]],
      ["MATH", ["csvColCount", ["row"],  "length(row)"]]
    ]
  }
}
```

| Field | Required | Description |
|---|---|---|
| `format` | yes | Integer schema version. Currently `1`. Used to reject incompatible future extensions. |
| `entries` | yes if exposing native modules | Array of registry entry objects in the same format as `config/security/registry/available/*.yaml` entries |
| `startup` | no | Array of nejy steps (`MATH`, `F`, `SET`, `LITERAL` only — see §7) prepended to every program before the user's steps |

### 3.2  Validation via `format`

When `format` is absent or unrecognised, nejy **aborts with a hard error** — consistent with the belt-and-suspenders philosophy. A future format version can be phased in without breaking old extensions by gating on this field.

---

## 4. Opt-In Mechanism

Extension loading is **off by default.** An operator enables it in the policy file:

```json
{
  "maxRisk": "MEDIUM",
  "extensions": true,
  "quotas": { "maxCpuMs": 5000, "maxMemoryMb": 512, "maxFsBytes": 0 }
}
```

`extensions: true` means: discover and load all installed packages that have a `"nejy"` key. There is no per-extension allowlist in the policy — the trust model (§5) handles that at the package level.

Alternatively:

```json
"extensions": ["nejy-ext-csv", "nejy-ext-sqlite"]
```

An array form provides operator-level explicit enumeration, regardless of what else is installed, without requiring signing infrastructure on day one. **This is the recommended MVP default behaviour** — it forces the operator to name each extension they trust.

---

## 5. Trust Model: npm Provenance (Signed Packages)

Self-reported risk levels in an extension's `package.json` are the fundamental trust problem. The mechanism for addressing this is **npm package provenance via Sigstore**.

### 5.1  What npm provenance gives you

Since npm 9.5 / registry 2023, publishers can attest their package with a signed SLSA provenance statement tied to the exact CI run that produced it:

```bash
npm publish --provenance
```

The attestation is verifiable by anyone:

```bash
npm audit signatures
```

This ties the package artifact to a specific source repo and CI pipeline. A consumer can verify that:
- The package was built from the claimed GitHub repo.
- The package was not tampered with after publish.
- The publisher's CI build log is public.

It does **not** verify that the declared risk levels are accurate — that remains a human/social judgment. But it raises the cost of a supply-chain attack significantly, and it makes attribution unambiguous.

### 5.2  How nejy uses provenance

The extension loader checks provenance via the local npm metadata. **If an extension doesn't have a provenance attestation (i.e., was published without `--provenance`), nejy logs a warning but does not hard-block.** This keeps the system usable for local/private packages, while nudging the ecosystem toward signing.

A stricter operator option:

```json
"extensionPolicy": "require-provenance"
```

With this set, any extension missing a valid provenance attestation is **skipped with a hard error**, not silently dropped.

Practically, provenance checking at load time would call `npm audit signatures` (or invoke the underlying `@npmcli/arborist` / `pacote` APIs) for each extension package. This is a solvable technical problem but has non-trivial implementation cost — it is a v2 feature.

### 5.3  The social trust model

The nejy project does not gatekeep the ecosystem. The trust chain for an extension is:

```
npm provenance → source repo → extension author → declared risk levels → operator decides to install
```

Operators are responsible for deciding whether they trust an extension author enough to install their package. Documentation should be explicit: **installing a nejy extension with `extensions: true` is equivalent to trusting its author's claimed risk labels at face value.** Users who need stronger guarantees should audit the extension source and pin the version in `package-lock.json`.

---

## 6. Extension Dependencies

Extensions are ordinary npm packages. Their dependencies — whether transitive or direct — are resolved by npm in the normal way during `npm install`. **nejy does not need to manage or reason about extension dependencies separately.**

Key points:

- An extension's `"entries"` declare only what nejy exposes to scripts. The extension's own internal imports (its implementation) can use anything in its `node_modules`.
- If two extensions share a dependency (e.g., both use `lodash`), npm deduplicates it following standard resolution rules.
- A dependency of an extension is NOT automatically exposed to nejy scripts — it must be explicitly declared in `"entries"` to be reachable.
- Risk: an extension's internal code runs at `import()` time (module-level evaluation). This is the same risk as all current `src: import` built-ins. **Prototype-freeze and the `freezeAndVerify` check in `buildEntry` apply to the entry's exported object, not to transitive dependencies' internals.** This limitation exists today and is not worsened by the extension system.

---

## 7. Startup Code Injection

The `"startup"` array in an extension's `package.json` is a list of nejy steps that are **prepended to every program's step list before scanning and execution**. This allows extensions to contribute reusable helpers (functions, math expressions, constants) that programs can call directly.

### 7.1  Permitted startup commands

Only a restricted set is allowed in `"startup"`:

| Allowed | Rationale |
|---|---|
| `MATH` | Define math-expression functions — pure, sandboxed by mathjs |
| `F` | Define nejy functions — subject to normal scan |
| `SET` | Set constants / initial variable values |
| `LITERAL` | Define structured constants |

**Not allowed** in startup (hard error if present):
- `EXEC`, `PIPE`, `PROMISE`, `NEW` — would execute immediately before the user's program, bypassing intent
- `REQUEST` — must remain the first step of the user's program, not injected
- `SANDBOX`, `CHILD`, `FOR_EACH`, `IF`, `TRY` — control flow at startup is not meaningful

### 7.2  How injection works

In `nejyRun()` / `nejyScan()`, after extensions are discovered:

```mjs
// Pseudo-code
const extensionStartup = extensions.flatMap(ext => ext.nejy.startup ?? []);
const effectiveProgram = [...extensionStartup, ...userProgram];
// then scan + run effectiveProgram as normal
```

The scanner sees the combined program, so startup steps are fully scanned. Extension-contributed `F` and `MATH` steps appear in `ctx.history` and are available to user-defined functions that use `"all functions"`.

### 7.3  Startup code security

Startup code is extension code. It is scanned by `SecurityScanner` against the same policy and registry as the user program. An extension cannot use startup code to elevate privileges — if the runtime policy is `LOW`, an extension's startup `F` body is limited to `LOW`-risk paths, exactly as user code is.

---

## 8. Failure Modes

Consistent with the belt-and-suspenders philosophy:

| Situation | Behaviour |
|---|---|
| Extension `package.json` has no `"nejy"` key | Silently skipped (not an extension) |
| `"nejy"` key present but `format` missing or unrecognised | **Hard abort** with descriptive error |
| `"entries"` reference a module that can't be imported | **Hard abort** (same as a broken built-in entry) |
| Prototype-freeze check fails on an extension's export | **Hard abort** with `FATAL SECURITY ERROR` |
| `"startup"` contains a disallowed command | **Hard abort** before execution |
| Extension startup code fails the SecurityScanner | **Hard abort** — treated as a security violation |
| Policy has `extensionPolicy: "require-provenance"` and extension has none | **Hard abort** |

---

## 9. Discovery Implementation Sketch

```mjs
// lib/registryDiscovery.mjs additions

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Walk node_modules (including scoped packages like @org/name)
 * and return parsed nejy extension manifests for installed packages
 * that declare a "nejy" key in their package.json.
 *
 * @param {string} projectRoot
 * @param {boolean|string[]} filter - true = all, string[] = allowlist by name
 * @returns {{ name: string, nejy: object }[]}
 */
export function getInstalledExtensions(projectRoot = process.cwd(), filter = true) {
  const nmDir = join(projectRoot, 'node_modules');
  const candidateDirs = [];

  for (const entry of readdirSync(nmDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      // Scoped package: walk one level deeper
      const scopeDir = join(nmDir, entry.name);
      for (const scoped of readdirSync(scopeDir, { withFileTypes: true })) {
        if (scoped.isDirectory())
          candidateDirs.push({ dir: join(scopeDir, scoped.name), name: `${entry.name}/${scoped.name}` });
      }
    } else {
      candidateDirs.push({ dir: join(nmDir, entry.name), name: entry.name });
    }
  }

  const extensions = [];
  for (const { dir, name } of candidateDirs) {
    if (Array.isArray(filter) && !filter.includes(name)) continue;
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    let meta;
    try { meta = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { continue; }
    if (!meta?.nejy) continue;
    if (!meta.nejy.format) throw new Error(`Extension '${name}': missing "nejy.format" field — aborting`);
    if (meta.nejy.format !== 1) throw new Error(`Extension '${name}': unsupported "nejy.format" ${meta.nejy.format}`);
    extensions.push({ name, nejy: meta.nejy });
  }

  return extensions;
}
```

### 9.1  Integration into `loadSetup()` / `nejyRun()`

```mjs
// In nejy.mjs loadSetup():

const extSetting = policy.extensions;
let extensionManifests = [];
if (extSetting) {
  const filter = Array.isArray(extSetting) ? extSetting : true;
  extensionManifests = getInstalledExtensions(process.cwd(), filter);
}

// Merge extension registry entries with built-in entries
const extEntries = extensionManifests.flatMap(e => e.nejy.entries ?? []);
const allEntries = [...builtinEntries, ...extEntries];

// Collect startup steps, validated before use
const startupSteps = buildStartupSteps(extensionManifests); // validates allowed commands
```

```mjs
// In nejyRun(), before scan:
const effectiveProgram = [...startupSteps, ...userProgram];
const scanned = await scanner.scan(effectiveProgram);
```

---

## 10. What Cannot Be Extended via This Mechanism

### 10.1  New Interpreter Commands

This is the most nuanced limitation and deserves a full explanation.

**The two-file invariant.** Every nejy interpreter command must appear in *two* places:

1. `lib/interp/commands.mjs` — the runtime handler (the `commands` object)
2. `lib/interp/scanner.mjs` — the static analysis handler (`HANDLED_COMMANDS` set + explicit `switch` case in `analyze()`)

The scanner enforces this invariant with a hard tripwire in `analyze()`:

```js
if (!(path in commands)) {
    this.checkPath(path);          // treat as a registry callable
} else {
    if (!HANDLED_COMMANDS.has(path)) {
        throw new Error(`SEC_BLOCK: Unhandled interpreter command '${path}' in scanner`);
    }
}
```

If a path is recognised as a command but has no corresponding scanner case, execution is blocked. This is intentional — it prevents a new command from being added to the runtime without the author also thinking through what the scanner needs to examine in its arguments.

**Why this can't be opened to extensions.** The scanner case for a branch command (one whose arguments contain sub-programs) must recursively call `analyze()` on the right branches. If an extension could contribute scanner logic, a buggy or malicious scanner handler could silently skip scanning a branch, creating a security bypass. There is no safe way to accept untrusted scanner logic.

**The leaf vs. branch distinction.** Not all commands are equal:

| Class | Examples | Args contain sub-programs? | Bypass risk if scanner skips |
|---|---|---|---|
| **Leaf** | `EXEC`, `SET`, `LITERAL`, `NEW` | No — args are pure data | Low — no hidden code paths |
| **Branch** | `IF`, `FOR_EACH`, `TRY`, `SANDBOX`, `F`, `MATH` | Yes | **High** — entire branches would be unscanned |

Leaf commands are theoretically safer to extend, but there is no practical motivation: any new leaf command that calls a native API is better expressed as a registry entry + `EXEC`. The extension system already supports exactly this.

**What extension authors should do instead:**

| Goal | Recommended approach |
|---|---|
| New reusable abstraction over existing capabilities | `F` in `"startup"` — already fully supported. Called as `["$myHelper", [args]]` |
| New math shorthand or formula | `MATH` in `"startup"` — compiled and sandboxed by mathjs |
| Wrap a native Node.js API with a custom interface | Registry entry + `F` wrapper in `"startup"` |
| New control-flow primitive (new loop, state machine, etc.) | **Core contribution via PR** — the only safe path |

The `F`-based approach deserves emphasis: an extension can define arbitrarily complex higher-order functions in `"startup"` that compose existing capabilities. From the script author's perspective these feel like commands. They are fully scanned, risk-gated, and quota-tracked. The only syntactic difference is the call convention (`["$myF", [...]]` instead of `["MY_F", [...]]`).

> [!NOTE]
> The claim that extensions "cannot introduce new control-flow semantics" is technically overstated. What extensions *cannot* do is add new **nejy language syntax** (new command keywords) or alter how the **interpreter dispatches steps**. However, the *runtime behavior* achievable through creative async JavaScript in registry entries is far richer. A registry entry can internally implement while-loops, retry-with-backoff, concurrent fan-out, state machines, or any other async pattern — for instance, the approach used by [`p-whilst`](https://github.com/sindresorhus/p-whilst), which implements `while (condition()) { await body() }` entirely through promise recursion. The nejy scanner sees a single `EXEC` call and does not inspect the internals of the JS implementation. Extensions can therefore provide genuinely novel async control-flow *behaviour* without touching the interpreter.

### 10.2  Other Hard Limits

| Thing | Reason |
|---|---|
| New **policy quota types** | ResourceMonitor is core infrastructure |
| Opening ports / starting servers | Prohibited by architecture; AGENTS.md |
| Overriding or wrapping core interpreter logic | Extensions augment `Mods` and inject startup steps; they cannot alter `run()` or `scan()` |

---

## 11. Technical Feasibility Summary

| Component | Complexity | New code required |
|---|---|---|
| Extension discovery (`getInstalledExtensions`) | Low | ~60 lines in `registryDiscovery.mjs` |
| `package.json` merger into registry entries | Trivial | 5 lines in `loadSetup()` |
| Startup code injection | Low | ~30 lines; modify `nejyRun()` / `nejyScan()` to prepend startup steps |
| Startup command validator (`buildStartupSteps`) | Low | ~20 lines; check each step's command against allowed list |
| `format` version check | Trivial | Already in discovery sketch above |
| `extensions` policy field + array filter | Low | ~10 lines |
| `extensionPolicy: "require-provenance"` | **Medium–High** | Requires npm provenance API calls; v2 feature |

**Total MVP estimate:** ~120–150 lines of new code, no changes to `buildMods`, `scanner`, or `commands`. Tests needed: discovery, merge, startup injection, format validation, failure modes.

---

## 12. Remaining Open Questions

> [!NOTE]
> These are lower stakes than the previous round — the major design decisions are now resolved.

1. **`"extensions": true` vs. array-only:** Should `true` (load anything with a `nejy` key) ever be allowed without provenance enforcement? Or should the MVP only permit the explicit array form, deferring `true` to when provenance checking is implemented?

2. **Startup `F` and `MATH` scan timing:** Startup is scanned as part of the combined program. But `F` and `MATH` defined in startup need to appear in `scanner.definedFunctions` so that subsequent `CHILD` commands referencing them validate correctly. Is the current forward-scan model sufficient, or does startup need a pre-pass?

3. **`process.cwd()` vs. explicit `projectRoot`:** Programs embedded in other apps may not have `node_modules` at `cwd()`. Should `nejyRun()` / `loadSetup()` accept an explicit `extensionRoot` option? Or is this always the operator's problem?

4. **Startup step ordering across multiple extensions:** If two extensions both contribute startup steps, do they merge in npm-install order, discovery (alphabetical) order, or should extensions declare explicit priority? Alphabetical (same as built-in registry files) is the safest default.

5. **Version field in built-in YAMLs:** Should `format: 1` be added to the built-in registry YAMLs now for consistency, even though they aren't loaded as extensions?
