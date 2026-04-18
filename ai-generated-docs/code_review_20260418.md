# Code Review Findings

## Summary Discussion

A comprehensive review of the `nejy` JavaScript and ES Module source code has been conducted. The codebase exhibits a strong foundation, particularly in its security-focused architecture. However, several areas for improvement have been identified across the root files, the `lib/` directory, and the `tests/` directory.

The most prominent categories of code smells include:

1.  **Code Duplication (DRY Violations):** This is particularly noticeable in test files where context setup boilerplate is repeated extensively. It also appears in core logic, such as the `MATH` and `F` command handlers, and prototype pollution sanitization routines.
2.  **Hardcoded Values & Magic Strings/Numbers:** Several instances of hardcoded paths, magic numbers (e.g., implicit bounds), and magic strings (e.g., error constants) were found. These reduce maintainability and increase the risk of errors during future changes.
3.  **Error Handling & Edge Cases:** Some error handling blocks suppress original error stacks or lack proper catch mechanisms (e.g., in promise chains or process spawning), which can hinder debugging.
4.  **Performance Inefficiencies:** Certain operations, like compiling `URLPattern` or mapping arrays to lowercase strings, are performed per-request rather than pre-compiled or hoisted, impacting execution speed.
5.  **Test Suite Hygiene:** The test suite relies on brittle pathing, hardcoded constants, and unsafe cleanup methods (e.g., missing `try...finally` around `fs.unlinkSync`), which can lead to flaky tests or environment pollution on failures.

## Code Smell Categories

| Category | Description | Count |
| :--- | :--- | :--- |
| **Maintainability** | Hardcoded values, magic strings/numbers, complex logic | 8 |
| **Duplication** | Repeated code blocks, boilerplate setup | 7 |
| **Reliability/Testing** | Brittle test paths, unsafe cleanup, swallowed errors | 12 |
| **Performance** | Inefficient per-request operations | 2 |
| **Readability** | Deep nesting, large one-liners, stale comments | 3 |
| **Total** | | **32** |

---

## Detailed Findings

### Root & Example Files

#### `nejy.mjs`
1.  **(Maintainability) Hardcoded paths**: `DEFAULT_REGISTRY` contains hardcoded paths (`config/security/registry/...`).
2.  **(Maintainability) Mixed URL vs path handling**: In `loadSetup`, path resolution mixes `new URL` and strings, which can lead to inconsistencies.
3.  **(Duplication) Duplicate Usage Assignments**: In `nejyRun`, `ctx.vars["$USAGE"] = ctx.mon.usage` is duplicated in both the `try` block (success return) and `catch` block.
4.  **(Maintainability) File URL Path Usage**: The use of `__filename` and `__dirname` from `import.meta.url` is unnecessary since `pkgPath` uses `new URL` directly, reducing overall consistency.

#### `monitor/index.js`
5.  **(Maintainability) Magic Strings**: `"HARD_STOP"`, `"QUOTA_EXCEEDED"`, and `"FS_QUOTA_EXCEEDED"` are hardcoded magic strings rather than exported constants.
6.  **(Reliability) Incomplete Instrumentation**: `instrumentFs` only instruments `writeFileSync`. Other write methods (e.g., `writeFile`, `appendFile`, `createWriteStream`, promises API) are missing quotas checks.

#### `examples/array-ops/calc.js`
7.  **(Readability) Deep Nesting / Poor Readability**: A massive one-liner with chained `.fill()`, `.map()`, and `.reduce()` is poorly readable.
8.  **(Maintainability) Magic Number**: `1000000` is a magic number without context.

### `lib/` Files

#### `lib/buildMods.mjs`
9.  **(Duplication) Duplicate logic**: Prototype pollution freezing logic is complex and repeated across `rawModule` and `instance`. It should be extracted to a helper function.
10. **(Maintainability) Magic Number**: `4` used as an implicit `INSANE + 1` bound when calculating minimum level of explicit entries.

