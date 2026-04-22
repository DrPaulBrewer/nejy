# Executing Nejy Scripts with a Bash Shebang
**Date:** 2026-04-22

Because Nejy uses a powerful YAML parser for both `.yaml` and `.json` files under the hood, and the YAML specification treats any line starting with `#` as a comment, you can seamlessly integrate Nejy scripts with your Unix/Linux terminal by adding a bash shebang!

This allows you to execute Nejy programs directly as native executables (e.g., `./myprogram.yaml`) instead of passing them explicitly to the engine (e.g., `nejy run myprogram.yaml`).

## The Shebang Syntax

You must use the `env -S` flag to correctly pass the `run` argument to the Nejy executable.

If Nejy is installed globally in your system path (e.g., via `npm install -g @eaftc/nejy`), add this line to the absolute top of your file:
```bash
#!/usr/bin/env -S nejy run
```

### Enforcing Security Policies
One of the most powerful aspects of this approach is that you can strictly enforce the sandbox security policy right from the shebang. By baking the `-p` flag into the script itself, anyone running the script will automatically be restricted to that risk level:
```bash
#!/usr/bin/env -S nejy run -p LOW
```

---

## Examples

### YAML Example
```yaml
#!/usr/bin/env -S nejy run -p MEDIUM
- ["EXEC", ["console.log", ["Hello from an executable YAML file!"]]]
```

### JSON Example
*(Note: Standard JSON does not officially support comments, but because Nejy runs all `.json` files through the YAML parser first, this works perfectly and safely!)*
```json
#!/usr/bin/env -S nejy run -p LOW
[
  ["EXEC", ["console.log", ["Hello from an executable JSON file!"]]]
]
```

## Running the Script
Don't forget to grant execute permissions to your file using `chmod`:
```bash
chmod +x myprogram.yaml
./myprogram.yaml
```
