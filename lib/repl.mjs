import readline from 'node:readline/promises';
import process from 'node:process';
import chalk from 'chalk';
import YAML from 'yaml';
import { createNejyContext } from '../nejy.mjs';
import { run, commands } from './interp/commands.mjs';
import { buildMods } from './buildMods.mjs';
import ResourceMonitor from '../monitor/index.js';

function getTheme(options) {
    if (options.dark) {
        return { prompt: chalk.cyan, success: chalk.green, error: chalk.red, var: chalk.magenta, cmd: chalk.blue, dim: chalk.gray };
    }
    if (options.bright) {
        return { prompt: chalk.magentaBright, success: chalk.greenBright, error: chalk.redBright, var: chalk.cyanBright, cmd: chalk.yellowBright, dim: chalk.white };
    }
    if (options.contrast) {
        return { prompt: chalk.bgBlack.white.bold, success: chalk.bgGreen.black, error: chalk.bgRed.white, var: chalk.bgMagenta.white, cmd: chalk.bgBlue.white, dim: chalk.blackBright };
    }
    return { prompt: chalk.cyan, success: chalk.green, error: chalk.red, var: chalk.magenta, cmd: chalk.blue, dim: chalk.gray };
}

function countUnbalancedBrackets(str) {
    let brackets = 0;
    let braces = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (char === '\\') {
            escape = true;
            continue;
        }
        if (char === '"' || char === "'") {
            if (!inString) inString = char;
            else if (inString === char) inString = false;
            continue;
        }
        if (!inString) {
            if (char === '[') brackets++;
            if (char === ']') brackets--;
            if (char === '{') braces++;
            if (char === '}') braces--;
        }
    }
    return { brackets, braces };
}

