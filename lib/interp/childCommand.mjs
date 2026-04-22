import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { resolveArgs } from './context.mjs';

export async function handleChildCommand([funcName, rawArgs, dest], ctx, em) {
    if (!ctx.child_log) {
        ctx.child_log = [];
    }
    if (!dest) {
        throw new Error(`CHILD: a destination variable name is required (e.g. [CHILD, [funcName, args, myVar]])`);
    }

    const actualArgs = resolveArgs(rawArgs || [], ctx);

    // 1. Find function definition in history to perform object deconstruction matching
    let formalArgs = [];
    let funcFound = false;
    if (ctx.history && Array.isArray(ctx.history)) {
        for (let i = ctx.history.length - 1; i >= 0; i--) {
            const histItem = ctx.history[i];
            if ((histItem[0] === 'F' || histItem[0] === 'MATH') && histItem[1][0] === funcName) {
                formalArgs = histItem[1][1];
                funcFound = true;
                break;
            }
        }
    }

    if (!funcFound) {
        throw new Error(`Link Error: Target function '${funcName}' has not been executed and registered in the runtime history.`);
    }

    // Map actual parameters based on formal arguments to subset
    const subsettedArgs = [];
    for (let i = 0; i < actualArgs.length; i++) {
        const formalArg = formalArgs[i];
        const actualArg = actualArgs[i];

        if (formalArg && typeof formalArg === 'object' && actualArg && typeof actualArg === 'object') {
            const subsetObj = {};
            for (const key of Object.keys(formalArg)) {
                if (actualArg[key] !== undefined) {
                    subsetObj[key] = actualArg[key];
                }
            }
            subsettedArgs.push(subsetObj);
        } else {
            subsettedArgs.push(actualArg);
        }
    }

    // 2. Assemble the nejy script for the child
    const childScript = [];
    if (ctx.history && Array.isArray(ctx.history)) {
        for (const item of ctx.history) {
            childScript.push(item);
        }
    }

    const targetFuncName = funcName.startsWith('$') ? funcName : `$${funcName}`;
    childScript.push(["EXEC", [targetFuncName, subsettedArgs]]);
    const childScriptYAML = YAML.stringify(childScript);

    // 3. Resolve parent policy and capabilities
    const policy = ctx.scanner ? ctx.scanner.manifest.maxRisk : 'LOW';
    const capabilities = ctx.scanner ? ctx.scanner.requestList : null;

    const promise = new Promise((resolve, reject) => {
        const nejyPath = fileURLToPath(new URL('../../nejy.mjs', import.meta.url));

        const inlineCode = `
import { nejyRun } from '${nejyPath}';
import YAML from 'yaml';

async function readAllStdin() {
    let result = '';
    for await (const chunk of process.stdin) {
        result += chunk;
    }
    return result;
}

(async () => {
    const payloadStr = await readAllStdin();
    const payload = YAML.parse(payloadStr);

const policy = '${policy}';
const registryPaths = undefined; // Use default registry

if (${capabilities !== null}) {
    const caps = ${JSON.stringify(capabilities)};
    if (caps && caps.length > 0) {
        payload.unshift(['REQUEST', caps]);
    }
}

    const { errorMsg, result, usage } = await nejyRun(payload, policy, registryPaths);

    console.log("\`\`\`yaml");
    console.log(YAML.stringify([errorMsg, result, usage]).trim());
    console.log("\`\`\`");

    process.exit(errorMsg ? 1 : 0);
})().catch(err => {
    console.error(err);
    process.exit(1);
});
`;

        const child = spawn(process.execPath, ['--input-type=module', '-e', inlineCode], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdoutData = '';
        let stderrData = '';

        child.stdout.on('data', chunk => {
            stdoutData += chunk;
        });

        child.stderr.on('data', chunk => {
            stderrData += chunk;
        });

        child.on('error', (err) => {
            reject(new Error("CHILD process error: " + err.message));
        });

        child.stdin.on('error', (err) => {
            // Ignore EPIPE errors on stdin (if child exits prematurely)
            if (err.code !== 'EPIPE') {
                console.error("CHILD stdin error:", err);
            }
        });

        child.on('close', code => {
            try {
                const blockMatch = stdoutData.match(/\`\`\`yaml([\s\S]*?)\`\`\`/);
                let yamlContent = '';
                if (blockMatch && blockMatch[1]) {
                    yamlContent = blockMatch[1].trim();
                } else {
                    console.error("Child stderr:", stderrData);
                    console.error("Child stdout:", stdoutData);
                    return reject(new Error("CHILD command failed: Could not find yaml block in child stdout"));
                }

                const parsed = YAML.parse(yamlContent);
                if (!Array.isArray(parsed) || parsed.length !== 3) {
                    return reject(new Error("CHILD command failed: Invalid yaml result format from child"));
                }

                const [error, result, usage] = parsed;

                ctx.child_log.push({
                    time: Date.now(),
                    funcname: funcName,
                    usage: usage
                });

                if (error) {
                    reject(new Error(error));
                } else {
                    resolve(result);
                }
            } catch (err) {
                reject(new Error("CHILD command failed to parse child output: " + err.message));
            }
        });

        child.stdin.write(childScriptYAML);
        child.stdin.end();
    });

    const destKey = dest.startsWith('$') ? dest : `$${dest}`;
    ctx.vars[destKey] = promise;
}
