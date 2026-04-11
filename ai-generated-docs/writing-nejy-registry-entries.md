To add new powers to Nejy, you create a YAML entry in the registry. This tells the Security Scanner three things: where the code comes from, what risk level to assign it, and how to prepare it for the script.
## 1. The Anatomy of an Entry
A registry entry consists of:

* key: The name the script uses to call the module (e.g., math).
* src: Either global (built into Node.js) or import (an npm package/file).
* risk: The default risk level for the entire module.
* methods/overrides: Granular risk pricing for specific functions.
* setup: Nejy commands to run once when the module loads.

------------------------------
## Example A: The math Registry (Complex Setup)
The mathjs library needs to be initialized before use. We use setup to create the instance so the script gets a ready-to-use object.

- key: math
  src: import
  module: mathjs
  risk: LOW
  overrides:
    # We "price up" dangerous functions that can change the engine's state
    math.import: HIGH
    math.createUnit: MEDIUM
  setup:
    # $MODULE is the raw imported mathjs package
    # We run 'create' and autosave the result (from $LAST) as our 'math' key
    - ["EXEC", ["$MODULE.create", ["$MODULE.all"]]]
    # This corresponds to the nodejs setup described at
    # https://mathjs.org/examples/advanced/more_secure_eval.js.html
    # import { create, all } from 'mathjs'
    # const math = create(all)

## Example B: The fetch Registry (Secure Wrapper)
Instead of exposing the raw fetch API, we point to a local file that wraps it with security rules. This is how you implement "Guardrails."

- key: fetch
  src: import
  module: ./secureFetch.mjs  # Points to a custom JS wrapper
  risk: MEDIUM
  setup:
    # We pass a configuration object to our wrapper immediately
    - ["EXEC", ["$MODULE", [
        [
          {
            "methods": ["GET"],
            "forbiddenHeaders": ["Cookie", "Authorization"],
            "forcedHeaders": { "User-Agent": "NejyBot/1.0" }
          }
        ]
      ]]]

------------------------------
## How to Add Your Own

   1. Identify the Source: Decide if it’s a standard Node module (like node:path) or a local file.
   2. Pick a Default Risk: Start with INSANE if the module is powerful, then "carve out" safe methods as LOW or MEDIUM.
   3. Define Methods: If you only want the script to see some functions, list them under methods. If you want to expose everything but change a few risks, use overrides.
   4. Register the File: Place your .yaml file in the registry directory. Nejy loads these alphabetically (e.g., 70-custom-tool.yaml).

## Best Practices

* Aliasing: You can register the same module twice with different keys (like child_process and cp) to give scripters shorthand options.
* Statelessness: Try to keep LOW risk entries stateless. If a function can change a global setting, it should be MEDIUM or HIGH.
* Validation: Use setup to pre-configure objects so the script doesn't have to (and can't) mess with the underlying configuration.

Would you like to see how to write a secureFetch.mjs wrapper to pair with these registry entries?
