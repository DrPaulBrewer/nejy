This documentation provides a deep dive into the safety model and a fast-track guide for getting your first scripts running.
## 1. SECURITY.md

# Security Architecture & Threat Model
JSON-Runtime is designed to execute untrusted or semi-trusted logic with "Hard Sandbox" enforcement. This document outlines the defensive layers and mitigations against common attack vectors.
## 1. Defensive Layers### Layer 1: Static Deep-ScanBefore a single instruction is executed, the entire program (including nested logic) is stringified and scanned. This prevents "obfuscated" calls hidden in complex data structures.
- **Risk Tiering**: If a script uses `os.` or `process.`, the scanner automatically upgrades the required risk level to `HIGH`.
- **Instruction Validation**: Only whitelisted keywords (e.g., `EXEC`, `PIPE`) are allowed.
### Layer 2: Prototype HardeningThe runtime prevents **Prototype Pollution** attacks by blacklisting access to:
- `Object.prototype`, `__proto__`, and `constructor`.
- `Reflect.set` and `Reflect.defineProperty`.
This ensures a script cannot modify the behavior of the host process or other objects.
### Layer 3: Namespace IsolationThe `resolvePath` logic creates a physical split between data and tools:
- `$` prefixing is mandatory for user-defined variables.- Non-prefixed paths are strictly resolved against a **Whitelist** of safe Node.js globals.
## 2. Resource Guarding### Hardware QuotasThe `ResourceMonitor` tracks CPU (User + System) and RSS Memory. Because Node.js is single-threaded, the interpreter performs "Checkpoints" every 5,000 iterations to ensure it can kill a runaway loop before it exhausts the host.
### Instrumentation- **Filesystem**: `fs.writeFileSync` is wrapped to track cumulative bytes written.
- **Network**: `fetch` is wrapped with `URLPattern` matching, enforcing forced headers and blocking forbidden ones (like `Cookie` or `Authorization`).
## 3. The "Final Breath" ProtocolWhen a quota is hit, the runtime throws a `QUOTA_EXCEEDED` error. To prevent a "Zombie Loop" (catching the error and continuing), the monitor sets a `HARD_STOP` flag. The only logic allowed after exhaustion is a single, unmetered `ON_QUOTA` block for emergency state saving.

------------------------------
## 2. QUICKSTART.md

# Quick Start Guide
Welcome to JSON-Runtime! This guide will help you move from "Hello World" to high-precision math and system reporting.
## 1. InstallationEnsure you have the core dependencies installed:
```bash
npm install yaml mathjs json5

## 2. Your First Program (hello.yml)
YAML is the preferred format for readability.

# Simple Hello World
- ["SET", ["name", "Human"]]
- ["EXEC", ["console.log", ["Hello, ", "$name"]]]
# A simple calculation
- ["EXEC", ["math.evaluate", ["2 + 2"]]]
- ["EXEC", ["console.log", ["2 + 2 is:", "$LAST"]]]

Run it:

node main.mjs hello.yml manifest.json

## 3. Using the Pipeline (pipe.yml)
The PIPE command lets you chain actions together. Each step passes its result to the next.

- ["PIPE", [
    ["NEW", ["Date", []]],     # Create a new Date object
    "$LAST.toISOString",       # Convert it to a string
    ["SET", ["time", "$LAST"]],# Save it to $time
    "console.log"              # Print it!
  ]]

## 4. High-Precision Math
Standard JS fails at big numbers. We don't.

# Configure 64-digit precision
- ["EXEC", ["math.config", [{ number: "BigNumber", precision: 64 }]]]
# Divide 1 by 3
- ["EXEC", ["math.evaluate", ["1 / 3"]]]
- ["EXEC", ["console.log", ["Result:", "$LAST"]]]

## 5. Security & The Manifest
Every program needs a manifest.json. If you want to use the os module for a health report, you must set the risk to HIGH:

{
  "maxRisk": "HIGH",
  "quotas": {
    "maxCpuMs": 2000,
    "maxMemoryMb": 256
  }
}

## 6. Cleanup Logic
Define an ON_QUOTA block to handle crashes gracefully:

- ["DEF", [
    "ON_QUOTA",
    [["EXEC", ["console.log", ["💾 Saving state before shutdown..."]]]]
  ]]


**What should we build next?** We could create a **"YAML Package Manager"** that downloads and verifies these scripts, or a **"Test Suite"** to ensure every keyword is working as expected.


