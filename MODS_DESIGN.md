# Design: Mods Capability System

## Core Problem

Risk belongs to individual methods, not whole modules.

| Module | Low-risk methods | Higher-risk methods |
|--------|-----------------|---------------------|
| Object | keys, values, entries, assign, freeze | setPrototypeOf (HIGH), defineProperty (HIGH) |
| fs | -- | readFileSync (MEDIUM), writeFileSync/unlinkSync (HIGH) |
| Reflect | get, apply, has, ownKeys | set (MEDIUM), defineProperty/setPrototypeOf (HIGH) |
| os | hostname, uptime, platform | homedir, networkInterfaces (HIGH) |
| Buffer | from, alloc | allocUnsafe (MEDIUM) |
| child_process | -- | all HIGH; fork is INSANE |
| math (mathjs) | all expression ops | math.import (HIGH - extends scope) |

## Registry Files

Lives in config/security/registry/ as YAML files, one per module group.
These are operator-controlled and trusted (not user-supplied).

```
config/security/
  manifests/
    low-risk.json
    medium-net.json
    high-net.json
  registry/
    builtins.yaml      # Array, Object, Reflect, Buffer, Date, Map, Set, URL
    math.yaml          # mathjs (requires initialization)
    yaml-module.yaml   # yaml npm package
    console.yaml
    os.yaml
    fs.yaml
    net.yaml           # fetch, child_process
    process.yaml       # INSANE; never loaded by default
```

## Registry Entry Structure

```yaml
entries:
  - key: math           # Name used in EXEC, e.g. ["EXEC", ["math.evaluate", ...]]
    src: import         # "global" | "import"
    module: mathjs      # npm specifier; only if src=import
    risk: LOW           # default risk for any method in this namespace
    overrides:          # per-method risk in either direction
      math.import: HIGH
    setup:              # optional nejy program; runs WITHOUT scanning
      - ["EXEC", ["$MODULE.create", ["$MODULE.all"]]]
      # $LAST at end becomes Mods["math"]
```

### src: global
Reads from globalThis. No import needed. Used for Array, Map, Date, etc.

### src: import
Calls ES6 import(module) at boot. Raw result placed in $MODULE for setup.

### setup - Dogfooding the nejy Language
The setup array is a nejy program that runs without scanning (registry files
are operator-controlled). $MODULE holds the raw import. Final $LAST becomes
Mods[key]. If setup is absent, $MODULE is used directly.

## Example Registry Files

### builtins.yaml
```yaml
entries:
  - key: Array
    src: global
    risk: LOW

  - key: Object
    src: global
    risk: LOW
    overrides:
      Object.setPrototypeOf: HIGH
      Object.defineProperty: HIGH
      Object.getOwnPropertyDescriptor: MEDIUM

  - key: Reflect
    src: global
    risk: MEDIUM
    overrides:
      Reflect.get: LOW
      Reflect.apply: LOW
      Reflect.has: LOW
      Reflect.ownKeys: LOW
      Reflect.set: MEDIUM
      Reflect.defineProperty: HIGH
      Reflect.setPrototypeOf: HIGH

  - key: Buffer
    src: global
    risk: LOW
    overrides:
      Buffer.allocUnsafe: MEDIUM
      Buffer.allocUnsafeSlow: MEDIUM

  - key: Date
    src: global
    risk: LOW

  - key: Map
    src: global
    risk: LOW

  - key: Set
    src: global
    risk: LOW

  - key: URL
    src: global
    risk: LOW
```

### math.yaml
```yaml
entries:
  - key: math
    src: import
    module: mathjs
    risk: LOW
    overrides:
      math.import: HIGH
    setup:
      - ["EXEC", ["$MODULE.create", ["$MODULE.all"]]]
```

### os.yaml
```yaml
entries:
  - key: os
    src: import
    module: node:os
    risk: MEDIUM
    overrides:
      os.hostname: LOW
      os.uptime: LOW
      os.platform: LOW
      os.arch: LOW
      os.type: LOW
      os.freemem: MEDIUM
      os.totalmem: MEDIUM
      os.cpus: MEDIUM
      os.homedir: MEDIUM
      os.tmpdir: MEDIUM
      os.networkInterfaces: HIGH
      os.userInfo: HIGH
```

