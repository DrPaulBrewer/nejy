# Nejy Language: Future Work & Design Resolutions

This document revises past structural criticisms of the `nejy` language and proposes future enhancements. By leveraging upcoming isolation features (like Stage 7's `SANDBOX`) and revisiting input/output mechanisms, many perceived "flaws" in the current design can be elegantly resolved without abandoning `nejy`'s minimalist, capability-driven core.

## 1. Resolving the Local Scope Problem

**The Problem:** `ctx.vars` is fully global. A `CALL` to a library function can silently overwrite variables in the calling scope, making code composition risky. 

**The Solution (Stage 7 / Stage 8):**
Stage 7 introduces the `SANDBOX` command, designed for capability reduction and state isolation. Specifically, `SANDBOX` clones variables inward but blocks outward mutation (except for `$RETURN` becoming `$LAST`). 
* **Stage 8 Implementation:** We can integrate `SANDBOX` mechanics directly into `CALL` and `IMPORT`. If `CALL` implicitly wraps its execution in a `SANDBOX`-like context clone, functions gain proper local scope. They can safely use temporary variables without side-effecting the parent context, fully resolving Criticism #1.

## 2. Standardizing the Input/Output Interface

**The Problem:** Currently, functions and pipelines rely almost exclusively on the single `$INPUT` parameter or stateful mutations of `$LAST`. It is difficult to pass multiple distinct arguments to a function or process without heavy data preparation.

**The Solution:**
Extend the program bootloader and function invocation to support standardized parameter lists.
* **CLI/Network Inputs:** If a program is invoked with external arguments, parse them from `stdin` or args into a native `$ARGS` array (e.g., `["param0", "param1"]`).
* **Function Signatures:** Extend `CALL` to accept argument arrays. Instead of just setting `$INPUT`, it sets `$ARGS`. 
* **Output Standard:** Since all `nejy` executions currently yield `[error, result, usage]`, a native `RETURN` command (detailed below) can populate the middle `result` block definitively. Function calls natively extract this result out of the sandbox.

## 3. Emulating Native Operations via Functional Sub-programs

**The Problem:** The lack of native arithmetic operators or string manipulation makes basic language tasks verbose, leaning heavily on the `math` module. 

**The Solution:**
While we don't necessarily need to add dedicated binary operators, we can introduce powerful list-processing operations by exposing native JavaScript higher-order functions like `Array.map`, `Array.reduce`, and `Array.filter`.
* **Execution via Closure:** By adding these array commands to `KNOWN_COMMANDS` (or a built-in baseline registry), `nejy` can accept "local functions" (a `DEF` name or an inline step array) as their callback. 
* *Example:* `["EXEC", ["Array.map", ["$myList", "processItem"]]]`
* This drastically cuts down the need for manual `FOR_EACH` loops and external condition evaluation, embracing a functional data-pipeline approach cleanly bounded by `nejy` semantics.

## 4. Control Flow Commands (`RETURN`, `THROW`, `BREAK`)

**The Problem:** `nejy` cannot easily short-circuit logic. A loop must process all iterations; a function must evaluate all its remaining `IF` blocks. Additionally, there's no way to trigger a custom error for a `TRY` block.

**The Solution:**
The underlying runner in `main.mjs` already possesses the mechanical hooks to support this (`err.type === "RETURN_SIGNAL"`). We simply need to expose the language keywords:
* **`RETURN`**: Immediately aborts the current block and pushes its argument to `$RETURN` (and subsequently `$LAST` in the parent).
* **`THROW`**: Evaluates its argument and triggers a managed native JS error, immediately transferring control to the nearest `TRY/CATCH` block.
* **`BREAK` / `CONTINUE`**: Essential for robust `FOR_EACH` handling, implemented by catching distinct semantic error signals during the execution loop.

## 5. CLI vs BROWSER Architecture

**The Problem:** `nejy` is currently strictly bound to the Node.js CLI runtime (`node:fs`, `node:os`, `node:child_process`). However, its JSON/YAML execution model and sandboxing capabilities make it an incredibly strong candidate for running safely inside web browsers.

**The Solution:**
The core interpreter (`main.mjs`) already perfectly abstracts capabilities through the `Mods` registry. To run `nejy` in the browser, the runner logic remains identical, but the *Capability Registry* adapts:
* **Missing Node APIs:** Modules like `fs` and `child_process` are naturally unavailable and remain blocked or mocked in the browser's registry policies.
* **Module Loading:** Instead of `require()` or Node ESM resolutions, browser registries can depend on previously bundled modules via build tools (Webpack/Vite), or resolve dynamic runtime capabilities using DOM-inserted `<script>` tags and native browser `import()` calls.

**Potential Browser Applications:**
1. **User-Generated Macros & Plugins:** Safely executing user-provided automation scripts without fear of them accessing sensitive DOM elements or localStorage keys, as the browser-manifest strictly dictates accessible `Mods`.
2. **Declarative UI Pipelines:** Using `nejy`'s `PIPE` and `TO` functional chains to process complex incoming WebSocket or DOM events entirely dynamically via configuration files fetched remotely.
3. **Isomorphic Workloads:** Writing a `nejy` data-processing library that runs unaltered on both the CLI backend and the Browser frontend, relying purely on universally available `Mods` (like `math` or basic `fetch`).

## Conclusion
By treating Execution contexts as immutable downstream scopes (via Sandboxing), generalizing inputs (`$ARGS`), embracing Array-functional abstractions (`map`, `reduce`), wiring up basic control-flow interrupt commands, and planning for Node/Browser runtime decoupling, `nejy` transitions from a rigid script-runner into a highly expressive, isolated capability platform.
