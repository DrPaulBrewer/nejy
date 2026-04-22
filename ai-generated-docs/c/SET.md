# SET
**Date:** 2026-04-22

## Overview
The `SET` command assigns a value to a variable in the local execution context (`ctx.vars`). It resolves variables in the value before assignment and safely clones the structure.

## Syntax
```yaml
- ["SET", ["variableName", "value"]]
```

### Parameters
1. **Variable Name** *(String)*: The name of the variable to set. The leading `$` is optional (e.g., `"foo"` and `"$foo"` are treated identically for the destination key).
2. **Value** *(Any)*: The value to assign. Strings starting with `$` will be resolved against the current context. Missing variables resolve to `undefined`.

## Examples

**Assigning primitive values**
```yaml
- ["SET", ["sum", 0]]
- ["SET", ["$message", "Hello World"]]
```

**Aliasing or copying variables**
```yaml
- ["SET", ["tempHost", "$host"]]
```

**Setting complex structures**
Because `SET` resolves its arguments recursively, you can build objects from other variables:
```yaml
- ["SET", ["entries", {
    "hostname":         "$host",
    "memory_usage_pct": "$pct"
}]]
```

**Returning values**
`RETURN` is a special variable that dictates the final exit value of the script block.
```yaml
- ["SET", ["RETURN", "$entries"]]
```

**Deep Property Assignment and Extraction**
Because Nejy uses `dot-prop` under the hood, you can use dot-notation to extract deeply nested values or assign deeply nested properties. When setting a deep property, any missing interior structures are automatically created for you (similar to `mkdir -p`).
```yaml
# Given a complex configuration object
- ["SET", ["config", { "server": { "host": "localhost" } }]]

# 1. Deep Extraction: Reads "localhost"
- ["SET", ["currentHost", "$config.server.host"]]

# 2. Deep Assignment: Automatically creates the "database" and "credentials" objects!
- ["SET", ["config.database.credentials.password", "supersecret"]]

# 3. Array Extraction: Reads the first element of an array
- ["SET", ["users", ["Alice", "Bob", "Charlie"]]]
- ["SET", ["firstUser", "$users[0]"]]

# 4. Deep Array Assignment: Creates a nested array, an object at index 1, and sets the IP!
- ["SET", ["config.servers[1].ip", "192.168.1.100"]]

# $config is now: 
# { 
#   server: { host: "localhost" }, 
#   database: { credentials: { password: "supersecret" } },
#   servers: [ null, { ip: "192.168.1.100" } ]
# }
```