#### `lib/interp/childCommand.mjs`
11. **(Reliability) Inline Scripting**: Uses string concatenation to build a complete `inlineCode` child script, making it prone to errors. It also hardcodes the policy extraction logic inside the string.
12. **(Reliability) Missing Reject Handle**: The promise handler inside `childCommand.mjs` has edge cases where it could hang (if the child process exits prematurely but doesn't trigger `.on('error')` or write a valid YAML block).

#### `lib/interp/commands.mjs`
13. **(Reliability) Missing Error Message Pass**: `try { await run(tryB, ctx, em); } catch (e) { ... }` block in `TRY` doesn't pass the original error stack; it only captures the message `ctx.vars["$ERROR"] = e.message;`, potentially losing debugging information.
14. **(Duplication) Repeated Code**: `MATH` and `F` commands contain highly similar duplication for argument mapping and destructured parameter processing.
15. **(Maintainability) Lack of `const`/`let` in switch block cases**: The nested scanner uses a switch block on command names, and could benefit from strict scoping for some variable declarations.

#### `lib/interp/context.mjs`
16. **(Duplication) Code Duplication**: Prototype stripping logic is almost identical for `Object` and `Array` in `removePP` and could be simplified into a single structure or utility.

#### `lib/interp/scanner.mjs`
17. **(Readability) Deep Nesting**: The `analyze` switch statement has several layers of deep nesting, particularly within the `F`, `MATH` and `SANDBOX` blocks.
18. **(Duplication) Repeated Logic**: The parameter/prototype pollution checks in `F` and `MATH` cases are nearly identical string-checks over array loops.

#### `lib/safe-jsonpath.mjs`
19. **(Maintainability) Mutating Argument**: The `args[0]` object is directly mutated when adding `preventEval: true`, which is considered a poor practice when `args` originated externally.

#### `lib/secureFetch.mjs`
20. **(Performance) Performance Smell**: `new URLPattern(r.pattern)` is compiled on every request, instead of pre-compiling when rules are configured.
21. **(Performance) Repeated Map/ToLower**: `rule.forbiddenHeaders` does a `.toLowerCase()` check during the loop body on every request instead of converting to a Set of lowercase headers ahead of time.

### `tests/` Files

#### `tests/buildMods.test.mjs`
22. **(Duplication) Duplicate/Boilerplate Object Setup**: The mocks for `ctx` (with `mods`, `vars`, `mon`, etc.) are duplicated across multiple test blocks rather than being instantiated from a factory function or `beforeEach` hook.

#### `tests/command_f.test.mjs`
23. **(Duplication) Same Duplication**: Similar to `buildMods.test.mjs`, it repeatedly creates boilerplate `ctx` structures for every single test case.

#### `tests/context-isolation.test.mjs`
24. **(Reliability) Lack of File-Local Constants**: It relies on file paths in strings instead of centrally defining them or using path resolution, tying the test strictly to the repository root execution directory.

#### `tests/env-bounding.test.mjs`
25. **(Readability) Stale Comments**: Comments reference testing `minRisk`, but states it was intentionally skipped because "the user stated 'no do not implement it'". Stale/conversational comments like this should be removed as they are irrelevant to the code functionality.

#### `tests/helpers/run.mjs`
26. **(Reliability) Hackish Policy Name Resolution**: The way `policyName` is extracted `policy.split('/').pop().replace('-risk.json','').replace('-net.json','').toUpperCase()` is brittle and assumes highly specific file naming conventions for policies.
27. **(Reliability) Empty Catch Block**: The `try { ... } catch (_) {}` block suppresses errors during YAML parsing without logging, making it hard to debug tests if the child process returns malformed YAML.

#### `tests/integration.test.mjs`
28. **(Reliability) Massive File/Overly Broad Responsibility**: This file likely handles the bulk of test executions across many features, running 30+ programs via loop rather than explicit test block definitions, which makes debugging single test failures complex.

#### `tests/redteam.test.mjs`
29. **(Reliability) Magic Test File Loading**: Relies on specific folder structures and loops through `.yaml` / `.json` files inside `tests/redteam/` to generate test cases dynamically. This can mask failures if directories are missing or unreadable.

#### `tests/request.test.mjs`
30. **(Reliability) Hardcoded JSON paths**: Writes out JSON files manually using `fs.writeFileSync` in test blocks instead of using mocking or temporary fixtures directories. Leaves cleanup to `fs.unlinkSync`, which may fail and leave artifacts if an assertion throws beforehand.

#### `tests/sandbox/sandbox.test.mjs`
31. **(Reliability) Unsafe Cleanup**: Similar to `request.test.mjs`, uses `fs.unlinkSync` directly after running the program. If `runNejy` throws or the `assert` fails, the cleanup is never reached and test artifacts pollute the disk.

#### `tests/security.test.mjs`
32. **(Reliability) File-Level Constants**: Still using string constants for manifest locations (`LOW`, `MEDIUM`, etc.) like in `context-isolation.test.mjs`.