export async function startREPL(format, options) {
    const theme = getTheme(options);

    console.log(theme.success(`Starting nejy REPL (${format} mode)`));
    console.log(theme.dim(`Policy: ${options.policy || 'LOW'}`));
    console.log(theme.dim(`Type .help for instructions, .reset to clear context, .exit to quit.`));


    const { policy, registryEntries, scanner } = await createNejyContext(options.policy || 'LOW', options.registry ? options.registry.split(',') : undefined);

    // Initial mods build (empty requestList)
    let mods = await buildMods(registryEntries, policy.maxRisk ?? 'LOW', scanner.requestList);
    let mon = new ResourceMonitor(policy.quotas);
    if (mods.fs) mon.instrumentFs(mods.fs);

    let ctx = {
        mods,
        vars: { "$ERROR": null, "$ITEM": null, "$USAGE": null, "$INPUT": null, "$RETURN": null },
        mon,
        scanner,
        history: [],
        child_log: [],
    };

    let nejyState = { policy, registryEntries, scanner, ctx, mon };

    let buffer = '';
    let showVars = false;
    let showTime = false;

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: (line) => {
            const isBufferEmpty = !buffer || buffer.trim() === '';
            const isLineEmpty = !line || line.trim() === '';
            const dotCommands = [".help", ".exit", ".quit", ".reset", ".vars", ".time"];

            if (isBufferEmpty && isLineEmpty) {
                const startChar = format === 'json' ? '[' : '-';
                const completions = [startChar, ...dotCommands];
                return [completions, line];
            }

            if (isBufferEmpty && line.startsWith('.')) {
                const hits = dotCommands.filter(c => c.startsWith(line));
                return [hits.length ? hits : dotCommands, line];
            }

            const words = line.split(/[ \n\[\]"'-]+/);
            const currentWord = words[words.length - 1];

            let completions = [...Object.keys(commands), ...dotCommands];

            // Add ctx variables starting with $
            if (nejyState && nejyState.ctx) {
                completions.push(...Object.keys(nejyState.ctx.vars).filter(k => k.startsWith('$')));

                // Add simple module completions
                if (currentWord.includes('.')) {
                    const parts = currentWord.split('.');
                    const path = parts.slice(0, -1).join('.'); // everything before the last dot

                    let baseObj = undefined;
                    if (path.startsWith('$')) {
                        const rootVar = parts[0];
                        baseObj = nejyState.ctx.vars[rootVar];
                        for (let i = 1; i < parts.length - 1; i++) {
                            if (baseObj !== undefined && baseObj !== null) {
                                baseObj = baseObj[parts[i]];
                            }
                        }
                    } else if (nejyState.ctx.mods[parts[0]]) {
                        baseObj = nejyState.ctx.mods[parts[0]];
                        for (let i = 1; i < parts.length - 1; i++) {
                            if (baseObj !== undefined && baseObj !== null) {
                                baseObj = baseObj[parts[i]];
                            }
                        }
                    }

                    if (baseObj !== undefined && baseObj !== null) {
                        const modPrefix = path + '.';
                        let props = new Set();
                        let currentObj = baseObj;
                        while (currentObj && currentObj !== Object.prototype) {
                            try {
                                Object.getOwnPropertyNames(currentObj).forEach(prop => props.add(prop));
                            } catch (e) {}
                            currentObj = Object.getPrototypeOf(currentObj);
                        }
                        completions.push(...Array.from(props).map(p => modPrefix + p));
                    }
                } else {
                     completions.push(...Object.keys(nejyState.ctx.mods));
                }
            }

            const hits = completions.filter((c) => c.startsWith(currentWord));
            return [hits.length ? hits : completions, currentWord];
        }
    });

    let showTime = false;
    const mainPrompt = theme.prompt('nejy> ');
    const contPrompt = theme.prompt('... ');

    rl.setPrompt(mainPrompt);
    rl.prompt();

    rl.on('line', async (line) => {
        const trimmed = line.trim();

        // Handle special REPL commands if it's the start of a command
        if (buffer === '') {
            if (trimmed === '.exit' || trimmed === '.quit') {
                process.exit(0);
            }
            if (trimmed === '.help') {
                console.log(theme.dim(`Special commands:`));
                console.log(theme.cmd(`  .exit / .quit `) + `- Exit the REPL`);
                console.log(theme.cmd(`  .reset        `) + `- Reset the execution context`);
                console.log(theme.cmd(`  .vars         `) + `- Toggle display of ctx.vars after execution`);
                console.log(theme.cmd(`  .time         `) + `- Toggle display of CPU execution time`);
                console.log(theme.cmd(`  .help         `) + `- Show this help message\n`);
                console.log(theme.dim(`Input format is currently `) + format.toUpperCase());
                if (format === 'json') {
                     console.log(theme.dim(`Commands are evaluated when JSON brackets [] are balanced.`));
                } else {
                     console.log(theme.dim(`Commands are evaluated on a blank line.`));
                }
                rl.prompt();
                return;
            }

            if (trimmed === '.vars') {
                showVars = !showVars;
                console.log(theme.dim(`.vars is now ${showVars ? 'ON' : 'OFF'}`));
                rl.prompt();
                return;
            }
            if (trimmed === '.time') {
                showTime = !showTime;
                console.log(theme.dim(`.time is now ${showTime ? 'ON' : 'OFF'}`));
                rl.prompt();
                return;
            }
            if (trimmed === '.reset') {
                try {
                    const { policy, registryEntries, scanner } = await createNejyContext(options.policy || 'LOW', options.registry ? options.registry.split(',') : undefined);
                    let mods = await buildMods(registryEntries, policy.maxRisk ?? 'LOW', scanner.requestList);
                    let mon = new ResourceMonitor(policy.quotas);
                    if (mods.fs) mon.instrumentFs(mods.fs);

                    nejyState = {
                        policy, registryEntries, scanner, mon,
                        ctx: {
                            mods,
                            vars: { "$ERROR": null, "$ITEM": null, "$USAGE": null, "$INPUT": null, "$RETURN": null },
                            mon,
                            scanner,
                            history: [],
                            child_log: [],
                        }
                    };
                    console.log(theme.success('Context reset.'));

                } catch (e) {
                    console.error(theme.error(`Reset failed: ${e.message}`));
                }
                rl.prompt();
                return;
            }
        }

        // Add to buffer
        buffer += line + '\n';

        // Check if command is complete
        let isComplete = false;

        if (format === 'json') {
            if (trimmed === '') {
                 // Empty lines in JSON don't necessarily execute, but let's allow it if buffer only has whitespace
                 if (buffer.trim() === '') {
                     buffer = '';
                     rl.setPrompt(mainPrompt);
                     rl.prompt();
                     return;
                 }
            }

            const counts = countUnbalancedBrackets(buffer);
            if (counts.brackets <= 0 && counts.braces <= 0 && buffer.trim() !== '') {
                isComplete = true;
            }
        } else {
            // yaml format
            if (trimmed === '') {
                isComplete = true;
            }
        }

        if (isComplete && buffer.trim() !== '') {
            let parsedSteps;
            try {
                if (format === 'json') {
                     parsedSteps = JSON.parse(buffer);
                } else {
                     parsedSteps = YAML.parse(buffer);
                }


                // Wrap in array if single step object or single step array
                if (!Array.isArray(parsedSteps)) {
                    parsedSteps = [parsedSteps];
                } else if (parsedSteps.length > 0 && !Array.isArray(parsedSteps[0])) {
                    // It's a 1D array like ["SET", "$A", 10] or ["console.log", ["Hello"]]
                    parsedSteps = [parsedSteps];
                }


            } catch (e) {
                console.error(theme.error(`Parse Error: ${e.message}`));
                buffer = '';
                rl.setPrompt(mainPrompt);
                rl.prompt();
                return;
            }


            try {
                // Dynamically scan the new steps
                const scannedProg = (await nejyState.scanner.scan(parsedSteps)) ?? parsedSteps;


                // Rebuild mods in case new capabilities were requested
                nejyState.ctx.mods = await buildMods(nejyState.registryEntries, nejyState.policy.maxRisk ?? 'LOW', nejyState.scanner.requestList);
                if (nejyState.ctx.mods.fs) nejyState.mon.instrumentFs(nejyState.ctx.mods.fs);

                // Run the parsed steps
                nejyState.ctx.vars["$RETURN"] = undefined; // Reset return

                const startCpu = showTime ? process.cpuUsage() : null;

                await run(scannedProg, nejyState.ctx, false);

                if (showTime) {
                    const diff = process.cpuUsage(startCpu);
                    const cpuMs = (diff.user + diff.system) / 1000;

                    nejyState.mon.checkResources(); // Make sure mon.usage is updated
                    const currentTotalMs = nejyState.mon.usage.cpuMs;
                    const maxCpu = nejyState.mon.quotas.maxCpuMs;
                    const remaining = maxCpu === Infinity ? 'Infinity' : (maxCpu - currentTotalMs).toFixed(2);

                    console.log(theme.dim(`⏱️  Step CPU: ${cpuMs.toFixed(2)}ms | Remaining Policy CPU: ${remaining}ms`));
                }

                if (showVars) {
                    const safeVars = {};
                    for (const [k, v] of Object.entries(nejyState.ctx.vars)) {
                        let repr;
                        try {
                           repr = format === 'json' ? JSON.stringify(v) : YAML.stringify(v);
                        } catch (e) {
                           repr = String(v);
                        }
                        if (repr && repr.length > 200) {
                            safeVars[k] = repr.substring(0, 197) + '...';
                        } else {
                            safeVars[k] = v;
                        }
                    }
                    console.log(theme.dim(`-- vars --`));
                    console.log(theme.var(format === 'json' ? JSON.stringify(safeVars, null, 2) : YAML.stringify(safeVars).trim()));
                    console.log(theme.dim(`----------`));
                }

                // Log the result
                // Log the result
                const result = nejyState.ctx.vars["$RETURN"];
                if (result !== undefined && result !== null) {
                    let formattedResult;
                    if (typeof result === 'object') {
                        formattedResult = format === 'json' ? JSON.stringify(result, null, 2) : YAML.stringify(result).trim();
                    } else {
                        formattedResult = String(result);
                    }
                    console.log(theme.var(`$RETURN: `) + theme.success(formattedResult));
                } else {
                    console.log(theme.dim('✅ step ok'));
                }

            } catch (e) {
                console.error(theme.error(`Execution Error: ${e.message}`));
            }

            buffer = '';
            rl.setPrompt(mainPrompt);
        } else if (buffer.trim() !== '') {
            rl.setPrompt(contPrompt);
        } else {
            buffer = '';
            rl.setPrompt(mainPrompt);
        }

        rl.prompt();
    });

    rl.on('close', () => {
        console.log(theme.dim('\nExiting nejy REPL.'));
        process.exit(0);
    });
}
