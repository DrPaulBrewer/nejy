## Learning NEJY: The Scripting Language That Speaks JSON & YAML
Nejy is a declarative scripting language designed to bridge the gap between static data formats and the dynamic power of Node.js. By accepting scripts in [JSON](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/JSON) or [YAML](https://yaml.org/spec/1.2.2/), it allows developers to write auditable, secure logic that can be easily stored in databases or sent over APIs.
Unlike traditional scripts that check permissions at runtime, Nejy uses a Security Scanner to perform static analysis before execution begins, ensuring that code never oversteps its bounds.
------------------------------
## 1. Core Syntax and Commands
Nejy scripts are built from a fixed set of 12 commands. Every command is an array following the structure: ["COMMAND", [arguments]].

* SET & TO: Manage variables. Use SET for direct values and TO for capturing function outputs.
* EXEC & NEW: The workhorses for calling functions and instantiating classes (e.g., new Date()).
* PIPE: Chaining operations where the result of one step flows into the next.
* F: Defining and executing reusable functions.
* IF & FOR_EACH: Standard control flow for branching and looping.
* REQUEST: The script's permission manifest, declaring exactly which external paths it will touch.

------------------------------
## 2. Variable Management: The Magic of $
In Nejy, variables are "referenced" by prefixing their names with $.

* Reference: Use ["EXEC", ["console.log", ["$user_name"]]] to print a stored value.
* Reserved Variables:
* $LAST: Automatically holds the result of the previous command.
   * $VARS: A dictionary of all current variables, often passed to math.evaluate.
   * $ITEM: The current value or index during a FOR_EACH loop.
   * $USAGE: Real-time telemetry (CPU/Memory) provided to ON_QUOTA handlers.

------------------------------
## 3. The Security Engine: Risk Levels and Registry
Nejy runs with a "Risk Ceiling" set via --policy [LEVEL]. The Registry—a collection of YAML files—defines the risk "price" for every Node.js module and global function.

* LOW: Read-only, stateless actions like Math, Date, or console.log.
* MEDIUM: Access to external data, anonymous fetch (GET), and potentially blocking APIs like RegExp.
* HIGH: Environment-altering actions like fs.writeFileSync, fs.rmSync, or authorized shell commands via child_process.
* INSANE: System-critical calls that are typically blocked to prevent prototype pollution or privilege escalation, such as process.exit, fs.chmodSync, or Reflect.

## Security Quick Reference

| Category | Action | Risk Level |
|---|---|---|
| Logic | Math, Strings, Dates | LOW |
| System Info | os.hostname, os.freemem | MEDIUM |
| Read/Write | fs.readFileSync / fs.writeFileSync | MEDIUM / HIGH |
| Execution | child_process.execSync | HIGH |
| Privilege | fs.chmodSync, process.exit | INSANE |

------------------------------
## 4. High-Performance Example: Calculating Pi
This script demonstrates high-precision math using math.config (64-digit precision) and math.compile for loop efficiency.

# pi-turbo-nilakantha.yaml
- ["EXEC", ["console.log", ["--- 🚀 Nilakantha Turbo Pi (64-bit Precision) ---"]]]
# 1. Configure Math.js for BigNumber and 64-digit precision
- ["EXEC", ["math.config", [{ number: "BigNumber", precision: 64 }]]]
# 2. Initialize sum as BigNumber 3
- ["TO", ["sum", ["math.bignumber", [3]]]]
# 3. Pre-compile the Nilakantha expression for speed
- ["TO", ["turboMath", ["math.compile", ["n = $ITEM + 1; d = (n*2) * (n*2+1) * (n*2+2); $sum = $sum + ((-1)^$ITEM * (4 / d))"]]]]
# 4. Define an exit handler to report results if resources run out
- ["F", [
    "ON_QUOTA",
    ["USAGE", "&VARS"],
    [
      ["EXEC", ["console.log", ["🏁 Turbo Pi Result:"]]],
      ["EXEC", ["console.log", ["$sum"]]],
      ["EXEC", ["console.log", ["📊 Final Usage:", "$USAGE"]]]
    ]
  ]]
# 5. Run the high-speed loop
- ["FOR_EACH", [
    1000000,
    [
      ["EXEC", ["$turboMath.evaluate", ["$VARS"]]]
    ]
  ]]

## Why Nejy?
Nejy provides intent-based execution. By forcing scripts to declare their needs and checking them against a granular registry, it ensures that even powerful, CPU-intensive logic remains safely contained within its sandbox.
To get started, try running your first script with the --policy LOW flag and watch how the Security Scanner protects your system.
How would you like to proceed? We can explore creating custom registry entries for your specific Node.js modules or dive into advanced PIPE workflows.

