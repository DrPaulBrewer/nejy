# JSON-Runtime Specification (V1.0)

JSON-Runtime is a secure, instrumented execution environment for logic defined in YAML, JSON, or JSON5. It provides a "hard sandbox" that bridges high-level data-driven logic with native Node.js capabilities while strictly enforcing hardware quotas and security boundaries.

## 1. Architectural Philosophy
The runtime is built on three core pillars:
1.  **Instruction over Code**: Logic is defined as data structures, making it natively parsable and scannable without execution.
2.  **Strict Namespace Isolation**: A clear boundary between user-defined variables and system-provided globals.
3.  **Deterministic Resource Control**: Every instruction is metered for CPU and Memory, with specialized hooks for I/O and Networking.

---

## 2. Program Structure
A program is an **Array of Instructions**. 
`[ ["OPCODE", [arguments]], ... ]`

### Identifier Resolution
- **`$path`**: Resolves from the internal **Variable Pool** (User data).
- **`path`**: Resolves from the **Global Whitelist** (System tools).
- **Nested Resolution**: Properties are accessed via dot notation (e.g., `$dateObj.toISOString`).

---

## 3. Reserved Variables
The following variables are managed by the runtime and have special meaning within the execution context:


| Variable | Description |
| :--- | :--- |
| **`$LAST`** | Stores the return value of the most recent `EXEC`, `NEW`, or `RETURN` instruction. |
| **`$ITEM`** | Stores the current element (or index) during a `FOR_EACH` loop iteration. |
| **`$INPUT`** | Stores the data passed into a function block via the `CALL` instruction. |
| **`$ERROR`** | Stores the error message string when an exception is caught within a `TRY` block. |
| **`$USAGE`** | A telemetry object containing final CPU, Memory, and I/O metrics (injected during `ON_QUOTA`). |
| **`$VARS`** | A special identifier used as an argument in `EXEC` to provide a **Live Proxy Scope** to third-party engines. |

---

## 4. Instruction Set (Keywords)


| Keyword | Arguments | Result ($LAST) | Description |
| :--- | :--- | :--- | :--- |
| **EXEC** | `[target, args]` | Return Value | Resolves `target` (Path) and applies `args`. Injects `$VARS` as a live scope if requested. |
| **PIPE** | `[init, ...steps]`| Final Result | Fluent chaining. Result of step $n$ is passed as the first argument to step $n+1$. |
| **NEW** | `[target, args]` | Instance | Instantiates a whitelisted constructor (e.g., `Date`, `Map`) via `Reflect.construct`. |
| **SET** | `[name, value]` | Value | Assigns `value` to `$name`. Recursively resolves variables within objects/arrays. |
| **FOR_EACH** | `[limit, [steps]]`| Null | Iterates over an integer or array. Current value stored in `$ITEM`. |
| **IF** | `[cond, [T], [F]]` | Branch Result | Conditional branching. `cond` can be a literal, variable, or instruction array. |
| **DEF** | `[name, [steps]]`| Null | Registers a reusable sub-program (function) in the internal registry. |
| **CALL** | `[name, input]` | Sub-Result | Executes a `DEF` block. Maps `input` to `$INPUT` and restores context on completion. |
| **RETURN** | `[value]` | Value | Terminates current function and returns `value` to the caller via a `RETURN_SIGNAL`. |
| **TRY** | `[[T], [C]]` | Null | Exception handling. Error messages are stored in `$ERROR`. |
| **SAVE_STATE** | `[path]` | Null | Serializes all non-functional variables in the pool to a YAML file. |
| **RESTORE_STATE**| `[path]` | Null | Merges a YAML state file back into the live variable pool. |

---

## 5. The Manifest (Security & Quotas)

The `manifest.yaml` defines the execution contract.

### Schema
```yaml
maxRisk: "LOW" | "MEDIUM" | "HIGH" | "INSANE"
quotas:
  maxCpuMs: integer      # Cumulative CPU time (User + System).
  maxMemoryMb: integer   # RSS memory limit.
  maxFsBytes: integer    # Cumulative write limit.
  fetchRules:            # URLPattern-compatible allow-list.
    - pattern: { hostname: "://example.com" }
      methods: ["GET", "POST"]
      forbiddenHeaders: ["Cookie", "Authorization"]
      forcedHeaders: { "User-Agent": "SecureRuntime/1.0" }
