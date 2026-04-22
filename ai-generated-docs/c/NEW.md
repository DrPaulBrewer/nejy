# NEW
**Date:** 2026-04-22

## Overview
The `NEW` command is used to instantiate JavaScript classes or constructors natively within the Nejy interpreter. It effectively acts as a wrapper around the JavaScript `new` operator.

## Syntax
```yaml
- ["NEW", ["TargetConstructor", ["arg1", "arg2"], "destVariable"]]
```

### Parameters
1. **Target Constructor** *(String)*: The path to the constructor function. Like `EXEC`, this can point to a global capability (e.g., `"Date"`, `"Map"`) or a context variable.
2. **Arguments** *(Array)*: An array of arguments to pass to the constructor. Variables (strings starting with `$`) will be automatically resolved.
3. **Destination Variable** *(Optional String)*: The variable name where the newly instantiated object will be stored.

## Examples

**Creating a new Date object**
```yaml
- ["NEW", ["Date", [], "dateObj"]]
- ["EXEC", ["$dateObj.toISOString", [], "utcTime"]]
```

**Instantiating a class with arguments**
```yaml
- ["NEW", ["URL", ["https://example.com/"], "myUrl"]]
- ["EXEC", ["console.log", ["$myUrl.hostname"]]]
```