### fs.yaml
```yaml
entries:
  - key: fs
    src: import
    module: node:fs
    risk: HIGH
    overrides:
      fs.readFileSync: MEDIUM
      fs.readdirSync: MEDIUM
      fs.statSync: MEDIUM
      fs.existsSync: MEDIUM
      fs.writeFileSync: HIGH
      fs.appendFileSync: HIGH
      fs.unlinkSync: HIGH
      fs.rmdirSync: HIGH
      fs.mkdirSync: HIGH
      fs.chmodSync: INSANE
      fs.chownSync: INSANE
```

### net.yaml
```yaml
entries:
  - key: fetch
    src: global
    risk: MEDIUM

  - key: child_process
    src: import
    module: node:child_process
    risk: HIGH
    overrides:
      child_process.fork: INSANE

  - key: cp
    src: import
    module: node:child_process
    risk: HIGH
    overrides:
      cp.fork: INSANE
```

### process.yaml
```yaml
# Documented only. Never loaded in any default manifest.
entries:
  - key: process
    src: global
    risk: INSANE
    overrides:
      process.stdout.write: LOW
      process.stderr.write: LOW
      process.hrtime: MEDIUM
```

## Building Mods at Boot

```
For each registry file listed in the manifest:
  For each entry:
    1. Acquire $MODULE:
       - src: global -> globalThis[key root]
       - src: import -> await import(module)
    2. Run setup program without scanning (if present)
       - $MODULE is in scope; $LAST at end becomes Mods value
    3. Wrap result in a risk-enforcing Proxy
    4. Place at Mods[key]
```

## Manifest Changes

```json
{
  "maxRisk": "MEDIUM",
  "registry": ["builtins", "math", "console", "os", "fs"],
  "capabilities": [
    "math",
    "console.log",
    "os.hostname", "os.uptime",
    "fs.readFileSync"
  ]
}
```

- registry: which registry files to load
- capabilities: optional further narrowing to specific paths
- maxRisk: ceiling -- overrides registry entries that exceed it

## Runtime Proxy Enforcement

Each Mods entry is wrapped in a proxy that enforces method-level risk at runtime:

```js
function makeModProxy(obj, entry, maxLevel, riskMap) {
    return new Proxy(obj, {
        get(target, prop) {
            if (typeof prop !== 'string') return Reflect.get(target, prop);
            const fullPath = `${entry.key}.${prop}`;
            const risk = entry.overrides?.[fullPath] ?? entry.risk;
            if (riskMap[risk] > maxLevel)
                throw new Error(`SEC_BLOCK: '${fullPath}' requires ${risk} risk`);
            return Reflect.get(target, prop);
        }
    });
}
```

## Static Scanner Becomes Registry Lookup

checkPath(pathStr):
1. Exact match in any entry overrides -> return that level
2. Longest prefix match in entry keys -> return that entry risk
3. No match -> null (not callable - SEC_BLOCK)

No more hardcoded blacklist. eval, process.exit, Reflect.setPrototypeOf are
unreachable simply because they are not in the registry.

## $VARS Proxy Fix

Change:   get: (t, p) => t[p] ?? global[p]
To:       get: (t, p) => t[p] ?? Mods[p]

math.evaluate with $VARS scope can no longer reach process, eval, or
Reflect.setPrototypeOf -- they are not in Mods.

## Summary

| Concern | Approach |
|---------|----------|
| Module loading | src: global or src: import -- explicit strings |
| Module initialization | nejy setup program, $MODULE in scope, no scanning |
| Fine-grained risk | risk is namespace default; overrides adjusts per method |
| Mixed-risk modules | risk: HIGH + MEDIUM overrides (fs, os); risk: LOW + HIGH overrides (Object) |
| Runtime enforcement | Risk-checking Proxy on every Mods entry |
| Static enforcement | Scanner validates paths against registry |
| $VARS leak | Fallback from global to Mods |
| Extensibility | New modules via new registry YAML file; no code changes |
| Auditability | Registry files are plain YAML, version-controlled |
