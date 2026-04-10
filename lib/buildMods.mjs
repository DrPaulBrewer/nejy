/**
 * lib/buildMods.mjs
 *
 * Builds the `Mods` capability object from a set of registry YAML files
 * and a maxRisk level. This is the authoritative source of what is callable
 * by nejy programs — nothing in globalThis is reachable unless explicitly
 * placed here.
 *
 * Registry entry modes:
 *   - "methods" is an object → EXPLICIT mode: only listed methods go into Mods
 *   - "methods" absent or "*"  → WILDCARD mode: entire module via risk-checking Proxy
 *
 * Setup programs run in an isolated mini-executor with $MODULE in scope.
 * They do NOT use the main interpreter or the scanner.
 */

import { readFileSync } from 'node:fs';
import YAML from 'yaml';

export const RISK_MAP = { LOW: 0, MEDIUM: 1, HIGH: 2, INSANE: 3 };

// ---------------------------------------------------------------------------
// Mini executor — runs registry setup programs without scanning.
// Only handles EXEC and SET commands. $MODULE is pre-seeded in vars.
// ---------------------------------------------------------------------------

function resolveMiniPath(pathStr, vars) {
  const parts = pathStr.split('.');
  // First part: either a $VAR or a globalThis name
  let obj = parts[0].startsWith('$') ? vars[parts[0]] : globalThis[parts[0]];
  let parent = null;
  for (let i = 1; i < parts.length; i++) {
    parent = obj;
    obj = obj?.[parts[i]];
  }
  return { value: obj, thisArg: parent };
}

function resolveMiniArg(arg, vars, last) {
  if (typeof arg === 'string' && arg.startsWith('$')) {
    if (arg === '$LAST') return last;
    const { value } = resolveMiniPath(arg, vars);
    return value;
  }
  if (Array.isArray(arg)) return arg.map(a => resolveMiniArg(a, vars, last));
  if (arg && typeof arg === 'object')
    return Object.fromEntries(Object.entries(arg).map(([k, v]) => [k, resolveMiniArg(v, vars, last)]));
  return arg;
}

async function miniExecutor(steps, initVars) {
  const vars = { ...initVars };
  let last = undefined;

  for (const step of steps) {
    if (!Array.isArray(step) || step.length < 2) continue;
    const [cmd, args] = step;

    if (cmd === 'EXEC') {
      const [pathStr, rawArgs] = args;
      const { value: fn, thisArg } = resolveMiniPath(pathStr, vars);
      if (typeof fn !== 'function')
        throw new Error(`buildMods setup: '${pathStr}' is not a function (got ${typeof fn})`);
      const resolvedArgs = Array.isArray(rawArgs)
        ? rawArgs.map(a => resolveMiniArg(a, vars, last))
        : [];
      last = await fn.apply(thisArg, resolvedArgs);
    } else if (cmd === 'SET') {
      const [name, value] = args;
      last = resolveMiniArg(value, vars, last);
      vars[`$${name}`] = last;
    }
  }

  return last;
}

// ---------------------------------------------------------------------------
// Helper: walk a dotted path on an object
// ---------------------------------------------------------------------------

function getNestedProp(obj, dotPath) {
  return dotPath.split('.').reduce((o, k) => o?.[k], obj);
}

// ---------------------------------------------------------------------------
// buildEntry — turn a single registry entry into a Mods value
// ---------------------------------------------------------------------------

