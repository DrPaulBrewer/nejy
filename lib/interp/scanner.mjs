import { pathInRequest, effectiveRisk } from '../buildMods.mjs';
import { commands } from './commands.mjs';
import { processFormalArg } from './context.mjs';

const HANDLED_COMMANDS = new Set([
    "EXEC", "NEW", "LITERAL", "IF", "FOR_EACH", "TRY", "F", "MATH", "SANDBOX", "SET", "REQUEST", "CHILD", "AWAIT"
]);

export function checkNoPrototypePollution(obj) {
    if (obj && typeof obj === 'object') {
        const keys = Object.getOwnPropertyNames(obj);
        if (keys.includes('__proto__') || keys.includes('prototype') || keys.includes('constructor')) {
            throw new Error("SEC_BLOCK: LITERAL contains blocked prototype property");
        }
        for (const key of Object.keys(obj)) {
            checkNoPrototypePollution(obj[key]);
        }
    }
}

export function checkDataForLiterals(data) {
    if (Array.isArray(data)) {
        if (data[0] === "LITERAL" && data.length >= 2) {
            checkNoPrototypePollution(data[1]);
            return; // Don't recurse into literal's internals as they are data
        }
        for (const item of data) {
            checkDataForLiterals(item);
        }
    } else if (data && typeof data === 'object') {
        for (const val of Object.values(data)) {
            checkDataForLiterals(val);
        }
    }
}

export class SecurityScanner {
    /**
     * @param {object}   manifest        - parsed manifest JSON (has maxRisk)
     * @param {object[]} registryEntries - flat array of parsed registry entries from loadRegistry()
     */
    constructor(manifest, registryEntries = []) {
        this.manifest = manifest;
        this.riskMap = { "LOW": 0, "MEDIUM": 1, "HIGH": 2, "INSANE": 3 };
        this.currentRisk = this.riskMap[manifest.maxRisk || "LOW"];
        this.registryEntries = registryEntries;
        this.requestList = null; // set by scan() when program begins with REQUEST
        this.definedFunctions = new Set();
    }

    async scan(program) {
        if (this.currentRisk >= 3) return program; // INSANE skips scan

        this.requestList = null;
        let steps = program;

        // If the program begins with REQUEST, extract and validate it.
        // REQUEST must be the literal first step; its argument must be a literal list.
        if (Array.isArray(program) && program.length > 0 &&
            Array.isArray(program[0]) && program[0][0] === 'REQUEST') {
            const reqArgs = program[0][1];
            if (!Array.isArray(reqArgs))
                throw new Error(`SEC_BLOCK: REQUEST argument must be a literal list`);
            for (const req of reqArgs) {
                if (typeof req !== 'string')
                    throw new Error(`SEC_BLOCK: REQUEST items must be strings`);
                this.checkPath(req, true); // validate within maxRisk; skip subset check
            }
            this.requestList = reqArgs;
            steps = program.slice(1); // scan the body after REQUEST
        }

        await this.analyze(steps);
        return steps;
    }

    /**
     * Return the required risk level for a callable path string.
     * Delegates to effectiveRisk() against the registry.
     * $-prefixed paths (variable method calls) can’t be verified statically — treated as LOW.
     * Paths missing from the registry are treated as INSANE (unknown = blocked by default).
     */
    riskOf(pathStr) {
        if (typeof pathStr !== 'string') return "LOW";
        // Variable method calls (e.g. $dateObj.toISOString) — can’t verify statically.
        if (pathStr.startsWith('$')) return "LOW";
        // Registry lookup; null = not in registry = INSANE.
        return effectiveRisk(pathStr, this.registryEntries) ?? "INSANE";
    }

    checkPath(pathStr, skipRequestCheck = false) {
        if (typeof pathStr !== 'string') return;
        // Prototype-chain attacks are always blocked (also caught by resolvePath at runtime).
        if (/prototype|__proto__|constructor/.test(pathStr))
            throw new Error(`SEC_BLOCK: Illegal access pattern in '${pathStr}'`);
        const required = this.riskOf(pathStr);
        if (this.riskMap[required] > this.currentRisk)
            throw new Error(`SEC_BLOCK: '${pathStr}' requires ${required} risk (Manifest: ${this.manifest.maxRisk})`);
        // REQUEST enforcement: when a REQUEST is declared, all callable paths must be in it.
        // $-prefixed paths are runtime variable method calls — cannot be verified statically.
        if (!skipRequestCheck && this.requestList !== null && !pathStr.startsWith('$')) {
            if (!pathInRequest(pathStr, this.requestList))
                throw new Error(`SEC_BLOCK: '${pathStr}' was not declared in this program's REQUEST`);
        }
    }

