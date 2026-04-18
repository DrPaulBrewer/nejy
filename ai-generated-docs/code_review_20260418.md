# Code Review Findings

## Root & Example Files

### `nejy.mjs`
*   **Hardcoded paths**: `DEFAULT_REGISTRY` contains hardcoded paths (`config/security/registry/...`).
*   **Mixed URL vs path handling**: In `loadSetup`, path resolution mixes `new URL` and strings, which can lead to inconsistencies.
*   **Duplicate Usage Assignments**: In `nejyRun`, `ctx.vars["$USAGE"] = ctx.mon.usage` is duplicated in both the `try` block (success return) and `catch` block.
*   **File URL Path Usage**: The use of `__filename` and `__dirname` from `import.meta.url` is unnecessary since `pkgPath` uses `new URL` directly, reducing overall consistency.

### `monitor/index.js`
*   **Magic Strings**: `"HARD_STOP"`, `"QUOTA_EXCEEDED"`, and `"FS_QUOTA_EXCEEDED"` are hardcoded magic strings rather than exported constants.
*   **Incomplete Instrumentation**: `instrumentFs` only instruments `writeFileSync`. Other write methods (e.g., `writeFile`, `appendFile`, `createWriteStream`, promises API) are missing quotas checks.

### `examples/array-ops/calc.js`
*   **Deep Nesting / Poor Readability**: A massive one-liner with chained `.fill()`, `.map()`, and `.reduce()` is poorly readable.
*   **Magic Number**: `1000000` is a magic number without context.


## `lib/` Files

### `lib/buildMods.mjs`
*   **Duplicate logic**: Prototype pollution freezing logic is complex and repeated across `rawModule` and `instance`. It should be extracted to a helper function.
*   **Magic Number**: `4` used as an implicit `INSANE + 1` bound when calculating minimum level of explicit entries.

### `lib/interp/childCommand.mjs`
*   **Inline Scripting**: Uses string concatenation to build a complete `inlineCode` child script, making it prone to errors. It also hardcodes the policy extraction logic inside the string.
*   **Missing Reject Handle**: The promise handler inside `childCommand.mjs` has edge cases where it could hang (if the child process exits prematurely but doesn't trigger `.on('error')` or write a valid YAML block).

### `lib/interp/commands.mjs`
*   **Missing Error Message Pass**: `try { await run(tryB, ctx, em); } catch (e) { ... }` block in `TRY` doesn't pass the original error stack; it only captures the message `ctx.vars["$ERROR"] = e.message;`, potentially losing debugging information.
*   **Repeated Code**: `MATH` and `F` commands contain highly similar duplication for argument mapping and destructured parameter processing.
*   **Lack of `const`/`let` in switch block cases**: The nested scanner uses a switch block on command names, and could benefit from strict scoping for some variable declarations.

### `lib/interp/context.mjs`
*   **Code Duplication**: Prototype stripping logic is almost identical for `Object` and `Array` in `removePP` and could be simplified into a single structure or utility.

### `lib/interp/scanner.mjs`
*   **Deep Nesting**: The `analyze` switch statement has several layers of deep nesting, particularly within the `F`, `MATH` and `SANDBOX` blocks.
*   **Repeated Logic**: The parameter/prototype pollution checks in `F` and `MATH` cases are nearly identical string-checks over array loops.

### `lib/safe-jsonpath.mjs`
*   **Mutating Argument**: The `args[0]` object is directly mutated when adding `preventEval: true`, which is considered a poor practice when `args` originated externally.

### `lib/secureFetch.mjs`
*   **Performance Smell**: `new URLPattern(r.pattern)` is compiled on every request, instead of pre-compiling when rules are configured.
*   **Repeated Map/ToLower**: `rule.forbiddenHeaders` does a `.toLowerCase()` check during the loop body on every request instead of converting to a Set of lowercase headers ahead of time.


## `tests/` Files (Batch 1)

### `tests/buildMods.test.mjs`
*   **Duplicate/Boilerplate Object Setup**: The mocks for `ctx` (with `mods`, `vars`, `mon`, etc.) are duplicated across multiple test blocks rather than being instantiated from a factory function or `beforeEach` hook.

### `tests/command_f.test.mjs`
*   **Same Duplication**: Similar to `buildMods.test.mjs`, it repeatedly creates boilerplate `ctx` structures for every single test case.

### `tests/context-isolation.test.mjs`
*   **Lack of File-Local Constants**: It relies on file paths in strings instead of centrally defining them or using path resolution, tying the test strictly to the repository root execution directory.

### `tests/env-bounding.test.mjs`
*   **Stale Comments**: Comments reference testing `minRisk`, but states it was intentionally skipped because "the user stated 'no do not implement it'". Stale/conversational comments like this should be removed as they are irrelevant to the code functionality.

### `tests/helpers/run.mjs`
*   **Hackish Policy Name Resolution**: The way `policyName` is extracted `policy.split('/').pop().replace('-risk.json','').replace('-net.json','').toUpperCase()` is brittle and assumes highly specific file naming conventions for policies.
*   **Empty Catch Block**: The `try { ... } catch (_) {}` block suppresses errors during YAML parsing without logging, making it hard to debug tests if the child process returns malformed YAML.


## `tests/` Files (Batch 2)

### `tests/integration.test.mjs`
*   **Massive File/Overly Broad Responsibility**: This file likely handles the bulk of test executions across many features, running 30+ programs via loop rather than explicit test block definitions, which makes debugging single test failures complex.

### `tests/math-map-context.test.mjs`
*   **Duplicate Boilerplate**: Similar `ctx` creation duplication as seen in Batch 1.

### `tests/redteam.test.mjs`
*   **Magic Test File Loading**: Relies on specific folder structures and loops through `.yaml` / `.json` files inside `tests/redteam/` to generate test cases dynamically. This can mask failures if directories are missing or unreadable.

### `tests/request.test.mjs`
*   **Hardcoded JSON paths**: Writes out JSON files manually using `fs.writeFileSync` in test blocks instead of using mocking or temporary fixtures directories. Leaves cleanup to `fs.unlinkSync`, which may fail and leave artifacts if an assertion throws beforehand.

### `tests/sandbox/sandbox.test.mjs`
*   **Unsafe Cleanup**: Similar to `request.test.mjs`, uses `fs.unlinkSync` directly after running the program. If `runNejy` throws or the `assert` fails, the cleanup is never reached and test artifacts pollute the disk.

### `tests/security.test.mjs`
*   **File-Level Constants**: Still using string constants for manifest locations (`LOW`, `MEDIUM`, etc.) like in `context-isolation.test.mjs`.
