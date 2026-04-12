## Learning NEJY: The Scripting Language That Speaks JSON & YAML

Imagine a language that has the security of a configuration file but the power of a high-performance calculation engine. That’s nejy. By accepting scripts in JSON or YAML, it allows developers to write auditable, secure logic that can be easily stored in databases or sent over APIs.

Unlike traditional scripts that check permissions at runtime, nejy uses a Security Scanner to perform static analysis before execution begins, ensuring that code never oversteps its bounds. It bridges the gap between static data formats and the dynamic power of Node.js.

## 1. Core Syntax and Commands

Nejy scripts are built from a fixed set of commands. Every command is an array following the structure: `["COMMAND", [arguments]]`.

* **EXEC:** The workhorse for calling module functions or global built-ins. For example, `["EXEC", ["console.log", ["Hello!"]]]`.
* **SET:** Manages variables by assigning literal values or resolving argument trees directly to a variable name. e.g., `["SET", ["user_name", "Developer"]]`.
* **TO:** Manages variables by executing a block of commands and capturing the output (from `$LAST`) to a variable. e.g., `["TO", ["host", ["os.hostname", []]]]`.
* **NEW:** Instantiates a JavaScript class (e.g., `["NEW", ["Date", []]]`).
* **PIPE:** Allows chaining operations where the result of one step flows directly into the next via `$LAST`.
* **DEF & CALL:** Defining (`DEF`) and executing (`CALL`) reusable custom functions within your script.
* **IF & FOR_EACH:** Standard control flow for branching and looping.
* **IMPORT & SANDBOX:** For modularity and execution of nested programs within stricter risk constraints.
* **REQUEST:** The script's permission manifest. It must be the first command if used, declaring exactly which external paths it will touch.
* **LITERAL:** Assigns a raw JSON/YAML object directly without the interpreter attempting to evaluate variables inside it.

### How Executables and Argument Interpolation Work

In nejy, variables are dynamically resolved before a command executes. A variable is referenced by prefixing its name with `$` (e.g. `$user_name`).

When `EXEC` is called, the interpreter traverses the argument array and replaces any `$-prefixed` strings with their corresponding values from the `$VARS` dictionary.

**Single Line Example of Interpolation:**
```json
["console.log", ["Hello,", "$user_name", "!"]]
```
*(Note: If the command name isn't recognized as a strict keyword like SET or TO, nejy assumes it's shorthand for an EXEC call).*

## 2. Managing State: The "Magic" Variables
Nejy makes it easy to track data across steps using reserved variables:

* **$LAST:** Automatically holds the result of the immediately preceding command.
* **$VARS:** A dictionary of all current variables, often passed to engines like `math.evaluate` so they can access your script's state.
* **$ITEM:** Used inside a `FOR_EACH` loop to represent the current iteration index or value.
* **$USAGE:** Real-time telemetry (CPU/Memory) provided to `ON_QUOTA` handlers.

## 3. The LITERAL Command and Inline Wrappers

Because nejy naturally interpolates variables across the entire argument tree, you sometimes need to define a complex nested object that shouldn't be touched by the variable resolver—for instance, when passing a MongoDB query object where a key literally starts with `$`.

You can use the `LITERAL` command as a top-level step:

```yaml
- ["LITERAL", { "$set": { "status": "active" } }]
- ["SET", ["query", "$LAST"]]
```

Or, for more granular control, use the **inline `["LITERAL", <value>]` wrapper** directly within an `EXEC` or `SET` argument. This tells the argument resolver to immediately stop traversing and just insert the literal payload, allowing you to safely mix interpolated variables and raw literals in the same command:

```yaml
- ["EXEC", ["db.collection.update", ["$user_id", ["LITERAL", { "$set": { "status": "active" } }]]]]
```

*Note: The Security Scanner explicitly checks both top-level and inline LITERAL payloads to reject any `__proto__` or `constructor` keys, preventing prototype pollution.*

## 4. Security Scanner: The Silent Guardian
Before any script runs, the Security Scanner performs static analysis.

* **Risk Ceiling:** Nejy runs with a "Risk Ceiling" (`--policy LOW`, `MEDIUM`, `HIGH`, etc.). The Registry defines the risk "price" for Node.js modules.
  * **LOW:** Read-only logic (Math, Dates, `console.log`).
  * **MEDIUM:** External data, fetch, `os.hostname`.
  * **HIGH:** System-altering actions (`fs.writeFileSync`, `child_process`).
  * **INSANE:** System-critical/dangerous APIs (`process.exit`, `Reflect`).
* **Manifests:** Scripts declare exactly what APIs they need via `REQUEST`. If they request an API above the policy limit, execution is blocked immediately.

## 5. Real-World Example: System Health Report
In this YAML example, we see how nejy bridges the `os` module with `mathjs` to calculate memory usage. Notice how it keeps the compact YAML line-break format:

```yaml
# 🏥 System Health Report
- ["TO", ["host",    ["os.hostname", []]]]
- ["TO", ["dateObj", ["NEW", ["Date", []]]]]
- ["TO", ["utc",     ["$dateObj.toISOString", []]]]

# Using Math.max on an array
- ["SET", ["nums", [10, 50, 20]]]
- ["TO", ["maxVal", ["Math.max.apply", [null, "$nums"]]]]

- ["SET", ["entries", [["host", "$host"], ["time", "$utc"], ["max", "$maxVal"]]]]
- ["EXEC", ["Object.fromEntries", ["$entries"]]]
- ["EXEC", ["YAML.stringify",     ["$LAST"]]]
- ["EXEC", ["console.log",        ["$LAST"]]]
```

## 6. High-Performance Logic: The Pi Benchmark
Nejy shines in its integration with `mathjs`. You can pre-compile complex expressions to keep your loops fast. The Nilakantha Turbo Pi script calculates pi using a 1,000,000-iteration loop. It uses an `ON_QUOTA` hook as a "safety exit," printing the results if the script runs out of allocated time or memory.

```yaml
# pi-turbo-nilakantha.yaml
- ["EXEC", ["console.log", ["--- 🚀 Nilakantha Turbo Pi (64-bit Precision) ---"]]]

# 1. Configure Math.js for BigNumber and 64-digit precision
- ["EXEC", ["math.config", [{ number: "BigNumber", precision: 64 }]]]

# 2. Initialize sum as BigNumber 3
- ["TO", ["sum", ["math.bignumber", [3]]]]

# 3. Pre-compile the Nilakantha expression
- ["TO", ["turboMath", ["math.compile", ["n = $ITEM + 1; d = (n*2) * (n*2+1) * (n*2+2); $sum = $sum + ((-1)^$ITEM * (4 / d))"]]]]

- ["DEF", [
    "ON_QUOTA",
    [
      ["EXEC", ["console.log", ["🏁 Turbo Pi Result:"]]],
      ["EXEC", ["console.log", ["$sum"]]],
      ["EXEC", ["console.log", ["🔢 Iterations:", "$ITEM"]]],
      ["EXEC", ["console.log", ["📊 Usage:",      "$USAGE"]]]
    ]
  ]]

- ["FOR_EACH", [
    1000000,
    [
      ["EXEC", ["$turboMath.evaluate", ["$VARS"]]]
    ]
  ]]
```

## Why Learn Nejy?
Nejy provides intent-based execution. By forcing scripts to declare their needs and checking them against a granular registry, it ensures that even powerful, CPU-intensive logic remains safely contained within its sandbox. Because the code is valid JSON/YAML, you can store these "scripts" in a database, send them over an API, or visualize them in a UI, all while knowing the Security Scanner is keeping the underlying system safe.