# REQUEST
**Date:** 2026-04-22

## Overview
The `REQUEST` command declares the specific capabilities (modules, functions, or properties) that the Nejy script needs to execute. This interacts closely with Nejy's strict security scanner, acting as a manifest that must be statically verifiable before the script begins execution.

## Syntax
```yaml
- ["REQUEST", ["capability.path", "another.path"]]
```

### Parameters
1. **Capabilities** *(Array of Strings)*: An array of strings, where each string represents a dot-separated path to a global capability (e.g., `"fs.readFileSync"`, `"math.add"`).

## Usage Rules
- **Placement**: `REQUEST` must be the very first command in the script. If the scanner encounters an `EXEC` before a `REQUEST`, it will throw a `SEC_BLOCK` error.
- **Risk Levels**: The capabilities requested are checked against the script's declared `policy` (e.g., LOW, MEDIUM, HIGH, INSANE). If a requested capability exceeds the policy's maximum risk, the script is blocked.
- **Granularity**: You can request entire modules (e.g., `"math"`) or specific methods (e.g., `"child_process.execSync"`). If you only request a specific method, attempting to access other methods on that module will fail.

## Examples

**Requesting specific methods**
```yaml
- ["REQUEST", ["console.log", "child_process.execSync"]]
- ["EXEC", ["child_process.execSync", ["whoami"], "current_user"]]
- ["EXEC", ["console.log", ["Hello", "$current_user"]]]
```

**Missing REQUEST fallback**
For backwards compatibility, if a script does not include a `REQUEST` command at the top, the scanner will grant all capabilities permitted up to the current policy's `maxRisk` level by default. However, utilizing explicit `REQUEST`s is heavily recommended.
