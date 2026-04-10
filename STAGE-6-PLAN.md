# Stage 6: From Manifests to Policies

This document explores revising Stage 6 based on your realization that "manifests" as currently implemented contain unenforced legacy bulk and represent an architectural weakness if they remain user-provided files.

## 1. Retiring the "Manifest"; Introducing "Policy"

**The Vulnerability of Manifests:** 
Currently, the CLI signature is `node main.mjs program.yaml manifest.json`. This implies the *program execution* defines its own security constraints if an operator uses a bundled manifest. Furthermore, manifests actively contain legacy properties (`allowData`, `allowCalls`, `allowImports`) that `main.mjs` simply ignores.

**The Solution:**
We replace arbitrary `manifest.json` files with fixed, platform-level **Policy Files**. 
There will be strictly three/four configuration files managed by the platform administrator:
- `config/security/policies/low.json`
- `config/security/policies/medium.json`
- `config/security/policies/high.json`

**New Invocation:**
The CLI signature drops the file path entirely.
```bash
node main.mjs program.yaml --policy=MEDIUM
# Alternately:
NEJY_POLICY=LOW node main.mjs program.yaml
```
The system will automatically load `./config/security/policies/medium.json`. This shifts risk enforcement entirely into the hands of the environment/operator, completely untrusting the program being executed.

## 2. Policy File Structure

The new `[policy].json` files should be ruthlessly minimal containing ONLY actionable parameters.

```json
{
  "maxRisk": "MEDIUM",
  "quotas": {
    "maxCpuMs": 2000,
    "maxMemoryMb": 512,
    "maxFsBytes": 102400
  }
}
```
*Note: `minRisk` is no longer needed in the policy file, because by definition `medium.json` enforces exactly `MEDIUM` constraints.*

## 3. Decentralizing `fetchRules` into the Registry

**The Problem:**
Currently, `fetchRules` are passed via the manifest and enforced by `monitor/index.js` (which overwrites `fetch`). Furthermore, `main.mjs:Scanner` has hardcoded logic specifically checking if `fetch` is using `POST`/`PUT` and manually escalating the risk to `HIGH`. 
Hardcoding module-specific logic in the core interpreter violates the goal of the registry system.

**The Solution:**
We can eliminate `fetchRules` entirely from policies/manifests and remove the `fetch` edge-cases from `monitor` and `main.mjs`. Instead, we implement this in `config/security/registry/60-net.yaml`.

The registry format natively supports a `setup` program array. We can use it to build a secure `fetch` proxy wrapper directly in `nejy`'s registry build step, or load a dedicated wrapper file:

```yaml
# config/security/registry/60-net.yaml
entries:
  - key: fetch
    src: import
    module: ./lib/secureFetch.mjs   # A module that exports a safe wrapper around global fetch
    risk: LOW
    methods:
      fetch.GET: MEDIUM
      fetch.POST: HIGH
```

By pushing `fetch` behavior out of the `ResourceMonitor` and back into a registry-loaded wrapper, `monitor/index.js` can focus purely on hardware limits (CPU, RAM, FS Bytes), drastically simplifying the core interpreter stack.

## Summary of Action Items for Stage 6
1. Delete `config/security/manifests/*`.
2. Create `config/security/policies/{low,medium,high}.json` strictly with `maxRisk` and `quotas`.
3. Update `main.mjs` CLI parsing to use `--policy` (or `NEJY_POLICY`) and auto-load the correct policy file.
4. Remove `fetchRules` logic from `monitor/index.js`.
5. Remove `fetch`-specific POST/GET risk logic from `main.mjs:Scanner.analyze`.
6. Implement a new `lib/secureFetch.mjs` wrapper, controlled internally by `60-net.yaml`.

## 4. Upgrading CLI Processing (Subcommands & Options)

As the interpreter graduates to Stage 6, passing raw files (`process.argv[2]`, `process.argv[3]`) becomes brittle. We need structured `--options` (like `--policy=MEDIUM`) and subcommands.

We will adopt **`commander.js`** (`npm:commander`) as our CLI parsing framework. Commander is the industry gold standard for Node.js, providing robust Git-style subcommands, strictly typed flag parsing, and automatic `--help` generated menus.

### Proposed CLI Subcommand Architecture
Adopting `commander` allows us to break `main.mjs`'s monolithic boot sequence into semantic subcommands:

1. **`nejy run <program> [--policy=LOW]`**
   * Executes the script. Instantiates the runtime, loads the strict policy from `/config`, and triggers the `SecurityScanner` before running.
2. **`nejy scan <program> [--policy=LOW]`**
   * Analyzes the file and safely dry-runs the `SecurityScanner`. Immediately exits 0 if the `REQUEST` block passes, or exits 1 with the `SEC_BLOCK` error. Does *not* execute code. Fantastic for CI/CD checks before running untrusted libraries.
3. **`nejy static`**
   * Attempts to list minimal capabilities of the system.

### Additional Action Items
7. Add `commander` to `package.json` dependencies.
8. Refactor `boot()` into a CLI router executing `run` and `scan` handlers based on `commander` input.
