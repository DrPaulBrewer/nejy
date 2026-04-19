/**
 * tests/buildMods.test.mjs — Stage 1 Unit Tests
 *
 * Tests buildMods() in isolation: verifies that the Mods object
 * contains exactly the right capabilities at each risk level.
 * Does NOT spawn child processes — calls buildMods() directly.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { buildMods, loadRegistry } from '../lib/buildMods.mjs';

const REG = 'config/security/registry/DEFAULT';
const ALL_FILES = [
  `${REG}/00-builtins.yaml`,
  `${REG}/10-math.yaml`,
  `${REG}/20-console.yaml`,
  `${REG}/30-yaml-module.yaml`,
  `${REG}/40-os.yaml`,
  `${REG}/50-fs.yaml`,
  `${REG}/60-net.yaml`,
  // 90-process.yaml is intentionally NOT loaded
];

const ALL = loadRegistry(ALL_FILES);

// ---------------------------------------------------------------------------
// LOW risk
// ---------------------------------------------------------------------------

test('LOW: math is present and functional', async () => {
  const mods = await buildMods(ALL, 'LOW');
  assert.ok(mods.math, 'math should be in Mods at LOW');
  assert.strictEqual(typeof mods.math.evaluate, 'function', 'math.evaluate should be a function');
  assert.strictEqual(mods.math.evaluate('1 + 1'), 2, 'math.evaluate should compute correctly');
  assert.strictEqual(mods.math.evaluate('2^3'), 8, 'math.evaluate should handle exponentiation');
});

test('LOW: math.import is blocked (HIGH > LOW)', async () => {
  const mods = await buildMods(ALL, 'LOW');
  // In wildcard+Proxy mode, accessing a blocked method returns undefined
  assert.strictEqual(mods.math.import, undefined,
    'math.import (HIGH) should not be accessible at LOW risk');
});

test('LOW: console.log is present and callable', async () => {
  const mods = await buildMods(ALL, 'LOW');
  assert.ok(mods.console, 'console should be in Mods at LOW');
  assert.strictEqual(typeof mods.console.log, 'function');
});

test('LOW: YAML.parse and YAML.stringify are present', async () => {
  const mods = await buildMods(ALL, 'LOW');
  assert.ok(mods.YAML, 'YAML should be in Mods at LOW');
  assert.strictEqual(typeof mods.YAML.parse, 'function');
  assert.strictEqual(typeof mods.YAML.stringify, 'function');
  // Verify they work
  const data = { x: 1 };
  const str = mods.YAML.stringify(data);
  const back = mods.YAML.parse(str);
  assert.strictEqual(back.x, 1, 'YAML round-trip should work');
});

test('LOW: Object.keys is present', async () => {
  const mods = await buildMods(ALL, 'LOW');
  assert.ok(mods.Object, 'Object should be in Mods at LOW');
  assert.strictEqual(typeof mods.Object.keys, 'function');
  assert.deepStrictEqual(mods.Object.keys({ a: 1, b: 2 }), ['a', 'b']);
});

test('LOW: Object.setPrototypeOf is blocked (HIGH > LOW)', async () => {
  const mods = await buildMods(ALL, 'LOW');
  assert.strictEqual(mods.Object.setPrototypeOf, undefined,
    'Object.setPrototypeOf (HIGH) should not be accessible at LOW');
});

test('LOW: Object.defineProperty is blocked (HIGH > LOW)', async () => {
  const mods = await buildMods(ALL, 'LOW');
  assert.strictEqual(mods.Object.defineProperty, undefined,
    'Object.defineProperty (HIGH) should not be accessible at LOW');
});

test('LOW: fs is not present (all fs methods are MEDIUM or higher)', async () => {
  const mods = await buildMods(ALL, 'LOW');
  assert.strictEqual(mods.fs, undefined, 'fs should not be in Mods at LOW');
});

test('LOW: os is not present (all os methods are MEDIUM or higher)', async () => {
  const mods = await buildMods(ALL, 'LOW');
  assert.strictEqual(mods.os, undefined, 'os should not be in Mods at LOW');
});

test('LOW: child_process is not present (all methods are HIGH or higher)', async () => {
  const mods = await buildMods(ALL, 'LOW');
  assert.strictEqual(mods.child_process, undefined);
  assert.strictEqual(mods.cp, undefined);
});

test('LOW: eval is not in Mods (not in registry)', async () => {
  const mods = await buildMods(ALL, 'LOW');
  assert.strictEqual(mods.eval, undefined,
    'eval must not be in Mods at any risk level');
});

test('LOW: process is not in Mods (90-process.yaml not loaded)', async () => {
  const mods = await buildMods(ALL, 'LOW');
  assert.strictEqual(mods.process, undefined,
    'process must not be in Mods when 90-process.yaml is not loaded');
});

// ---------------------------------------------------------------------------
// MEDIUM risk
// ---------------------------------------------------------------------------

test('MEDIUM: fs is present with read methods only', async () => {
  const mods = await buildMods(ALL, 'MEDIUM');
  assert.ok(mods.fs, 'fs should be in Mods at MEDIUM');
  assert.strictEqual(typeof mods.fs.readFileSync, 'function', 'fs.readFileSync should be present');
  assert.strictEqual(typeof mods.fs.readdirSync, 'function', 'fs.readdirSync should be present');
  assert.strictEqual(typeof mods.fs.statSync, 'function', 'fs.statSync should be present');
  assert.strictEqual(typeof mods.fs.existsSync, 'function', 'fs.existsSync should be present');
});

test('MEDIUM: fs.writeFileSync is not present (HIGH > MEDIUM)', async () => {
  const mods = await buildMods(ALL, 'MEDIUM');
  assert.strictEqual(mods.fs.writeFileSync, undefined,
    'fs.writeFileSync (HIGH) should not be accessible at MEDIUM');
});

test('MEDIUM: fs.unlinkSync is not present (HIGH > MEDIUM)', async () => {
  const mods = await buildMods(ALL, 'MEDIUM');
  assert.strictEqual(mods.fs.unlinkSync, undefined,
    'fs.unlinkSync (HIGH) should not be accessible at MEDIUM');
});

test('MEDIUM: os is present with hostname and other methods', async () => {
  const mods = await buildMods(ALL, 'MEDIUM');
  assert.ok(mods.os, 'os should be in Mods at MEDIUM');
  assert.strictEqual(typeof mods.os.hostname, 'function');
  assert.strictEqual(typeof mods.os.uptime, 'function');
  assert.strictEqual(typeof mods.os.platform, 'function');
  assert.strictEqual(typeof mods.os.freemem, 'function');
  // Verify hostname actually returns something
  assert.ok(typeof mods.os.hostname() === 'string', 'os.hostname() should return a string');
});

test('MEDIUM: os.networkInterfaces is not present (HIGH > MEDIUM)', async () => {
  const mods = await buildMods(ALL, 'MEDIUM');
  assert.strictEqual(mods.os.networkInterfaces, undefined,
    'os.networkInterfaces (HIGH) should not be accessible at MEDIUM');
});

test('MEDIUM: child_process is still not present (HIGH > MEDIUM)', async () => {
  const mods = await buildMods(ALL, 'MEDIUM');
  assert.strictEqual(mods.child_process, undefined);
  assert.strictEqual(mods.cp, undefined);
});

test('MEDIUM: Object.setPrototypeOf still blocked (INSANE > MEDIUM)', async () => {
  const mods = await buildMods(ALL, 'MEDIUM');
  assert.strictEqual(mods.Object.setPrototypeOf, undefined,
    'Object.setPrototypeOf (INSANE) should not be accessible at MEDIUM');
});

test('MEDIUM: eval and process still not in Mods', async () => {
  const mods = await buildMods(ALL, 'MEDIUM');
  assert.strictEqual(mods.eval, undefined);
  assert.strictEqual(mods.process, undefined);
});

// ---------------------------------------------------------------------------
// HIGH risk
// ---------------------------------------------------------------------------

test('HIGH: fs.writeFileSync is present', async () => {
  const mods = await buildMods(ALL, 'HIGH');
  assert.ok(mods.fs, 'fs should be in Mods at HIGH');
  assert.strictEqual(typeof mods.fs.writeFileSync, 'function',
    'fs.writeFileSync should be accessible at HIGH');
  assert.strictEqual(typeof mods.fs.unlinkSync, 'function',
    'fs.unlinkSync should be accessible at HIGH');
});

test('HIGH: fs.chmodSync is not present (INSANE > HIGH)', async () => {
  const mods = await buildMods(ALL, 'HIGH');
  assert.strictEqual(mods.fs.chmodSync, undefined,
    'fs.chmodSync (INSANE) should not be accessible at HIGH');
});

test('HIGH: child_process is present with exec methods', async () => {
  const mods = await buildMods(ALL, 'HIGH');
  assert.ok(mods.child_process, 'child_process should be in Mods at HIGH');
  assert.strictEqual(typeof mods.child_process.execSync, 'function');
  assert.strictEqual(typeof mods.child_process.spawnSync, 'function');
  assert.ok(mods.cp, 'cp alias should also be present at HIGH');
  assert.strictEqual(typeof mods.cp.execSync, 'function');
});

test('HIGH: child_process.fork is not present (INSANE > HIGH)', async () => {
  const mods = await buildMods(ALL, 'HIGH');
  assert.strictEqual(mods.child_process.fork, undefined,
    'child_process.fork (INSANE) should not be accessible at HIGH');
  assert.strictEqual(mods.cp.fork, undefined);
});

test('HIGH: Object.setPrototypeOf is blocked (INSANE > HIGH)', async () => {
  const mods = await buildMods(ALL, 'HIGH');
  assert.strictEqual(mods.Object.setPrototypeOf, undefined,
    'Object.setPrototypeOf (INSANE) should not be accessible at HIGH risk');
});

test('HIGH: Object.defineProperty is blocked (INSANE > HIGH)', async () => {
  const mods = await buildMods(ALL, 'HIGH');
  assert.strictEqual(mods.Object.defineProperty, undefined,
    'Object.defineProperty (INSANE) should not be accessible at HIGH');
});

test('HIGH: Object.getPrototypeOf is blocked (INSANE > HIGH)', async () => {
  const mods = await buildMods(ALL, 'HIGH');
  assert.strictEqual(mods.Object.getPrototypeOf, undefined,
    'Object.getPrototypeOf (INSANE) should not be accessible at HIGH');
});

test('HIGH: eval and process still not in Mods (not in any loaded registry)', async () => {
  const mods = await buildMods(ALL, 'HIGH');
  assert.strictEqual(mods.eval, undefined,
    'eval must never be in Mods regardless of risk level');
  assert.strictEqual(mods.process, undefined,
    'process must not be in Mods when 90-process.yaml is not loaded');
});

// ---------------------------------------------------------------------------
// Setup isolation
// ---------------------------------------------------------------------------

test('SETUP: math instance is created by setup (not the raw module)', async () => {
  const mods = await buildMods(loadRegistry([`${REG}/10-math.yaml`]), 'LOW');
  assert.ok(mods.math, 'math should be present');
  // The setup runs create(all), so math.evaluate should be directly on the instance
  assert.strictEqual(typeof mods.math.evaluate, 'function');
  // Verify it is a correctly configured mathjs instance (2^8 = 256)
  assert.strictEqual(mods.math.evaluate('2^8'), 256);
});

test('SETUP: $MODULE does not leak into Mods or appear as a key', async () => {
  const mods = await buildMods(ALL, 'LOW');
  // $MODULE should never appear as a key in mods
  assert.strictEqual(mods['$MODULE'], undefined);
  assert.ok(!Object.keys(mods).includes('$MODULE'), '$MODULE must not leak into Mods');
});
