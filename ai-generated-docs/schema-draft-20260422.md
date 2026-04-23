
# Schema Validation for Nejy Scripts

## Issues Encountered
Writing a JSON Schema for `nejy` scripts presents several unique challenges due to the language's reliance on dynamic, array-based AST representations, positional arguments, and highly flexible runtime evaluation.

### 1. Differentiating Known vs. Unknown Commands
A `nejy` script is an array of steps, where each step is typically an array: `[command, arguments, destination]`.
If the `command` is a built-in (e.g., `"EXEC"`, `"SET"`, `"F"`), JSON Schema can strictly validate the rest of the array using `allOf` + `if/then` blocks.
However, `nejy` allows implicit commands:
- **Implicit EXEC**: `["math.evaluate", ["$a", "$b"], "dest"]` or `["$myFunc", ["arg1"]]`
- **Implicit Math**: `[" $x = $x + 1", [], "dest"]` (indicated by a leading space).

To support this without false rejections, the schema must use a "catch-all" or `not: { enum: [ ...known commands... ] }` to loosely validate any step that doesn't match a built-in command.

### 2. Deep Recursion
Many commands (`F`, `FOR_EACH`, `IF`, `TRY`, `SANDBOX`) take subprograms (arrays of steps) as arguments. This requires the schema to be self-referential (e.g., using `$ref: "#/$defs/step"`). Standard JSON Schema Drafts (including those supported by Ajv) fully support recursive schemas, but they can make error reporting verbose, as a deeply nested error will print a long JSON path.

### 3. Context-Dependent Syntax
- **Argument Resolution**: Nejy arguments can be literal values, variable references (`"$var"`), or even inline `["LITERAL", ...]` arrays. A schema cannot verify if `"$foo"` is actually defined in the scope.
- **Dynamic Capabilities**: Paths like `"math.add"` or `"child_process.execSync"` cannot be verified by JSON Schema to ensure they exist in the registry or comply with the current sandbox policy.
- **Pass-by-Reference**: `F` function arguments support pass-by-reference (e.g., `"&target"`), object destructuring `{ "firstName": "first" }`, and the special `"all functions"` keyword. While a schema can enforce that the argument list is an array of strings/objects, it cannot validate the *correctness* of the references.

## How Much Validation is Possible?

### What CAN be Validated
* **Top-Level Structure**: The program is an array of arrays (steps).
* **Command Arity**: Ensuring commands have the correct number of arguments (e.g., `SET` needs exactly 2 arguments in its param array; `CHILD` takes 2 or 3 elements).
* **Argument Shapes**:
  * `EXEC`'s third argument must be a string or a specific object (`into`, `chain`, `compose`, `promise`).
  * `SANDBOX`'s first argument must be `"copy"` or an object with `policy`, `capabilities`, `context`.
  * `IF` takes a condition, a true-branch array, and an optional false-branch array.
* **Recursive Steps**: Subprograms inside `F`, `TRY`, `FOR_EACH`, etc., can be fully validated as valid steps.
* **Implicit Math Shorthand**: Steps whose first string starts with a space can be identified via `pattern: "^ "`.

### What CANNOT be Validated
* **Variable Existence**: Whether `$var` is defined.
* **Capability Existence/Authorization**: Whether `fs.readFile` is allowed or exists.
* **Math Expression Validity**: The string passed to `MATH` or implicit math cannot be parsed by JSON Schema to ensure it's valid `mathjs` syntax.
* **Execution State**: Whether a `CHILD` target was properly defined via `F` beforehand.
* `REQUEST` **Placement Requirement**: While we can check `REQUEST` shape, enforcing that it is *only* the first step of the root program (and never in a subprogram) is extremely difficult in pure JSON Schema without restructuring the root schema vs step schema (which may cause other complexities).

## Is Partial Validation Possible Without False Rejections?
**Yes.** We can construct a permissive JSON Schema that acts as a "syntax checker".
It validates the strict shape of known commands and provides a loose fallback for implicit `EXEC` and implicit `MATH`. This prevents typos like `["SET", "missing_args"]` but permits `["custom.method", ["args"], "dest"]`.

## Comprehensive Draft JSON Schema

