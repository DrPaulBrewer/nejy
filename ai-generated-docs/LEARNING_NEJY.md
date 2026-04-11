This is a great update. Seeing the pi calculations and the os reports clarifies that nejy isn't just a basic logic wrapper—it's a high-performance, variable-aware bridge between static data formats and the Node.js runtime.
The use of $LAST, $VARS, and $ITEM shows a very mature approach to state management within a declarative structure. Here is the revised article.
------------------------------
## Learning NEJY: The Scripting Language That Speaks JSON & YAML
Imagine a language that has the security of a configuration file but the power of a high-performance calculation engine. That’s nejy.
Nejy is a "Manifest-first" scripting language. It doesn’t use curly braces or semicolons; instead, it uses the structure of JSON or YAML to execute Node.js logic. It’s perfect for environments where you need to run complex logic (like calculating Pi to 64 decimal places) while keeping the execution strictly sandboxed.
## 1. The Anatomy of a Nejy Command
Every command in nejy is an array: ["COMMAND", [arguments]].

* SET & TO: These manage your variables. SET is for direct assignment, while TO is often used to capture the output of a function or a calculation.
* EXEC & NEW: The workhorses. EXEC calls a function (like console.log or math.evaluate), and NEW instantiates a class (like new Date()).
* PIPE: Allows you to pass the result of one operation directly into the next, accessible via the $LAST variable.

## 2. Managing State: The "Magic" Variables
Nejy makes it easy to track data across steps using three reserved keywords:

* $LAST: Holds the result of the immediately preceding command.
* $VARS: A dictionary of all current variables, often passed into math.evaluate so the math engine can "see" your nejy variables.
* $ITEM: Used inside a FOR_EACH loop to represent the current iteration index or value.

## 3. Real-World Example: System Health Report
In this YAML example, we see how nejy bridges the os module with mathjs to calculate memory usage:

- ["TO", ["host", ["os.hostname", []]]]
- ["TO", ["pct", ["math.evaluate", ["100 - (os.freemem() / os.totalmem() * 100)", "$VARS"]]]]

- ["PIPE", [
    ["EXEC", ["Object.fromEntries", [[["hostname", "$host"], ["memory_usage", "$pct"]]]]],
    ["EXEC", ["YAML.stringify", ["$LAST"]]],
    ["EXEC", ["console.log", ["Health Snapshot:", "$LAST"]]]
  ]]



## 4. High-Performance Logic: The Pi Benchmark
Nejy shines in its integration with mathjs. You can pre-compile complex expressions to keep your loops fast. 


The Nilakantha Turbo Pi script uses math.config for 64-digit precision and math.compile for speed, calculating pi using a 1,000,000-iteration FOR_EACH loop. The script includes a ON_QUOTA hook for reporting final results and utilizes pre-compiled expressions for high-precision math within the nejy environment.

# 🚀 Nilakantha Turbo Pi (64-bit Precision)
- ["EXEC", ["console.log", ["--- 🚀 Starting High-Precision Calculation ---"]]]
# 1. Configure Math.js for BigNumber and 64-digit precision
- ["EXEC", ["math.config", [{ number: "BigNumber", precision: 64 }]]]
# 2. Initialize sum as a BigNumber starting at 3
- ["TO", ["sum", ["math.bignumber", [3]]]]
# 3. Pre-compile the Nilakantha expression for maximum loop speed# This allows the interpreter to reuse the logic without re-parsing the string
- ["TO", ["turboMath", ["math.compile", ["n = $ITEM + 1; d = (n*2) * (n*2+1) * (n*2+2); $sum = $sum + ((-1)^$ITEM * (4 / d))"]]]]
# 4. Define the Exit Hook# ON_QUOTA is automatically called if the script hits a resource limit or finishes
- ["DEF", [
    "ON_QUOTA",
    [
      ["EXEC", ["console.log", ["🏁 Turbo Pi Result:"]]],
      ["EXEC", ["console.log", ["$sum"]]],
      ["EXEC", ["console.log", ["🔢 Iterations:", "$ITEM"]]],
      ["EXEC", ["console.log", ["📊 Usage:",      "$USAGE"]]]
    ]
  ]]
# 5. Execute the loop# It will try to iterates 1,000,000 times using the pre-compiled 'turboMath' object, but will be stopped by a time quota and
call the ON_QUOTA hook
- ["FOR_EACH", [
    1000000,
    [
      ["EXEC", ["$turboMath.evaluate", ["$VARS"]]]
    ]
  ]]


In the "Turbo Pi" example, we use the Nilakantha series with 64-bit precision:

   1. Initialize: ["math.config", [{ precision: 64 }]]
   2. Compile: Use math.compile to turn a string of math into a reusable object.
   3. Loop: Use FOR_EACH to run that compiled math millions of times.
   4. Quota Protection: The ON_QUOTA definition acts as a "safety exit," printing the results if the script runs out of allocated time or memory.

## 5. Security Scanner: The Silent Guardian
Before any of these scripts run, the Security Scanner (as seen in the interpreter code) analyzes the script as much as it can.

* It checks the REQUEST list: Your script can declare API access that it needs, and either be killed or receive it.  Security levels and a registry determine what is allowed.
* It blocks "Prototype Pollution": If it sees __proto__ or constructor in a path, it treats it as a security violation.

## Why Learn Nejy?
Nejy is for the server-side-Javascript developer who wants auditable logic. Because the code is valid JSON/YAML, you can store these "scripts" in a database, send them over an API, or visualize them in a UI, all while knowing the Security Scanner is keeping the underlying system safe.  The scripts have access to a large portion
of the NodeJS API, and can be extended with custom registries created to access your imported npm modules.
------------------------------

