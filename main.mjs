import fs from 'node:fs';
import process from 'node:process';
import YAML from 'yaml';
import ResourceMonitor from './monitor/index.js';
import { buildMods, loadRegistry } from './lib/buildMods.mjs';
import { Command } from 'commander';
import { SecurityScanner } from './lib/interp/scanner.mjs';
import { run } from './lib/interp/commands.mjs';

const pkgPath = new URL('./package.json', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const NEJY_VERSION = pkg.version;

// Default registry files loaded when manifest doesn’t specify its own.
// 90-process.yaml is intentionally excluded from all default manifests.
const DEFAULT_REGISTRY = [
    'config/security/registry/00-builtins.yaml',
    'config/security/registry/10-math.yaml',
    'config/security/registry/15-mathFunction.yaml',
    'config/security/registry/20-console.yaml',
    'config/security/registry/30-yaml-module.yaml',
    'config/security/registry/40-os.yaml',
    'config/security/registry/50-fs.yaml',
    'config/security/registry/60-net.yaml',
    'config/security/registry/80-json.yaml',
];

function loadSetup(policyName, filename = "unknown") {
    const policyPath = policyName.includes('/')
        ? policyName
        : `config/security/policies/${policyName.toLowerCase()}.json`;

    if (!fs.existsSync(policyPath)) {
        console.error(`❌ Policy file not found: ${policyPath}`);
        process.exit(1);
    }
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

    // ENV and Bounding Logic
    const riskMap = { "LOW": 0, "MEDIUM": 1, "HIGH": 2, "INSANE": 3 };
    const maxRisk = policy.maxRisk || "LOW";

    if (process.env.NEJY_MAX_RISK) {
        const envVal = process.env.NEJY_MAX_RISK;
        if (riskMap[envVal] === undefined) {
            console.error(`❌ Invalid NEJY_MAX_RISK environment variable: ${envVal}`);
            process.exit(1);
        }
        if (riskMap[maxRisk] > riskMap[envVal]) {
            console.error(`❌ Boot Failure: Requested policy maxRisk (${maxRisk}) exceeds environment limit NEJY_MAX_RISK (${envVal})`);
            process.exit(1);
        }
    }

    // No minRisk check.

    console.error(`nejy v${NEJY_VERSION} | effectiveMaxRisk: ${maxRisk} | program: ${filename.split('/').pop()} | manifest: ${policyPath.split('/').pop()}`);

    const registryEntries = loadRegistry(DEFAULT_REGISTRY);
    const scanner = new SecurityScanner(policy, registryEntries);
    return { policy, registryEntries, scanner };
}

function processOutput(errorMsg, result, usage) {
    console.log(errorMsg ? "❌ Execution Failed." : "✅ Execution Finished.");
    console.log("```yaml");
    console.log(YAML.stringify([errorMsg, result, usage]).trim());
    console.log("```");
}

const program = new Command();

program
    .name('nejy')
    .description('Nejy Runtime: Sandboxed JSON/YAML Interpreter')
    .version(NEJY_VERSION);

program.command('scan')
    .description('Statically analyze a program without executing it')
    .argument('<file>', 'Path to the .json or .yaml program')
    .option('-p, --policy <policy>', 'Policy level to enforce (LOW, MEDIUM, HIGH)', 'LOW')
    .action(async (file, options) => {
        const prog = YAML.parse(fs.readFileSync(file, 'utf8'));
        const { scanner } = loadSetup(options.policy, file);

        try {
            await scanner.scan(prog);
            console.log("🛡️  Safety Scan Passed.");
            process.exit(0);
        } catch (e) {
            console.error(`❌ ${e.message}`);
            process.exit(1);
        }
    });

program.command('run')
    .description('Scan and execute a nejy program')
    .argument('<file>', 'Path to the .json or .yaml program')
    .option('-p, --policy <policy>', 'Policy level to enforce (LOW, MEDIUM, HIGH)', 'LOW')
    .action(async (file, options) => {
        const prog = YAML.parse(fs.readFileSync(file, 'utf8'));
        const { policy, registryEntries, scanner } = loadSetup(options.policy, file);

        let scannedProg = prog;
        try {
            scannedProg = (await scanner.scan(prog)) ?? prog;
        } catch (e) {
            processOutput(e.message, null, null);
            process.exit(1);
        }

        const mods = await buildMods(registryEntries, policy.maxRisk ?? 'LOW', scanner.requestList);
        const mon = new ResourceMonitor(policy.quotas);

        if (mods.fs) mon.instrumentFs(mods.fs);

        const ctx = {
            mods,
            vars: { "$LAST": null, "$ERROR": null, "$ITEM": null, "$USAGE": null, "$INPUT": null, "$RETURN": null },
            functions: {},
            mon,
            scanner,
        };

        try {
            await run(scannedProg, ctx, false);
            if (!ctx.vars["$USAGE"]) ctx.vars["$USAGE"] = ctx.mon.usage;
            processOutput(null, ctx.vars["$RETURN"] ?? ctx.vars["$LAST"], ctx.vars["$USAGE"]);
            process.exit(0);
        } catch (e) {
            if (e.message === "HARD_STOP" || e.message === "QUOTA_EXCEEDED") {
                console.error(`❌ Fatal Error: ${e.message}`);
                processOutput(e.message, null, ctx.vars["$USAGE"] || ctx.mon.usage);
                process.exit(1);
            }
            if (!ctx.vars["$USAGE"]) ctx.vars["$USAGE"] = ctx.mon.usage;
            processOutput(e.message, null, ctx.vars["$USAGE"]);
            process.exit(1);
        }
    });

program.parse(process.argv);