Below is a draft schema that covers all core Nejy commands while allowing implicit fallbacks.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "nejy-script",
  "title": "Nejy Script Validation Schema",
  "type": "array",
  "items": { "$ref": "#/$defs/step" },
  "$defs": {
    "step": {
      "type": "array",
      "minItems": 1,
      "maxItems": 3,
      "items": [
        { "type": "string" }
      ],
      "allOf": [
        { "$ref": "#/$defs/command_SET" },
        { "$ref": "#/$defs/command_EXEC" },
        { "$ref": "#/$defs/command_F" },
        { "$ref": "#/$defs/command_MATH" },
        { "$ref": "#/$defs/command_FOR_EACH" },
        { "$ref": "#/$defs/command_IF" },
        { "$ref": "#/$defs/command_TRY" },
        { "$ref": "#/$defs/command_SANDBOX" },
        { "$ref": "#/$defs/command_CHILD" },
        { "$ref": "#/$defs/command_AWAIT" },
        { "$ref": "#/$defs/command_NEW" },
        { "$ref": "#/$defs/command_LITERAL" },
        { "$ref": "#/$defs/command_REQUEST" },
        { "$ref": "#/$defs/implicit_math" },
        { "$ref": "#/$defs/implicit_exec" }
      ]
    },
    "subprogram": {
      "type": "array",
      "items": { "$ref": "#/$defs/step" }
    },
    "command_SET": {
      "if": { "items": [{ "const": "SET" }] },
      "then": {
        "minItems": 2, "maxItems": 2,
        "items": [
          { "const": "SET" },
          { "type": "array", "minItems": 2, "maxItems": 2, "items": [{ "type": "string" }, {}] }
        ]
      }
    },
    "command_EXEC": {
      "if": { "items": [{ "const": "EXEC" }] },
      "then": {
        "minItems": 2, "maxItems": 3,
        "items": [
          { "const": "EXEC" },
          { "type": "array", "minItems": 2, "maxItems": 3, "items": [
              { "type": "string" },
              { "type": "array" },
              {
                "anyOf": [
                  { "type": "string" },
                  { "type": "object", "properties": { "into": { "type": "string" }, "chain": { "type": "array" }, "compose": { "type": "array" }, "promise": {} } }
                ]
              }
            ]
          }
        ]
      }
    },
    "command_F": {
      "if": { "items": [{ "const": "F" }] },
      "then": {
        "minItems": 2, "maxItems": 2,
        "items": [
          { "const": "F" },
          { "type": "array", "minItems": 3, "maxItems": 3, "items": [
              { "type": "string" },
              { "type": "array", "items": { "anyOf": [{ "type": "string" }, { "type": "object" }] } },
              { "$ref": "#/$defs/subprogram" }
            ]
          }
        ]
      }
    },
    "command_MATH": {
      "if": { "items": [{ "const": "MATH" }] },
      "then": {
        "minItems": 2, "maxItems": 2,
        "items": [
          { "const": "MATH" },
          { "type": "array", "minItems": 3, "maxItems": 3, "items": [
              { "type": "string" },
              { "type": "array", "items": { "anyOf": [{ "type": "string" }, { "type": "object" }] } },
              { "type": "string" }
            ]
          }
        ]
      }
    },
    "command_FOR_EACH": {
      "if": { "items": [{ "const": "FOR_EACH" }] },
      "then": {
        "minItems": 2, "maxItems": 2,
        "items": [
          { "const": "FOR_EACH" },
          { "type": "array", "minItems": 2, "maxItems": 2, "items": [
              { "anyOf": [{ "type": "string" }, { "type": "number" }, { "type": "array" }] },
              { "$ref": "#/$defs/subprogram" }
            ]
          }
        ]
      }
    },
    "command_IF": {
      "if": { "items": [{ "const": "IF" }] },
      "then": {
        "minItems": 2, "maxItems": 2,
        "items": [
          { "const": "IF" },
          { "type": "array", "minItems": 2, "maxItems": 3, "items": [
              {},
              { "$ref": "#/$defs/subprogram" },
              { "$ref": "#/$defs/subprogram" }
            ]
          }
        ]
      }
    },
    "command_TRY": {
      "if": { "items": [{ "const": "TRY" }] },
      "then": {
        "minItems": 2, "maxItems": 2,
        "items": [
          { "const": "TRY" },
          { "type": "array", "minItems": 1, "maxItems": 2, "items": [
              { "$ref": "#/$defs/subprogram" },
              { "$ref": "#/$defs/subprogram" }
            ]
          }
        ]
      }
    },
    "command_SANDBOX": {
      "if": { "items": [{ "const": "SANDBOX" }] },
      "then": {
        "minItems": 2, "maxItems": 2,
        "items": [
          { "const": "SANDBOX" },
          { "type": "array", "minItems": 2, "maxItems": 3, "items": [
              { "anyOf": [
                  { "const": "copy" },
                  { "type": "object", "properties": { "policy": { "type": "string" }, "capabilities": { "type": "array", "items": { "type": "string" } }, "context": { "type": "array", "items": { "type": "string" } } } }
              ]},
              { "$ref": "#/$defs/subprogram" },
              { "type": "string" }
            ]
          }
        ]
      }
    },
    "command_CHILD": {
      "if": { "items": [{ "const": "CHILD" }] },
      "then": {
        "minItems": 2, "maxItems": 2,
        "items": [
          { "const": "CHILD" },
          { "type": "array", "minItems": 2, "maxItems": 3, "items": [
              { "type": "string" },
              { "type": "array" },
              { "type": "string" }
            ]
          }
        ]
      }
    },
    "command_AWAIT": {
      "if": { "items": [{ "const": "AWAIT" }] },
      "then": {
        "minItems": 2, "maxItems": 2,
        "items": [
          { "const": "AWAIT" },
          { "type": "array", "minItems": 1, "maxItems": 2, "items": [
              { "type": "string" },
              { "type": "string" }
            ]
          }
        ]
      }
    },
    "command_NEW": {
      "if": { "items": [{ "const": "NEW" }] },
      "then": {
        "minItems": 2, "maxItems": 2,
        "items": [
          { "const": "NEW" },
          { "type": "array", "minItems": 2, "maxItems": 3, "items": [
              { "type": "string" },
              { "type": "array" },
              { "type": "string" }
            ]
          }
        ]
      }
    },
    "command_LITERAL": {
      "if": { "items": [{ "const": "LITERAL" }] },
      "then": {
        "minItems": 2, "maxItems": 2,
        "items": [
          { "const": "LITERAL" },
          { "type": "array", "minItems": 1, "maxItems": 2, "items": [
              {},
              { "type": "string" }
            ]
          }
        ]
      }
    },
    "command_REQUEST": {
      "if": { "items": [{ "const": "REQUEST" }] },
      "then": {
        "minItems": 2, "maxItems": 2,
        "items": [
          { "const": "REQUEST" },
          { "type": "array", "items": { "type": "string" } }
        ]
      }
    },
    "implicit_math": {
      "if": { "items": [{ "pattern": "^ " }] },
      "then": {
        "minItems": 1, "maxItems": 3,
        "items": [
          { "type": "string", "pattern": "^ " },
          { "type": "array", "maxItems": 0 },
          { "type": "string" }
        ]
      }
    },
    "implicit_exec": {
      "if": {
        "not": { "items": [{ "enum": ["SET", "EXEC", "F", "MATH", "FOR_EACH", "IF", "TRY", "SANDBOX", "CHILD", "AWAIT", "NEW", "LITERAL", "REQUEST"] }] },
        "items": [{ "not": { "pattern": "^ " } }]
      },
      "then": {
        "minItems": 1, "maxItems": 3,
        "items": [
          { "type": "string" },
          { "type": "array" },
          { "type": "string" }
        ]
      }
    }
  }
}
```

## Recommendations and Best Practices

1. **Dual Validation Strategy (IDE vs Runtime)**
   - **IDE (VS Code Extension / Linting)**: The provided JSON schema acts as a robust standard for IDEs. It flags malformed parameters for built-ins instantly while remaining completely agnostic to any user-defined modules loaded at runtime.
   - **Runtime (Ajv inside Nejy)**: While you *could* run Ajv before execution, Nejy already leverages `SecurityScanner` which does static AST analysis, checks resource requests, and enforces sandbox logic. Using JSON Schema purely as an initial syntax gate (to catch argument misalignments early) is a good idea, leaving capability checks and runtime limits to `SecurityScanner`.

2. **Schema Extensibility**
   - If a specific Nejy deployment restricts implicit `EXEC` calls or certain risky commands, you can easily modify the schema's `implicit_exec` fallback to explicitly block them.

3. **Handling The Top-Level `REQUEST` Constraint**
   - To validate that `REQUEST` must only appear as the *first* step of the root script, the schema would need to distinguish between the "root array" and "subprogram arrays". This is achievable by introducing a `root_script` definition that enforces `prefixItems` with `REQUEST`, but for a general-purpose linting schema, it's often more practical to let the Nejy `SecurityScanner` enforce that rule specifically, while the schema just ensures `REQUEST` is structured correctly.
