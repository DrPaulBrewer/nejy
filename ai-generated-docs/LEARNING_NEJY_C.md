## Learning NEJY: The Scripting Language That Speaks JSON & YAML

Imagine a language that has the security of a configuration file but the power of a high-performance calculation engine. That’s nejy. By accepting scripts in JSON or YAML, it allows developers to write auditable, secure logic that can be easily stored in databases or sent over APIs.

Unlike traditional scripts that check permissions at runtime, nejy uses a Security Scanner to perform static analysis before execution begins, ensuring that code never oversteps its bounds. It bridges the gap between static data formats and the dynamic power of Node.js.

## 1. Core Syntax and Commands
Nejy scripts are built from a fixed set of commands. Every command is an array following the structure: `["COMMAND", [arguments]]`.

* **SET & TO:** Manage variables. Use `SET` for assigning literal values directly, and `TO` for capturing function outputs or calculations.
* **LITERAL:** Assigns a raw JSON/YAML object, array, or string directly without the interpreter attempting to evaluate variables inside it. Useful for safely injecting deeply-nested objects (like database queries).
* **EXEC & NEW:** The workhorses for calling functions (e.g., `console.log`) and instantiating classes (e.g., `new Date()`).
* **PIPE:** Allows chaining operations where the result of one step flows directly into the next.
* **F:** Defining and executing reusable functions.
* **IF & FOR_EACH:** Standard control flow for branching and looping.
* **REQUEST:** The script's permission manifest, declaring exactly which external paths it will touch.

## 2. Managing State: The "Magic" Variables
Nejy makes it easy to track data across steps using reserved variables (referenced with a `$` prefix):

* **$LAST:** Automatically holds the result of the immediately preceding command.
* **$VARS:** A dictionary of all current variables, often passed to engines like `math.evaluate` so they can access your script's state.
* **$ITEM:** Used inside a `FOR_EACH` loop to represent the current iteration index or value.
* **$USAGE:** Real-time telemetry (CPU/Memory) provided to `ON_QUOTA` handlers.

## 3. The LITERAL Command and Inline Wrappers
Because nejy naturally interpolates variables (like `$user_id`), you sometimes need to define a complex object that shouldn't be touched—for instance, when passing a query object to a database.

You can use the `LITERAL` command as a top-level step:

```yaml
- [ "LITERAL", { "$set": { "status": "active" } } ]
- [ "SET", [ "query", "$LAST" ] ]
```

Or, for more granular control, use the **inline `["LITERAL", <value>]` wrapper** directly within an `EXEC` or `SET` argument. This allows you to mix interpolated variables and raw literals in the same command:

```yaml
- [
    "EXEC",
    [
      "db.collection.update",
      [
        "$user_id",
        [
          "LITERAL",
          {
            "$set": {
              "status": "active"
            }
          }
        ]
      ]
    ]
  ]
```

## 4. Security Scanner: The Silent Guardian
Before any script runs, the Security Scanner performs static analysis.

* **Risk Ceiling:** Nejy runs with a "Risk Ceiling" (`--policy LOW`, `MEDIUM`, `HIGH`, etc.). The Registry defines the risk "price" for Node.js modules.
  * **LOW:** Read-only logic (Math, Dates, `console.log`).
  * **MEDIUM:** External data, fetch, `os.hostname`.
  * **HIGH:** System-altering actions (`fs.writeFileSync`, `child_process`).
  * **INSANE:** System-critical/dangerous APIs (`process.exit`, `Reflect`).
* **Manifests:** Scripts declare exactly what APIs they need via `REQUEST`. If they request an API above the policy limit, execution is blocked immediately.
* **Prototype Pollution Protection:** To ensure dynamic data injected via `LITERAL` is safe, the scanner explicitly rejects objects containing `__proto__` or `constructor` properties.

## 5. Real-World Example: System Health Report
In this YAML example, we see how nejy bridges the `os` module with `mathjs` to calculate memory usage:

```yaml
- [
    "TO",
    [
      "host",
      [
        "os.hostname",
        []
      ]
    ]
  ]
- [
    "TO",
    [
      "pct",
      [
        "math.evaluate",
        [
          "100 - (os.freemem() / os.totalmem() * 100)",
          "$VARS"
        ]
      ]
    ]
  ]
- [
    "PIPE",
    [
      [
        "EXEC",
        [
          "Object.fromEntries",
          [
            [
              [
                "hostname",
                "$host"
              ],
              [
                "memory_usage",
                "$pct"
              ]
            ]
          ]
        ]
      ],
      [
        "EXEC",
        [
          "YAML.stringify",
          [
            "$LAST"
          ]
        ]
      ],
      [
        "EXEC",
        [
          "console.log",
          [
            "Health Snapshot:",
            "$LAST"
          ]
        ]
      ]
    ]
  ]
```

## 6. High-Performance Logic: The Pi Benchmark
Nejy shines in its integration with `mathjs`. You can pre-compile complex expressions to keep your loops fast. The Nilakantha Turbo Pi script calculates pi using a 1,000,000-iteration loop. It uses an `ON_QUOTA` hook as a "safety exit," printing the results if the script runs out of allocated time or memory.

```yaml
- [
    "EXEC",
    [
      "console.log",
      [
        "--- 🚀 Starting High-Precision Calculation ---"
      ]
    ]
  ]
- [
    "EXEC",
    [
      "math.config",
      [
        {
          "number": "BigNumber",
          "precision": 64
        }
      ]
    ]
  ]
- [
    "TO",
    [
      "sum",
      [
        "math.bignumber",
        [
          3
        ]
      ]
    ]
  ]
- [
    "TO",
    [
      "turboMath",
      [
        "math.compile",
        [
          "n = $ITEM + 1; d = (n*2) * (n*2+1) * (n*2+2); $sum = $sum + ((-1)^$ITEM * (4 / d))"
        ]
      ]
    ]
  ]
- [
    "F",
    [
      "ON_QUOTA",
    ["USAGE", "&VARS"],
      [
        [
          "EXEC",
          [
            "console.log",
            [
              "🏁 Turbo Pi Result:"
            ]
          ]
        ],
        [
          "EXEC",
          [
            "console.log",
            [
              "$sum"
            ]
          ]
        ],
        [
          "EXEC",
          [
            "console.log",
            [
              "🔢 Iterations:",
              "$ITEM"
            ]
          ]
        ],
        [
          "EXEC",
          [
            "console.log",
            [
              "📊 Usage:",
              "$USAGE"
            ]
          ]
        ]
      ]
    ]
  ]
- [
    "FOR_EACH",
    [
      1000000,
      [
        [
          "EXEC",
          [
            "$turboMath.evaluate",
            [
              "$VARS"
            ]
          ]
        ]
      ]
    ]
  ]
```

## Why Learn Nejy?
Nejy provides intent-based execution. By forcing scripts to declare their needs and checking them against a granular registry, it ensures that even powerful, CPU-intensive logic remains safely contained within its sandbox. Because the code is valid JSON/YAML, you can store these "scripts" in a database, send them over an API, or visualize them in a UI, all while knowing the Security Scanner is keeping the underlying system safe.