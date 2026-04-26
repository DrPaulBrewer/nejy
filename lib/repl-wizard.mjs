/**
 * lib/repl-wizard.mjs
 * Interactive step-builder wizard for the nejy REPL, powered by @clack/prompts.
 */
import * as p from '@clack/prompts';
import YAML from 'yaml';
import JSON5 from 'json5';

// ─── Lenient JSON/JSON5 parser ────────────────────────────────────────────────

const JSON_KEYWORDS = new Set(['true', 'false', 'null']);

/**
 * Progressively tries to parse a string as JSON, JSON5, then applies a
 * best-effort fix for bare-word string values before trying JSON5 again.
 * Falls back to returning the raw string if nothing works.
 */
export function lenientParse(str) {
    if (typeof str !== 'string') return str;
    const trimmed = str.trim();
    if (!trimmed) return undefined;

    // 1. Standard JSON
    try { return JSON.parse(trimmed); } catch {}

    // 2. JSON5 (handles unquoted keys, single quotes, trailing commas)
    try { return JSON5.parse(trimmed); } catch {}

    // 3. Fix bare-word string values (e.g. {b:no} → {"b":"no"}) then JSON5
    try {
        const fixed = trimmed.replace(
            /([:{[,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*(?=[,}\]]))/g,
            (match, pre, word, post) => {
                if (JSON_KEYWORDS.has(word)) return match;
                return `${pre}"${word}"${post}`;
            }
        );
        return JSON5.parse(fixed);
    } catch {}

    // 4. Raw string fallback
    return str;
}

// ─── Command descriptor table ─────────────────────────────────────────────────

export const COMMAND_DESCRIPTORS = {
    SET:          { label: 'SET',                      hint: 'Assign a value to a variable' },
    EXEC:         { label: 'EXEC',                     hint: 'Call a function or method, optionally storing the result' },
    F:            { label: 'F',                        hint: 'Define a reusable Nejy function (stored in ctx.vars)' },
    MATH:         { label: 'MATH',                     hint: 'Compile a mathjs expression into a fast JS function' },
    FOR_EACH:     { label: 'FOR_EACH',                 hint: 'Loop over an array or N times ($ITEM set each iteration)' },
    IF:           { label: 'IF',                       hint: 'Conditional branch (true/false sub-programs)' },
    TRY:          { label: 'TRY',                      hint: 'Execute steps with error handling (try/catch blocks)' },
    SANDBOX:      { label: 'SANDBOX',                  hint: 'Run a sub-program in an isolated context with restricted policy' },
    CHILD:        { label: 'CHILD',                    hint: 'Run a Nejy F-function asynchronously in a child process (HIGH/INSANE only)' },
    AWAIT:        { label: 'AWAIT',                    hint: 'Wait for a promise variable to resolve' },
    NEW:          { label: 'NEW',                      hint: 'Instantiate a class/constructor (like JS new)' },
    LITERAL:      { label: 'LITERAL',                  hint: 'Inject a raw value without $variable resolution' },
    REQUEST:      { label: 'REQUEST',                  hint: 'Declare capability requirements for the security scanner' },
    implicit_exec:{ label: 'implicit EXEC (path args)', hint: 'Shorthand: ["module.method", [args], "dest"] — no EXEC keyword' },
    implicit_math:{ label: 'implicit MATH (" expr")',  hint: 'Shorthand: [" math expr", [], "$dest"] — leading space = math mode' },
};

// Subprogram slot positions per command (which array positions hold sub-programs)
export const SUBPROGRAM_SLOTS = {
    F:        [{ path: [1, 2], label: 'function body steps' }],
    FOR_EACH: [{ path: [1, 1], label: 'loop body steps' }],
    IF:       [{ path: [1, 1], label: 'true branch steps' }, { path: [1, 2], label: 'false branch steps (optional)' }],
    TRY:      [{ path: [1, 0], label: 'try block steps' },   { path: [1, 1], label: 'catch block steps (optional)' }],
    SANDBOX:  [{ path: [1, 1], label: 'sandbox body steps' }],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDeep(obj, path) {
    return path.reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

function setDeep(obj, path, value) {
    // Deep-clone via JSON to avoid mutating the original
    const clone = JSON.parse(JSON.stringify(obj));
    let cur = clone;
    for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
    cur[path[path.length - 1]] = value;
    return clone;
}

export function formatStep(step, format) {
    try {
        if (format === 'json') return JSON.stringify([step], null, 2);
        return YAML.stringify([step]).trim();
    } catch {
        return String(step);
    }
}

// Shared cancel guard — returns true if we should abort
function cancelled(v) {
    return p.isCancel(v);
}

async function promptArgs(message = 'Arguments as JSON array') {
    const raw = await p.text({
        message,
        placeholder: '[]',
        hint: 'JSON array, e.g. ["hello", 42, "$myVar"]. $variables are resolved at runtime.',
        validate: (v) => {
            const t = v.trim();
            if (!t || t === '[]') return undefined;
            const parsed = lenientParse(t);
            if (!Array.isArray(parsed)) return 'Must be a JSON array, e.g. [1, 2, "hello"]';
        },
    });
    if (cancelled(raw)) return raw;
    const parsed = lenientParse(raw.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [];
}

// ─── Per-command builders ─────────────────────────────────────────────────────

async function buildSET() {
    const varName = await p.text({
        message: 'destinationVariable',
        placeholder: 'myVar',
        hint: 'Leading $ optional. Dot-notation for deep assignment (e.g. config.server.host).',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(varName)) return null;

    const valRaw = await p.text({
        message: 'value',
        placeholder: '"hello" or 42 or {"key":"val"} or $otherVar',
        hint: 'JSON, a $variable reference, or bare string. Unquoted keys/values are auto-fixed.',
    });
    if (cancelled(valRaw)) return null;

    return ['SET', [varName.trim(), lenientParse(valRaw.trim())]];
}

async function buildEXEC() {
    const targetPath = await p.text({
        message: 'targetPath',
        placeholder: 'console.log',
        hint: 'e.g. math.add, fs.readFileSync, $myFn, $obj.method',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(targetPath)) return null;

    const args = await promptArgs('arguments');
    if (cancelled(args)) return null;

    const destType = await p.select({
        message: 'Destination / output handling',
        options: [
            { value: 'none',     label: 'None',              hint: 'Result stored in $LAST implicitly' },
            { value: 'variable', label: 'Simple variable',   hint: 'Store result as $varName' },
            { value: 'advanced', label: 'Advanced (into / chain / compose / promise)', hint: 'Full config object' },
        ],
    });
    if (cancelled(destType)) return null;

    if (destType === 'none') return ['EXEC', [targetPath.trim(), args]];

    if (destType === 'variable') {
        const dest = await p.text({
            message: 'destinationVariable',
            placeholder: 'result',
            hint: 'Leading $ optional',
            validate: v => v.trim() ? undefined : 'Required',
        });
        if (cancelled(dest)) return null;
        return ['EXEC', [targetPath.trim(), args, dest.trim()]];
    }

    // Advanced
    const intoVar = await p.text({ message: '"into" — destination variable', placeholder: 'result' });
    if (cancelled(intoVar)) return null;
    const destObj = { into: intoVar.trim() };

    const hasChain = await p.confirm({ message: 'Add a "chain" (sequential method calls on the result)?' });
    if (cancelled(hasChain)) return null;
    if (hasChain) {
        const chainRaw = await p.text({
            message: '"chain" — array of [methodName, [args]] pairs as JSON',
            placeholder: '[["map", ["$fn"]], ["filter", ["$pred"]]]',
        });
        if (cancelled(chainRaw)) return null;
        destObj.chain = lenientParse(chainRaw.trim());
    }

    const hasCompose = await p.confirm({ message: 'Add a "compose" (sequential function calls passing result forward)?' });
    if (cancelled(hasCompose)) return null;
    if (hasCompose) {
        const composeRaw = await p.text({
            message: '"compose" — array of [funcPath, [args]] pairs as JSON',
            placeholder: '[["YAML.parse", []], ["Object.keys", []]]',
        });
        if (cancelled(composeRaw)) return null;
        destObj.compose = lenientParse(composeRaw.trim());
    }

    const storePromise = await p.confirm({ message: 'Store as a Promise (non-awaited, for parallel execution)?' });
    if (cancelled(storePromise)) return null;
    if (storePromise) destObj.promise = true;

    return ['EXEC', [targetPath.trim(), args, destObj]];
}

async function buildF() {
    const funcName = await p.text({
        message: 'functionName',
        placeholder: 'MyFunc',
        hint: 'Stored in ctx.vars as $MyFunc',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(funcName)) return null;

    const argsRaw = await p.text({
        message: 'formalArguments — parameter names as JSON array',
        placeholder: '["arg1", "arg2"]',
        hint: 'Use "&arg" for pass-by-reference, {"key":"localName"} for destructuring.',
        validate: v => {
            const parsed = lenientParse(v.trim() || '[]');
            if (!Array.isArray(parsed)) return 'Must be a JSON array';
        },
    });
    if (cancelled(argsRaw)) return null;
    const formalArgs = lenientParse(argsRaw.trim() || '[]');

    // Empty subprogram placeholder — fill later with context-sensitive .wiz
    p.log.info('Body steps placeholder [] added. Call .wiz again with this step in the buffer to fill them.');
    return ['F', [funcName.trim(), Array.isArray(formalArgs) ? formalArgs : [], []]];
}

async function buildMATH() {
    const funcName = await p.text({
        message: 'functionName',
        placeholder: 'myMathFn',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(funcName)) return null;

    const argsRaw = await p.text({
        message: 'formalArguments — parameter names as JSON array',
        placeholder: '["x", "y"]',
        validate: v => {
            const parsed = lenientParse(v.trim() || '[]');
            if (!Array.isArray(parsed)) return 'Must be a JSON array';
        },
    });
    if (cancelled(argsRaw)) return null;
    const formalArgs = lenientParse(argsRaw.trim() || '[]');

    const expr = await p.text({
        message: 'mathExpression — a mathjs expression string',
        placeholder: 'x^2 + 2*x + 1',
        hint: 'See https://mathjs.org/docs/expressions/syntax.html',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(expr)) return null;

    return ['MATH', [funcName.trim(), Array.isArray(formalArgs) ? formalArgs : [], expr.trim()]];
}

async function buildFOR_EACH() {
    const listRaw = await p.text({
        message: 'listSpecifier — array variable, literal array, or N (iteration count)',
        placeholder: '$myList',
        hint: 'e.g. "$myArray", [1,2,3], or 1000 for N iterations. $ITEM is set each iteration.',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(listRaw)) return null;
    const listSpec = lenientParse(listRaw.trim());

    p.log.info('Loop body placeholder [] added. Call .wiz again with this step in the buffer to fill it.');
    return ['FOR_EACH', [listSpec, []]];
}

async function buildIF() {
    const condRaw = await p.text({
        message: 'condition — variable or value to evaluate as truthy/falsy',
        placeholder: '$isValid',
        hint: 'Variables starting with $ are resolved. Can be a literal true/false.',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(condRaw)) return null;
    const cond = lenientParse(condRaw.trim());

    p.log.info('Branch placeholders [] added. Call .wiz again with this step in the buffer to fill them.');
    return ['IF', [cond, [], []]];
}

async function buildTRY() {
    p.log.info('Try/catch block placeholders [] added. Call .wiz again with this step in the buffer to fill them.');
    return ['TRY', [[], []]];
}

async function buildSANDBOX() {
    const optType = await p.select({
        message: 'sandboxOptions',
        options: [
            { value: 'copy',   label: 'copy',          hint: 'Duplicate parent variables and policy into sandbox' },
            { value: 'object', label: 'Custom object',  hint: 'Specify policy, capabilities, context' },
        ],
    });
    if (cancelled(optType)) return null;

    let sandboxOpts;
    if (optType === 'copy') {
        sandboxOpts = 'copy';
    } else {
        const obj = {};
        const policyVal = await p.select({
            message: '"policy" — risk level for the sandbox',
            options: ['LOW','MEDIUM','HIGH','INSANE'].map(v => ({ value: v, label: v })),
        });
        if (cancelled(policyVal)) return null;
        obj.policy = policyVal;

        const capRaw = await p.text({
            message: '"capabilities" — permitted module paths as JSON array',
            placeholder: '["math", "console.log"]',
            hint: 'Use [] to block all capabilities.',
        });
        if (cancelled(capRaw)) return null;
        const caps = lenientParse(capRaw.trim() || '[]');
        obj.capabilities = Array.isArray(caps) ? caps : [];

        const ctxRaw = await p.text({
            message: '"context" — parent variables to expose (JSON array, $VARS, or blank)',
            placeholder: '["$myVar"]',
            hint: '$VARS passes all parent variables.',
        });
        if (cancelled(ctxRaw)) return null;
        if (ctxRaw.trim() === '$VARS') {
            obj.context = '$VARS';
        } else {
            const ctxParsed = lenientParse(ctxRaw.trim() || '[]');
            if (Array.isArray(ctxParsed) && ctxParsed.length > 0) obj.context = ctxParsed;
        }
        sandboxOpts = obj;
    }

    const destVar = await p.text({
        message: 'destinationVariable — where to store sandbox $RETURN (optional)',
        placeholder: 'sandboxResult',
        hint: 'Leave blank to discard.',
    });
    if (cancelled(destVar)) return null;

    p.log.info('Sandbox body placeholder [] added. Call .wiz again with this step in the buffer to fill it.');
    const args = [sandboxOpts, []];
    if (destVar.trim()) args.push(destVar.trim());
    return ['SANDBOX', args];
}

async function buildCHILD() {
    const funcName = await p.text({
        message: 'functionName — F-defined function to run in a child process',
        placeholder: 'myHeavyFunc',
        hint: 'Must have been defined with F. HIGH/INSANE policy required.',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(funcName)) return null;

    const args = await promptArgs('arguments');
    if (cancelled(args)) return null;

    const destVar = await p.text({
        message: 'destinationPromiseVariable — where to store the returned promise',
        placeholder: 'myTaskPromise',
        hint: 'Use AWAIT later to retrieve the result.',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(destVar)) return null;

    return ['CHILD', [funcName.trim(), args, destVar.trim()]];
}

async function buildAWAIT() {
    const srcVar = await p.text({
        message: 'sourcePromiseVariable — variable holding the promise to await',
        placeholder: '$myPromise',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(srcVar)) return null;

    const destVar = await p.text({
        message: 'destinationVariable — where to store the resolved result (optional)',
        placeholder: 'resolvedValue',
        hint: 'Leave blank to discard the result.',
    });
    if (cancelled(destVar)) return null;

    const args = [srcVar.trim()];
    if (destVar.trim()) args.push(destVar.trim());
    return ['AWAIT', args];
}

async function buildNEW() {
    const ctor = await p.text({
        message: 'targetConstructor',
        placeholder: 'Date',
        hint: 'e.g. Date, URL, Map, or a module path like crypto.KeyObject',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(ctor)) return null;

    const args = await promptArgs('arguments — constructor arguments');
    if (cancelled(args)) return null;

    const destVar = await p.text({
        message: 'destinationVariable — where to store the new instance (optional)',
        placeholder: 'myObj',
    });
    if (cancelled(destVar)) return null;

    const params = [ctor.trim(), args];
    if (destVar.trim()) params.push(destVar.trim());
    return ['NEW', params];
}

async function buildLITERAL() {
    const valRaw = await p.text({
        message: 'value — raw value to inject without $variable resolution',
        placeholder: '[1, 2, 3] or "$literalString"',
        hint: 'JSON or JSON5. Bypasses $variable resolution entirely.',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(valRaw)) return null;
    const value = lenientParse(valRaw.trim());

    const destVar = await p.text({
        message: 'destinationVariable (optional, top-level use only)',
        placeholder: 'myData',
        hint: 'Leave blank for inline use inside another command.',
    });
    if (cancelled(destVar)) return null;

    const args = [value];
    if (destVar.trim()) args.push(destVar.trim());
    return ['LITERAL', args];
}

async function buildREQUEST() {
    const capsRaw = await p.text({
        message: 'capabilities — comma-separated capability paths to request',
        placeholder: 'console.log, math.add, fs.readFileSync',
        hint: 'Must be the FIRST command in the script. Checked against current policy.',
        validate: v => v.trim() ? undefined : 'At least one capability required',
    });
    if (cancelled(capsRaw)) return null;
    const caps = capsRaw.split(',').map(s => s.trim()).filter(Boolean);
    return ['REQUEST', caps];
}

async function buildImplicitExec() {
    const targetPath = await p.text({
        message: 'targetPath — module.method to call (no EXEC keyword needed)',
        placeholder: 'console.log',
        hint: 'Any path not starting with a space and not a reserved keyword triggers implicit exec.',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(targetPath)) return null;

    const args = await promptArgs('arguments');
    if (cancelled(args)) return null;

    const destVar = await p.text({
        message: 'destinationVariable (optional)',
        placeholder: 'result',
    });
    if (cancelled(destVar)) return null;

    const step = [targetPath.trim(), args];
    if (destVar.trim()) step.push(destVar.trim());
    return step;
}

async function buildImplicitMath() {
    const expr = await p.text({
        message: 'mathExpression — leading space is added automatically',
        placeholder: '2 + 2 * $x',
        hint: 'Uses mathjs evaluation. A leading space in item[0] triggers math mode.',
        validate: v => v.trim() ? undefined : 'Required',
    });
    if (cancelled(expr)) return null;

    const destVar = await p.text({
        message: 'destinationVariable (optional)',
        placeholder: 'result',
    });
    if (cancelled(destVar)) return null;

    // Leading space is the trigger for implicit math mode
    const step = [` ${expr.trim()}`];
    if (destVar.trim()) {
        step.push([], destVar.trim());
    }
    return step;
}

// ─── Step dispatcher ──────────────────────────────────────────────────────────

export async function buildOneStep(command) {
    switch (command) {
        case 'SET':           return buildSET();
        case 'EXEC':          return buildEXEC();
        case 'F':             return buildF();
        case 'MATH':          return buildMATH();
        case 'FOR_EACH':      return buildFOR_EACH();
        case 'IF':            return buildIF();
        case 'TRY':           return buildTRY();
        case 'SANDBOX':       return buildSANDBOX();
        case 'CHILD':         return buildCHILD();
        case 'AWAIT':         return buildAWAIT();
        case 'NEW':           return buildNEW();
        case 'LITERAL':       return buildLITERAL();
        case 'REQUEST':       return buildREQUEST();
        case 'implicit_exec': return buildImplicitExec();
        case 'implicit_math': return buildImplicitMath();
        default:              return null;
    }
}

// ─── Sub-program builder loop ─────────────────────────────────────────────────

async function buildSubprogram(label, format) {
    const steps = [];
    p.log.step(`Building sub-program: ${label}`);

    while (true) {
        const addMore = await p.confirm({
            message: steps.length === 0
                ? `Add a step to "${label}"?`
                : `Add another step? (${steps.length} so far)`,
            initialValue: true,
        });
        if (cancelled(addMore) || !addMore) break;

        const command = await p.select({
            message: 'Which command?',
            options: Object.entries(COMMAND_DESCRIPTORS).map(([k, v]) => ({
                value: k,
                label: v.label,
                hint: v.hint,
            })),
        });
        if (cancelled(command)) break;

        const step = await buildOneStep(command);
        if (step === null) break;

        steps.push(step);
        p.log.success(`Step added: ${formatStep(step, format)}`);
    }
    return steps;
}

// ─── Post-build action prompt ─────────────────────────────────────────────────

async function promptAction(step, format) {
    p.log.info('Built step:\n' + formatStep(step, format));

    const action = await p.select({
        message: 'What would you like to do?',
        options: [
            { value: 'execute', label: '▶  Execute now' },
            { value: 'print',   label: '📋  Print only (copy manually)' },
            { value: 'cancel',  label: '✕   Cancel' },
        ],
    });
    if (cancelled(action) || action === 'cancel') {
        p.cancel('Wizard cancelled.');
        return null;
    }
    p.outro('✨ Wizard complete!');
    return { step, execute: action === 'execute' };
}

// ─── Context-sensitive: fill subprogram slots in existing buffer step ─────────

async function runContextWizard(format, bufferStep) {
    const command = bufferStep[0];
    const slots = SUBPROGRAM_SLOTS[command];

    if (!slots || slots.length === 0) {
        p.log.warn(`"${command}" has no subprogram slots. Use .wiz on an empty buffer to build a new step.`);
        p.outro('Nothing to fill.');
        return null;
    }

    const emptySlots = slots.filter(slot => {
        const val = getDeep(bufferStep, slot.path);
        return Array.isArray(val) && val.length === 0;
    });

    if (emptySlots.length === 0) {
        p.log.warn(`All subprogram slots for "${command}" are already filled.`);
        p.outro('Nothing to fill.');
        return null;
    }

    let updatedStep = bufferStep;
    for (const slot of emptySlots) {
        const shouldFill = await p.confirm({
            message: `Fill "${slot.label}" (currently empty)?`,
            initialValue: true,
        });
        if (cancelled(shouldFill) || !shouldFill) continue;

        const subSteps = await buildSubprogram(slot.label, format);
        updatedStep = setDeep(updatedStep, slot.path, subSteps);
        p.log.success(`"${slot.label}" filled with ${subSteps.length} step(s).`);
    }

    return promptAction(updatedStep, format);
}

// ─── New step wizard ──────────────────────────────────────────────────────────

async function runStepWizard(format) {
    const command = await p.select({
        message: 'Which command would you like to build?',
        options: Object.entries(COMMAND_DESCRIPTORS).map(([k, v]) => ({
            value: k,
            label: v.label,
            hint: v.hint,
        })),
    });
    if (cancelled(command)) {
        p.cancel('Wizard cancelled.');
        return null;
    }

    const step = await buildOneStep(command);
    if (step === null) {
        p.cancel('Wizard cancelled.');
        return null;
    }

    return promptAction(step, format);
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Main wizard entry point.
 * @param {string} format - 'yaml' or 'json'
 * @param {string} bufferContent - current REPL buffer (may be empty)
 * @returns {Promise<{step: Array, execute: boolean}|null>}
 */
export async function runWizard(format, bufferContent) {
    p.intro('✨ Nejy Step Builder Wizard');

    // Context-sensitive: if buffer has parseable content with empty subprogram slots, fill them
    if (bufferContent && bufferContent.trim()) {
        try {
            let parsed = format === 'json'
                ? JSON5.parse(bufferContent.trim())
                : YAML.parse(bufferContent.trim());

            // Normalise: could be a single step or a list of steps
            let candidate = null;
            if (Array.isArray(parsed)) {
                if (parsed.length > 0 && Array.isArray(parsed[0])) {
                    // List of steps — find first with an empty subprogram slot
                    candidate = parsed.find(s => {
                        if (!Array.isArray(s) || typeof s[0] !== 'string') return false;
                        const slots = SUBPROGRAM_SLOTS[s[0]];
                        return slots && slots.some(slot => {
                            const val = getDeep(s, slot.path);
                            return Array.isArray(val) && val.length === 0;
                        });
                    }) ?? null;
                } else if (parsed.length > 0 && typeof parsed[0] === 'string') {
                    // Single step — e.g. ["F", ["name", [], []]]
                    candidate = parsed;
                }
            }

            if (candidate && typeof candidate[0] === 'string' && SUBPROGRAM_SLOTS[candidate[0]]) {
                const hasEmpty = SUBPROGRAM_SLOTS[candidate[0]].some(slot => {
                    const val = getDeep(candidate, slot.path);
                    return Array.isArray(val) && val.length === 0;
                });
                if (hasEmpty) {
                    p.log.info(`Detected "${candidate[0]}" step with empty subprogram slot(s) — entering fill mode.`);
                    return await runContextWizard(format, candidate);
                }
            }
        } catch {
            // Buffer can't be parsed — fall through to new-step wizard
        }
    }

    return await runStepWizard(format);
}
