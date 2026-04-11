To truly understand Nejy, you have to understand the Registry. This isn't just a list of functions; it is a security contract. The registry defines which Node.js powers are available and how much they "cost" in terms of risk.
Below is a human-readable map of the Nejy ecosystem, categorized by the level of trust required to run them.
## Nejy API & Risk Registry

| Category | Namespace | Key Methods / Access | Risk Level |
|---|---|---|---|
| Logic & Math | Math, math | All Math methods, math.evaluate, math.compile | LOW |
| Data Types | Array, String, Number, Date, Map, Set, URL, BigInt | Standard constructors and static methods | LOW |
| Standard IO | console | log, error, warn, table, time, etc. | LOW |
| Parsing | YAML, JSON | YAML.parse, YAML.stringify | LOW |
| Encoding | atob, btoa, Buffer | Base64 conversion, Buffer.alloc | LOW |
| Security | crypto | Standard Web Crypto API | LOW |
| System Info | os | hostname, uptime, freemem, cpus, arch | MEDIUM |
| Read Access | fs | readFileSync, readdirSync, existsSync, statSync | MEDIUM |
| Logic Safety | RegExp | All Regular Expression operations (CPU DoS risk) | MEDIUM |
| Network | fetch | Secure GET requests (headers like Cookie/Auth stripped) | MEDIUM |
| Write Access | fs | writeFileSync, appendFileSync, mkdirSync, rmSync | HIGH |
| Shell/Proc | child_process, cp | execSync, spawnSync, execFile | HIGH |
| Crypto CPU | crypto.subtle | Key generation and derivation (High CPU usage) | HIGH |
| Privilege | fs | chmodSync, chownSync | INSANE |
| Process Ctrl | process | exit, kill, env, binding, dlopen | INSANE |
| Meta-Logic | Reflect, Object | Dynamic property hijacking, prototype access | INSANE |

------------------------------
## Deep Dive: How the Registry Works
The Registry uses three specific "Modes" to control how a Node.js module is exposed to a Nejy script:
## 1. Wildcard Mode (Total Exposure)
If a registry entry has a risk level but no specific methods listed, the entire object is exposed via a Proxy.

* Example: Math is set to LOW. This means Math.abs, Math.random, and Math.sqrt are all available to any script.

## 2. The "Carve-Out" (Overrides)
Some objects are too dangerous to expose entirely, so Nejy locks the base object and "carves out" safe exceptions.

* Example: The Object namespace is INSANE (to prevent prototype tampering), but common utilities like Object.keys and Object.values are specifically overridden to be LOW risk.

## 3. Setup & Initializers
Some modules require configuration before the script can touch them. Nejy handles this in the registry via the setup key.

* Example: The math entry doesn't just import mathjs; it runs a setup command to initialize the library with all its standard functions before handing the instance to your script.

## 4. Secure Wrapping
Nejy can replace standard Node.js functions with "Secured" versions.

* Example: The fetch command is mapped to a local secureFetch.mjs file. This wrapper ensures that Nejy scripts can't accidentally (or intentionally) leak your system cookies or authorization headers to an external website.

------------------------------
## Pro-Tip: Checking Risk in Real-Time
If you are unsure why a script is failing, check the Manifest. Every Nejy program requires a maxRisk declaration. If your manifest says LOW but you call os.hostname, the interpreter will block it because the Registry has priced os.hostname at MEDIUM.
How would you like to finish the article? We could add a section on Writing Your Own Registry Entries for private company modules, or a Troubleshooting Guide for security blocks.

