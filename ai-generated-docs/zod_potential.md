WARNING: This document is partially out-of-date because of the big command rewrite.  It is still
applicable when discussing registry entries.  Please verify against current codebase for complete accuracy
before trusting it.  


======================================================
Original document below
======================================================

I have analyzed the codebase and identified specific areas where introducing zod schemas would significantly simplify validation, improve clarity, and ensure that loaded JSON/YAML structures are strictly correct before the engine starts executing.

Here is the detailed explanation.

Code Sections to Simplify with Zod
The primary areas that would benefit from zod schema validation are the boundary points where the system loads and parses configuration files (policies and registry files). Since these files dictate the security and capabilities of the sandboxed scripts, ensuring they are structurally valid is critical.

1. Policy Manifest Loading (nejy.mjs - loadSetup())
Current State (Manual Checks): In nejy.mjs, the loadSetup() function reads a policy JSON file (e.g., config/security/policies/low.json). After JSON.parse is called, the code relies on manual fallback logic to validate the shape:

const riskMap = { "LOW": 0, "MEDIUM": 1, "HIGH": 2, "INSANE": 3 };
const maxRisk = policy.maxRisk || "LOW";

if (process.env.NEJY_MAX_RISK) {
    const envVal = process.env.NEJY_MAX_RISK;
    if (riskMap[envVal] === undefined) { ... }
    if (riskMap[maxRisk] > riskMap[envVal]) { ... }
}
Currently, there is absolutely no check verifying that policy.quotas actually exists, or that its inner properties (maxCpuMs, maxMemoryMb, maxFsBytes) are numbers. If a user accidentally malforms the JSON (e.g., puts a string where a number should be, or misspells "quotas"), the system will fail silently or crash deeper inside the execution when the ResourceMonitor tries to use those values.

How Zod Simplifies This: A zod schema would replace the manual checking and guarantee that the parsed document conforms exactly to the required structure:

const PolicySchema = z.object({
  maxRisk: z.enum(["LOW", "MEDIUM", "HIGH", "INSANE"]).default("LOW"),
  quotas: z.object({
    maxCpuMs: z.number().nonnegative(),
    maxMemoryMb: z.number().nonnegative(),
    maxFsBytes: z.number().nonnegative(),
  })
});
By simply calling const policy = PolicySchema.parse(JSON.parse(fs.readFileSync(policyPath, 'utf8')));, you completely remove the need to manually verify field presence. It also handles defaults (like falling back to "LOW") declaratively. If the file is syntactically invalid or has wrong types, zod throws an immediate, highly descriptive error before the interpreter ever boots.

2. Registry Entry Loading (lib/buildMods.mjs - loadRegistry() & buildEntry())
Current State (Manual Checks): The security capability registry loads YAML files from config/security/registry/available/. In lib/buildMods.mjs, loadRegistry() reads the YAML and just pushes doc?.entries into an array without verifying what those entries contain.

Later, in buildEntry(), the code relies entirely on manual destructuring and runtime type checking to handle the shape:

const {
  key, src, module: modulePath, risk: baseRisk = 'LOW', methods, overrides = {}, setup
} = entry;

// ... manual checking scattered throughout
if (methods && typeof methods === 'object' && methods !== '*') { ... }
const instance = (setup && Array.isArray(setup)) ? ...
Because the system doesn't validate the structure upfront, every function that touches an entry has to defensive-program against undefined or incorrect types (e.g., checking if setup is an array, or if methods is an object).

How Zod Simplifies This: A Zod schema could describe exactly what a registry entry should look like:

const RegistryEntrySchema = z.object({
  key: z.string(),
  src: z.enum(["import", "global"]),
  module: z.string().optional(),
  risk: z.enum(["LOW", "MEDIUM", "HIGH", "INSANE"]).default("LOW"),
  methods: z.union([z.literal("*"), z.record(z.string())]).optional(),
  overrides: z.record(z.string()).optional(),
  setup: z.array(z.any()).optional(),
  freezePrototypes: z.boolean().optional()
});

const RegistryFileSchema = z.object({
  entries: z.array(RegistryEntrySchema)
});
If you parse the YAML file through RegistryFileSchema.parse(), you instantly eliminate all the scattered typeof methods === 'object' and Array.isArray(setup) checks across buildMods.mjs. The code can safely assume the types are exactly what they are supposed to be.

Conclusion
By implementing npm:zod (which is already included in your package.json), you can:

Validate JSON/YAML correctness instantly: Zod will immediately reject misspelled keys, missing required fields, or wrong data types in configuration files.
Remove boilerplate: Drop the typeof and Array.isArray guard clauses inside your initialization routines.
Fail fast: Bad policies or registry files will crash the app with clear error messages immediately at boot, rather than causing weird side effects during script execution.