    async analyze(steps) {
        if (!Array.isArray(steps)) return;
        const returnSet = new Set();

        for (const step of steps) {
            if (!Array.isArray(step)) continue;
            const [path, args = [], thirdArg] = step;

            // REQUEST is only valid as the first step of the top-level program.
            // scan() strips it before calling analyze(), so any REQUEST still present
            // here must be misplaced (inside a DEF body, IF branch, etc.) — block it.
            if (path === 'REQUEST') {
                throw new Error(`SEC_BLOCK: REQUEST must be the first command of the program`);
            }

            // Named interpreter commands are exempt from registry risk checks.
            // Non-command paths are shorthand callables (e.g. ["math.evaluate", [...]]).
            // If it is a known command, we must ensure it is handled specifically below,
            // otherwise it would bypass security scanning of its arguments!
            if (!(path in commands)) {
                if (typeof path === 'string' && path.startsWith(' ')) {
                    this.checkPath('math.evaluate');
                    if (thirdArg && typeof thirdArg === 'string') this.checkPath(thirdArg.startsWith('$') ? thirdArg : `$${thirdArg}`);
                } else {
                    this.checkPath(path);
                    if (thirdArg && typeof thirdArg === 'string') this.checkPath(thirdArg.startsWith('$') ? thirdArg : `$${thirdArg}`);
                }
            } else {
                 // It IS a known command. We verify it's covered by the specific
                 // logic below so we don't accidentally skip scanning its branches if someone adds a new command.
                 if (!HANDLED_COMMANDS.has(path)) {
                      throw new Error(`SEC_BLOCK: Unhandled interpreter command '${path}' in scanner`);
                 }
            }

            // Centralized dest check helper for prototype pollution and single-RETURN heuristic
            const checkDest = (destVar) => {
                if (typeof destVar === 'string') {
                    const destKey = destVar.startsWith('$') ? destVar : `$${destVar}`;
                    this.checkPath(destKey); // catches PP like $__proto__
                    if (destKey === '$RETURN' || destKey === 'RETURN') {
                        if (returnSet.has('$RETURN')) {
                            throw new Error(`SEC_BLOCK: $RETURN variable may only be targeted once per execution block`);
                        }
                        returnSet.add('$RETURN');
                    }
                }
            };

            // Scan step arguments for inline LITERAL definitions to ensure prototype safety.
            checkDataForLiterals(args);

            // For EXEC and NEW, check the explicit target callable path.
            if ((path === "EXEC" || path === "NEW") && Array.isArray(args) && typeof args[0] === 'string') {
                this.checkPath(args[0]);
            }

            if (path === "EXEC") {
                // EXEC thirdArg logic (destination/decorators)
                const tArg = thirdArg !== undefined ? thirdArg : (Array.isArray(args) ? args[2] : undefined);
                if (typeof tArg === 'string') checkDest(tArg);
                else if (tArg && typeof tArg === 'object') {
                    if (tArg.into) checkDest(tArg.into);
                    if (tArg.promise) checkDest(tArg.promise);
                    if (tArg.chain && Array.isArray(tArg.chain)) {
                        for (const [method, chainArgs] of tArg.chain) {
                            if (typeof method === 'string') {
                                if (/prototype|__proto__|constructor/.test(method)) {
                                    throw new Error(`SEC_BLOCK: Illegal access pattern in '${method}'`);
                                }
                            }
                            if (chainArgs) checkDataForLiterals(chainArgs);
                        }
                    }
                    if (tArg.compose && Array.isArray(tArg.compose)) {
                        for (const cStep of tArg.compose) {
                            const [fnPath, extraArgs] = Array.isArray(cStep) ? cStep : [cStep, []];
                            if (typeof fnPath === 'string') this.checkPath(fnPath);
                            if (extraArgs) checkDataForLiterals(extraArgs);
                        }
                    }
                }
            }

            if (path === "LITERAL") {
                if (this.riskMap["LOW"] > this.currentRisk)
                    throw new Error(`SEC_BLOCK: 'LITERAL' requires LOW risk (Manifest: ${this.manifest.maxRisk})`);
                // args might be the object itself, not an array.
                checkNoPrototypePollution(args);
                if (thirdArg !== undefined) checkDest(thirdArg);
            }

            if (path === "NEW" && Array.isArray(args) && args[2] !== undefined) {
                checkDest(args[2]);
            }

            // Explicitly recurse into code branches only — NOT into data args.
            // The old generic filter(Array.isArray) treated data arrays (e.g. SET values,
            // EXEC arg arrays) as code, causing false positives under strict registry checking.
            switch (path) {
                case 'AWAIT':
                    if (Array.isArray(args) && args[1]) checkDest(args[1]);
                    break;
                case 'IF':
                    // cond may be an inline step array; t and f are step-arrays (branches)
                    if (Array.isArray(args[1])) await this.analyze(args[1]);    // true branch
                    if (Array.isArray(args[2])) await this.analyze(args[2]);    // false branch
                    break;
                case 'FOR_EACH':
                    if (Array.isArray(args[1])) await this.analyze(args[1]);    // loop body
                    break;
                case 'TRY':
                    if (Array.isArray(args[0])) await this.analyze(args[0]);    // try block
                    if (Array.isArray(args[1])) await this.analyze(args[1]);    // catch block
                    break;
                case 'F':
                    if (args[0] && typeof args[0] === 'string') {
                        // Function name is safe enough here as literal or string, but check for PP
                        if (/prototype|__proto__|constructor/.test(args[0])) {
                            throw new Error(`SEC_BLOCK: Illegal function name '${args[0]}'`);
                        }
                        this.definedFunctions.add(args[0]);
                        this.definedFunctions.add(args[0].startsWith('$') ? args[0] : `$${args[0]}`);
                    }
                    if (Array.isArray(args[1])) {
                        const formalArgs = args[1];
                        for (let i = 0; i < formalArgs.length; i++) {
                            const arg = formalArgs[i];
                            if (typeof arg === 'string' && arg.toLowerCase() === 'all functions') {
                                if (i !== formalArgs.length - 1) {
                                    throw new Error("Command parsing error: 'all Functions' must be the last parameter");
                                }
                            } else {
                                processFormalArg(arg, true, 'F');
                            }
                        }
                    }
                    if (Array.isArray(args[2])) await this.analyze(args[2]);    // function body
                    break;
                case 'MATH':
                    if (this.riskMap["LOW"] > this.currentRisk) {
                        throw new Error(`SEC_BLOCK: 'MATH' requires LOW risk (Manifest: ${this.manifest.maxRisk})`);
                    }
                    if (args[0] && typeof args[0] === 'string') {
                        if (/prototype|__proto__|constructor/.test(args[0])) {
                            throw new Error(`SEC_BLOCK: Illegal function name '${args[0]}'`);
                        }
                        this.definedFunctions.add(args[0]);
                        this.definedFunctions.add(args[0].startsWith('$') ? args[0] : `$${args[0]}`);
                    }
                    if (Array.isArray(args[1])) {
                        for (const formalArg of args[1]) {
                            // In static analysis, MATH scanner historically throws SEC_BLOCK for both invalid argument types and references
                            processFormalArg(formalArg, false, 'MATH');
                        }
                    }
                    break;
                case 'CHILD':
                    if (args[0] && typeof args[0] === 'string') {
                        if (!this.definedFunctions.has(args[0])) {
                            throw new Error(`Link Error: Function '${args[0]}' not found among previously-declared functions for CHILD command`);
                        }
                        if (!args[0].startsWith('$')) {
                           this.checkPath(`$${args[0]}`);
                        } else {
                           this.checkPath(args[0]);
                        }
                    } else {
                        throw new Error(`SEC_BLOCK: CHILD command target must be a literal string`);
                    }
                    if (Array.isArray(args) && args[2]) checkDest(args[2]);
                    break;
                case 'SET': {
                    if (args[0] && typeof args[0] === 'string') {
                        checkDest(args[0]);
                    }
                    break;
                }
                case 'SANDBOX': {
                    const [initOpts, subprogram, sDest] = Array.isArray(args) ? args : [];
                    if (sDest) checkDest(sDest);
                    if (!Array.isArray(subprogram)) continue;

                    let childPolicy = this.manifest.maxRisk;
                    let childCapabilities = this.requestList; // null means full capabilities of manifest

                    if (initOpts !== 'copy') {
                        if (initOpts.policy) {
                            const childRisk = this.riskMap[initOpts.policy] ?? 3; // default INSANE if invalid
                            if (childRisk > this.currentRisk) {
                                throw new Error(`SEC_BLOCK: SANDBOX policy '${initOpts.policy}' exceeds parent policy '${this.manifest.maxRisk}'`);
                            }
                            childPolicy = initOpts.policy;
                        }
                        if (initOpts.capabilities && Array.isArray(initOpts.capabilities)) {
                            for (const req of initOpts.capabilities) {
                                if (typeof req !== 'string') throw new Error(`SEC_BLOCK: SANDBOX capabilities must be strings`);
                                // Validate capability is within the PARENT's allowed capabilities
                                this.checkPath(req, false);
                            }
                            childCapabilities = initOpts.capabilities;
                        } else if (!initOpts.capabilities) {
                            childCapabilities = []; // {} means NO capabilities (unless 'copy' used)
                        }
                    }

                    const childScanner = new SecurityScanner(
                        { ...this.manifest, maxRisk: childPolicy },
                        this.registryEntries
                    );
                    childScanner.requestList = childCapabilities;
                    await childScanner.analyze(subprogram);
                    break;
                }
            }
        }
    }
}
