# F
**Date:** 2026-04-22

## Overview
The `F` command defines a custom, reusable Nejy function and stores it in the local context (`ctx.vars`). It acts as a mini-program that you can define once and execute multiple times. `F` is extremely useful for defining callbacks, event handlers, or encapsulating repetitive logic to keep your scripts clean and DRY.

## Syntax
```yaml
- ["F", ["FunctionName", ["arg1", "arg2"], [
    ["Step1", ["..."]],
    ["SET", ["RETURN", "result"]]
]]]
```

### Parameters
1. **Function Name** *(String)*: The name of the variable to store the function in (e.g., `"GreetUser"` creates `$GreetUser`).
2. **Formal Arguments** *(Array of Strings/Objects)*: The names of the parameters the function expects. 
   - **Pass-by-Reference**: Prefix an argument with `&` (e.g., `"&target"`) to pass it by reference. This prevents Nejy from cloning the variable, which is critical for large objects or when the function needs to modify the original object.
   - **Object Destructuring**: Use an object mapping `{}` instead of a string to extract specific properties from an incoming object argument.
   - **Function Capture**: If the last parameter is exactly `"all functions"`, the function will capture variables containing other functions that were defined earlier in the script (creating a partial functional closure, data variables are **not** captured).
3. **Steps** *(Array)*: An array of Nejy command steps to execute when the function is invoked.

## Examples

**Defining a Simple Function**
Here is a basic function that greets a user, and how to invoke it using `EXEC`:
```yaml
- ["F", ["GreetUser", ["username"], [
    ["EXEC", ["console.log", ["Hello,", "$username", "!"]]]
]]]

- ["EXEC", ["$GreetUser", ["Alice"]]]
- ["EXEC", ["$GreetUser", ["Bob"]]]
```

**Returning Values**
To return a value back to the caller, assign it to the special `$RETURN` variable. (Notice how we use `EXEC`'s third argument to map the math operation directly to `RETURN`).
```yaml
- ["F", ["AddNumbers", ["a", "b"], [
    ["EXEC", ["math.add", ["$a", "$b"], "RETURN"]]
]]]

- ["EXEC", ["$AddNumbers", [5, 10], "result"]]
- ["EXEC", ["console.log", ["The result is:", "$result"]]]
```

**Pass-by-Reference with the `&` Symbol**
Normally, Nejy makes a safe clone [JS: structuredClone] of all inputs. But it cannot clone functions, so if you need to pass functions, or structures, use `&`. 
```yaml
- ["SET", ["myBigObject", { "name": "System", "status": "Online" }]]

- ["F", ["CheckStatus", ["&target"], [
    ["EXEC", ["console.log", ["Status is:", "$target.status"]]]
]]]

- ["EXEC", ["$CheckStatus", ["$myBigObject"]]]
```

**Object Destructuring**
If a function only needs two properties from a massive object, you can map them directly in the argument definition using an object `{}`. You can also mix this with `&` references!
```yaml
- ["SET", ["userProfile", { "firstName": "John", "lastName": "Doe", "age": 42 }]]

# The argument definition says: Look at the input object, grab 'firstName', and map it to '$first'.
- ["F", ["PrintName", [ { "firstName": "first", "lastName": "last" } ], [
    ["EXEC", ["console.log", ["User's name is:", "$first", "$last"]]]
]]]

- ["EXEC", ["$PrintName", ["$userProfile"]]]
```
