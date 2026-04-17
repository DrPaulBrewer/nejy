# Installing and Using nejy

`nejy` can be installed globally as a command-line utility or locally as a dependency in your Node.js projects.

## Global Installation (CLI usage)

To install `nejy` globally so you can use its CLI commands from anywhere:

```bash
npm install -g @eaftc/nejy
```

### CLI Usage

Once installed, you can use the `nejy` command in your terminal.

**Run a script:**
```bash
nejy run path/to/script.yaml --policy LOW
```

**Scan a script (static analysis without execution):**
```bash
nejy scan path/to/script.yaml --policy LOW
```

Use `nejy --help` for more information on the available commands and options.

## Local Installation (Library usage)

To use `nejy` within your own project, install it as a dependency:

```bash
npm install -S @eaftc/nejy
```

### Library API Usage

You can import `nejy` to programmatically execute or scan scripts from within your own Node.js code.

```javascript
import { nejyRun, nejyScan, getDefaultRegistry } from '@eaftc/nejy';

const program = [
    "EXEC",
    ["$console.log", ["Hello from nejy!"]]
];

// Scan a program for safety (throws on failure, returns true on success)
try {
    await nejyScan(program, "LOW");
    console.log("Program is safe!");
} catch (err) {
    console.error("Safety scan failed:", err.message);
}

// Run a program
const { errorMsg, result, usage } = await nejyRun(program, "LOW");

if (errorMsg) {
    console.error("Execution failed:", errorMsg);
} else {
    console.log("Result:", result);
    console.log("Resource usage:", usage);
}
```

The exported functions accept an optional third argument `registryPaths` if you want to override the `getDefaultRegistry()` and provide your own list of registry configurations.
