import { pathInRequest, effectiveRisk } from '../buildMods.mjs';
import { commands } from './commands.mjs';

const HANDLED_COMMANDS = new Set([
    "EXEC", "NEW", "PIPE", "LITERAL", "IF", "FOR_EACH", "TRY", "DEF", "TO", "SANDBOX", "SET", "CALL", "REQUEST"
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
        if (data[0] === "LITERAL" && data.length === 2) {
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
        for (const step of steps) {
            if (!Array.isArray(step)) continue;
            const [path, args = []] = step;

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
                this.checkPath(path);
            } else {
                 // It IS a known command. We verify it's covered by the specific
                 // logic below so we don't accidentally skip scanning its branches if someone adds a new command.
                 if (!HANDLED_COMMANDS.has(path)) {
                      throw new Error(`SEC_BLOCK: Unhandled interpreter command '${path}' in scanner`);
                 }
            }

            // Scan step arguments for inline LITERAL definitions to ensure prototype safety.
            checkDataForLiterals(args);

            // For EXEC and NEW, check the explicit target callable path.
            if ((path === "EXEC" || path === "NEW") && Array.isArray(args) && typeof args[0] === 'string') {
                this.checkPath(args[0]);
            }

            // For PIPE, check string-shorthand step targets.
            if (path === "PIPE" && Array.isArray(args)) {
                for (const pipeStep of args) {
                    if (typeof pipeStep === 'string') {
                        if (!pipeStep.startsWith('$')) this.checkPath(pipeStep);
                    } else if (Array.isArray(pipeStep)) {
                        await this.analyze([pipeStep]);
                    }
                }
            }

            if (path === "LITERAL") {
                if (this.riskMap["LOW"] > this.currentRisk)
                    throw new Error(`SEC_BLOCK: 'LITERAL' requires LOW risk (Manifest: ${this.manifest.maxRisk})`);
                // Note: checkDataForLiterals(args) already called above will handle inline arrays.
                // The root-level args object for a LITERAL command is also a literal value.
                checkNoPrototypePollution(args);
            }

            // Explicitly recurse into code branches only — NOT into data args.
            // The old generic filter(Array.isArray) treated data arrays (e.g. SET values,
            // EXEC arg arrays) as code, causing false positives under strict registry checking.
            switch (path) {
                case 'IF':
                    // cond may be an inline step array; t and f are step-arrays (branches)
                    if (Array.isArray(args[0])) await this.analyze([args[0]]);  // cond as inline step
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
                case 'DEF':
                    if (Array.isArray(args[1])) await this.analyze(args[1]);    // function body
                    break;
                case 'TO': {
                    // Same disambiguation as the interpreter: string-first = single step, else block
                    const code = args[1];
                    if (Array.isArray(code)) {
                        if (typeof code[0] === 'string') await this.analyze([code]);  // single step
                        else await this.analyze(code);                                // block of steps
                    }
                    break;
                }
                case 'SANDBOX': {
                    const [initOpts, subprogram] = args;
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
            // PIPE: already fully handled in the explicit PIPE block above.
            // EXEC, NEW, SET, CALL: args are data — no branch recursion.
        }
    }
}
