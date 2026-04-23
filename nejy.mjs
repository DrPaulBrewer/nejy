#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import YAML from 'yaml';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';
import ResourceMonitor from './monitor/index.js';
import { buildMods, loadRegistry } from './lib/buildMods.mjs';
import { Command } from 'commander';
import { SecurityScanner } from './lib/interp/scanner.mjs';
import { PolicySchema } from './lib/schema/policy.mjs';
import { run } from './lib/interp/commands.mjs';
import { getDefaultRegistry } from './lib/registryDiscovery.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkgPath = new URL('./package.json', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const NEJY_VERSION = pkg.version;

export { getDefaultRegistry };

const ajv = new Ajv({ useDefaults: true, allErrors: true });
const validatePolicy = ajv.compile(PolicySchema);

export function loadSetup(policyName, filename = "unknown", registryPaths = undefined) {
    let policyPath;
    if (policyName.includes('/')) {
        policyPath = policyName;
    } else {
        policyPath = new URL(`./config/security/policies/${policyName.toLowerCase()}.json`, import.meta.url);
    }

    if (!fs.existsSync(policyPath)) {
        throw new Error(`❌ Policy file not found: ${policyPath}`);
    }
    const rawPolicy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

    const isValid = validatePolicy(rawPolicy);

    if (!isValid) {
        const errors = validatePolicy.errors.map(err => {
            const path = err.instancePath.replace(/^\//, '').replace(/\//g, '.');
            return `  - ${path || 'root'}: ${err.message}`;
        }).join('\n');
        throw new Error(`❌ Policy Validation Error in ${policyPath}:\n${errors}`);
    }

    const policy = rawPolicy;

    // ENV and Bounding Logic
    const riskMap = { "LOW": 0, "MEDIUM": 1, "HIGH": 2, "INSANE": 3 };
    const maxRisk = policy.maxRisk;

    if (process.env.NEJY_MAX_RISK) {
        const envVal = process.env.NEJY_MAX_RISK;
        if (riskMap[envVal] === undefined) {
            throw new Error(`❌ Invalid NEJY_MAX_RISK environment variable: ${envVal}`);
        }
        if (riskMap[maxRisk] > riskMap[envVal]) {
            throw new Error(`❌ Boot Failure: Requested policy maxRisk (${maxRisk}) exceeds environment limit NEJY_MAX_RISK (${envVal})`);
        }
    }

    // No minRisk check.

    const registryFiles = registryPaths || getDefaultRegistry();
    // Resolve registry paths relative to the current module if they are not absolute and not URLs
    const resolvedRegistryFiles = registryFiles.map(p => {
        try {
            new URL(p); // Test if it's already a URL
            return p;
        } catch {
             // For paths starting with 'config/security/registry', make sure they resolve relative to this file
             if (p.startsWith('config/security/registry')) {
                 return new URL(`./${p}`, import.meta.url).pathname;
             }
             return p;
        }
    });

    const registryEntries = loadRegistry(resolvedRegistryFiles);
    const scanner = new SecurityScanner(policy, registryEntries);
    return { policy, registryEntries, scanner };
}

export async function nejyScan(prog, policyName = "LOW", registryPaths = undefined) {
    const { scanner } = loadSetup(policyName, "program", registryPaths);
    await scanner.scan(prog);
    return true;
}

export async function nejyRun(prog, policyName = "LOW", registryPaths = undefined) {
    const { policy, registryEntries, scanner } = loadSetup(policyName, "program", registryPaths);

    let scannedProg = prog;
    try {
        scannedProg = (await scanner.scan(prog)) ?? prog;
    } catch (e) {
        return {
            errorMsg: e.message,
            result: null,
            usage: null
        };
    }

    const mods = await buildMods(registryEntries, policy.maxRisk ?? 'LOW', scanner.requestList);
    const mon = new ResourceMonitor(policy.quotas);

    if (mods.fs) mon.instrumentFs(mods.fs);

    const ctx = {
        mods,
        vars: { "$ERROR": null, "$ITEM": null, "$USAGE": null, "$INPUT": null, "$RETURN": null },
        mon,
        scanner,
        history: [],
        child_log: [],
    };

    try {
        await run(scannedProg, ctx, false);
        if (!ctx.vars["$USAGE"]) ctx.vars["$USAGE"] = ctx.mon.usage;
        return {
            errorMsg: null,
            result: ctx.vars["$RETURN"],
            usage: ctx.vars["$USAGE"]
        };
    } catch (e) {
        if (!ctx.vars["$USAGE"]) ctx.vars["$USAGE"] = ctx.mon.usage;
        return {
            errorMsg: e.message,
            result: null,
            usage: ctx.vars["$USAGE"]
        };
    }
}

function processOutput(errorMsg, result, usage) {
    console.log(errorMsg ? "❌ Execution Failed." : "✅ Execution Finished.");
    console.log("```yaml");
    console.log(YAML.stringify([errorMsg, result, usage]).trim());
    console.log("```");
}

function runCLI() {
    const program = new Command();

    program
        .name('nejy')
        .description('Nejy Runtime: Sandboxed JSON/YAML Interpreter')
        .version(NEJY_VERSION);

    program.command('scan')
        .description('Statically analyze a program without executing it')
        .argument('<file>', 'Path to the .json or .yaml program')
        .option('-p, --policy <policy>', 'Policy level to enforce (LOW, MEDIUM, HIGH)', 'LOW')
        .option('-r, --registry <registry>', 'Comma separated list of registry files')
        .action(async (file, options) => {
            const prog = YAML.parse(fs.readFileSync(file, 'utf8'));
            const registryPaths = options.registry ? options.registry.split(',') : undefined;

            try {
                // Let nejyScan handle the loading and printing via loadSetup
                await nejyScan(prog, options.policy, registryPaths);
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
        .option('-r, --registry <registry>', 'Comma separated list of registry files')
        .action(async (file, options) => {
            const prog = YAML.parse(fs.readFileSync(file, 'utf8'));
            const registryPaths = options.registry ? options.registry.split(',') : undefined;

            try {
                 // Let nejyRun handle the loading and printing via loadSetup
                 const { errorMsg, result, usage } = await nejyRun(prog, options.policy, registryPaths);

                 if (errorMsg) {
                     if (errorMsg === "HARD_STOP" || errorMsg === "QUOTA_EXCEEDED") {
                         console.error(`❌ Fatal Error: ${errorMsg}`);
                     }
                     processOutput(errorMsg, null, usage);
                     process.exit(1);
                 } else {
                     processOutput(null, result, usage);
                     process.exit(0);
                 }
            } catch (e) {
                console.error(`❌ ${e.message}`);
                process.exit(1);
            }
        });

    program.parse(process.argv);
}

// Execute CLI if run as main module
if (
    process.argv[1] === __filename ||
    (process.argv[1] && process.argv[1].endsWith('nejy'))
) {
    runCLI();
}
