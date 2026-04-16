# The `F` Command: Creating Reusable Functions in Nejy

Welcome to the guide on the `F` command! If you are writing a long nejy script, you might find yourself repeating the same steps over and over. The `F` command is your tool to solve this by creating **Functions**. A function is simply a mini-program that you can define once and use (or "execute") as many times as you need.

## 1. What is the `F` Command?

The `F` command allows you to define an isolated block of nejy steps. Think of it like a recipe. You write the recipe once, and then you can cook it whenever you want.

The `F` command takes three parts inside its array:
1.  **The Name:** What you want to call your function.
2.  **The Arguments (Inputs):** A list of variable names that the function expects to receive when it is called.
3.  **The Steps (Body):** The actual nejy commands that run when the function is called.

**Basic Syntax:**
```json
["F", [
  "FunctionName",
  ["arg1", "arg2"],
  [
    ["EXEC", ["console.log", ["$arg1"]]]
  ]
]]
```

---

## 2. Your First Function

Let's look at a very simple program that defines a function to greet a user and then runs it.

```json
[
  ["F", [
    "GreetUser",
    ["username"],
    [
      ["EXEC", ["console.log", ["Hello,", "$username", "! Welcome to the secure sandbox."]]]
    ]
  ]],
  ["EXEC", ["$GreetUser", ["Alice"]]],
  ["EXEC", ["$GreetUser", ["Bob"]]]
]
```

### How to execute (call) your function:
Notice that to run the function, we use the `EXEC` command, and we refer to our function name with a `$` prefix (`$GreetUser`). The second part of the `EXEC` array contains the actual values we want to pass in (e.g., `"Alice"`).

---

## 3. Returning Values

Sometimes, you want a function to do some math or formatting and give a result back to the main script. To do this, you just need to set the special `$RETURN` variable inside your function.

```json
[
  ["F", [
    "AddNumbers",
    ["a", "b"],
    [
      ["EXEC", ["math.add", ["$a", "$b"]]],
      ["SET", ["RETURN", "$LAST"]]
    ]
  ]],
  ["EXEC", ["$AddNumbers", [5, 10]]],
  ["EXEC", ["console.log", ["The result is:", "$LAST"]]]
]
```
*When `AddNumbers` finishes, the value in `$RETURN` (which is 15) becomes the `$LAST` value for the main script!*

---

## 4. Advanced Tricks: The `&` Symbol (By-Reference)

Normally, when you pass a value into a function, nejy makes a **safe copy** (a clone) of that value. This ensures the function can't accidentally mess up data in the rest of your script.

However, sometimes you want to pass a very large object, or you *want* the function to interact with the original object (like the `$VARS` dictionary). You can tell nejy not to copy the data by adding an `&` in front of the argument name!

```json
[
  ["SET", ["myBigObject", { "name": "System", "status": "Online" }]],

  ["F", [
    "CheckStatus",
    ["&target"],
    [
      ["EXEC", ["console.log", ["Status is:", "$target.status"]]]
    ]
  ]],

  ["EXEC", ["$CheckStatus", ["$myBigObject"]]]
]
```
By using `&target`, the function uses the exact original object instead of making a copy. This is extremely important when dealing with the `$VARS` object in advanced CPU intensive scripts like the `ON_QUOTA` handlers.

---

## 5. Advanced Tricks: Object Destructuring

What if you have a massive object with 100 properties, but your function only needs two of them? Instead of passing the whole object, you can use **Object Destructuring**.

Instead of a simple string for the argument name, you use an object `{}` to tell nejy exactly which properties to pull out and what to name them inside your function.

```json
[
  ["SET", ["userProfile", { "firstName": "John", "lastName": "Doe", "age": 42 }]],

  ["F", [
    "PrintName",
    [ { "firstName": "first", "lastName": "last" } ],
    [
      ["EXEC", ["console.log", ["User's name is:", "$first", "$last"]]]
    ]
  ]],

  ["EXEC", ["$PrintName", ["$userProfile"]]]
]
```

### Mixing `&` and Destructuring
You can even mix these two advanced features! If you want to extract a property but keep it as a reference, just use `&` in the mapped name.

```json
[
  { "cpuStats": "&cpu" }
]
```
This tells the function: "Look at the input object, grab the `cpuStats` property, and give it to me as `$cpu` without copying it."

---

## Conclusion
The `F` command is the secret to keeping your nejy scripts clean, fast, and reusable. By combining simple function definitions with advanced features like `&` references and object destructuring, you can write highly efficient and powerful code.