async function buildEntry(entry, maxLevel) {
  const {
    key,
    src,
    module: modulePath,
    risk: baseRisk = 'LOW',
    methods,
    overrides = {},
    setup,
  } = entry;

  // 1. Acquire the raw module
  let rawModule;
  if (src === 'global') {
    const rootKey = key.split('.')[0];
    rawModule = globalThis[rootKey];
  } else if (src === 'import') {
    const imported = await import(modulePath);
    // Handle CJS-wrapped ESM (default export) vs pure ESM named exports
    rawModule = ('default' in imported) ? imported.default : imported;
  } else {
    return [key, undefined];
  }

  if (rawModule === undefined || rawModule === null) {
    process.stderr.write(`buildMods: warn: could not acquire '${key}' via src:${src}\n`);
    return [key, undefined];
  }

  // 2. Run setup if present (isolated context, $MODULE in scope)
  const instance = (setup && Array.isArray(setup))
    ? await miniExecutor(setup, { $MODULE: rawModule })
    : rawModule;

  if (instance === undefined || instance === null) {
    process.stderr.write(`buildMods: warn: setup for '${key}' returned ${instance}\n`);
    return [key, undefined];
  }

  // 3. Build the Mods entry
  if (methods && typeof methods === 'object' && methods !== '*') {
    // EXPLICIT mode — only listed methods at or below maxRisk
    const node = {};
    let hasAny = false;

    for (const [methodPath, methodRisk] of Object.entries(methods)) {
      if (RISK_MAP[methodRisk] === undefined || RISK_MAP[methodRisk] > maxLevel) continue;

      // methodName is the dotted path AFTER the key prefix (e.g. "execSync" from "cp.execSync")
      const methodName = methodPath.slice(key.length + 1); // strip "key."
      const val = getNestedProp(instance, methodName);
      if (val === undefined) continue;

      if (typeof val === 'function') {
        // Bind to the direct parent to preserve `this`
        const parentPath = methodName.includes('.')
          ? methodName.split('.').slice(0, -1).join('.')
          : null;
        const parentObj = parentPath ? getNestedProp(instance, parentPath) : instance;
        node[methodName] = val.bind(parentObj ?? instance);
      } else {
        node[methodName] = val;
      }
      hasAny = true;
    }

    return [key, hasAny ? node : undefined];

  } else {
    // WILDCARD mode — expose whole instance via risk-checking Proxy
    const baseLevel = RISK_MAP[baseRisk] ?? 0;

    // Only add the key to Mods if the base risk is within maxRisk,
    // OR if there are specific overrides that are within maxRisk.
    const anyOverrideAllowed = Object.entries(overrides)
      .some(([, r]) => (RISK_MAP[r] ?? 0) <= maxLevel);

    if (baseLevel > maxLevel && !anyOverrideAllowed) {
      return [key, undefined]; // nothing accessible
    }

    const proxy = new Proxy(instance, {
      get(target, prop, receiver) {
        if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
        const fullPath = `${key}.${prop}`;
        const effectiveRisk = overrides[fullPath] ?? baseRisk;
        const effectiveLevel = RISK_MAP[effectiveRisk] ?? baseLevel;
        if (effectiveLevel > maxLevel) return undefined;
        const val = Reflect.get(target, prop, receiver);
        return typeof val === 'function' ? val.bind(target) : val;
      },
      has(target, prop) {
        if (typeof prop !== 'string') return Reflect.has(target, prop);
        const fullPath = `${key}.${prop}`;
        const effectiveRisk = overrides[fullPath] ?? baseRisk;
        return (RISK_MAP[effectiveRisk] ?? RISK_MAP[baseRisk] ?? 0) <= maxLevel;
      },
    });

    return [key, proxy];
  }
}

// ---------------------------------------------------------------------------
// buildMods — main export
// ---------------------------------------------------------------------------

/**
 * Build the Mods capability object from a list of registry files and maxRisk.
 *
 * @param {string[]} registryFiles - paths to YAML registry files to load
 * @param {string}   maxRisk       - "LOW" | "MEDIUM" | "HIGH" | "INSANE"
 * @returns {Promise<object>}       - the Mods capability object
 */
export async function buildMods(registryFiles, maxRisk = 'LOW') {
  const maxLevel = RISK_MAP[maxRisk] ?? 0;
  const mods = Object.create(null); // no prototype — clean slate

  for (const filePath of registryFiles) {
    let doc;
    try {
      doc = YAML.parse(readFileSync(filePath, 'utf8'));
    } catch (e) {
      process.stderr.write(`buildMods: error loading '${filePath}': ${e.message}\n`);
      continue;
    }

    const entries = doc?.entries;
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      try {
        const [key, value] = await buildEntry(entry, maxLevel);
        if (key && value !== undefined) {
          mods[key] = value;
        }
      } catch (e) {
        process.stderr.write(`buildMods: error processing entry '${entry?.key}': ${e.message}\n`);
      }
    }
  }

  return mods;
}

/**
 * Resolve the effective risk level for a dotted path against the registry.
 * Used by the SecurityScanner to replace its blacklist.
 *
 * @param {string}   pathStr  - e.g. "math.evaluate" or "fs.writeFileSync"
 * @param {object[]} registry - parsed registry entries (all loaded entries)
 * @returns {string|null}     - risk level string, or null if not in registry
 */
export function effectiveRisk(pathStr, registry) {
  // 1. Check exact match in any entry's methods or overrides
  for (const entry of registry) {
    const methods = (entry.methods && typeof entry.methods === 'object' && entry.methods !== '*')
      ? entry.methods
      : null;
    if (methods && pathStr in methods) return methods[pathStr];
    const overrides = entry.overrides ?? {};
    if (pathStr in overrides) return overrides[pathStr];
  }

  // 2. Longest prefix match — check if pathStr starts with entry.key
  let bestMatch = null;
  for (const entry of registry) {
    if (pathStr === entry.key || pathStr.startsWith(entry.key + '.')) {
      if (!bestMatch || entry.key.length > bestMatch.key.length) {
        bestMatch = entry;
      }
    }
  }
  if (bestMatch) return bestMatch.risk ?? 'LOW';

  // 3. Not in registry
  return null;
}
