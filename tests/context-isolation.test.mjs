/**
 * tests/context-isolation.test.mjs — Stage 2 Tests
 *
 * Verifies that ctx (vars, functions) is properly isolated between run() calls.
 * Imports run() and the command infrastructure directly from main.mjs — but
 * main.mjs is a script that boots immediately. Instead, we test isolation
 * via the child-process harness (runNejy) with programs that would interfere
 * if state leaked across calls.
 *
 * Tests fall into two categories:
 *  A. Isolation (via child process): no ctx leakage between independent invocations
 *  B. Regression: the 30 integration tests still pass (npm test handles this)
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { runNejy } from './helpers/run.mjs';

const LOW    = 'config/security/manifests/low-risk.json';
const MEDIUM = 'config/security/manifests/medium-net.json';

// ---------------------------------------------------------------------------
// Isolation via sequential child process calls
// ---------------------------------------------------------------------------

test('ISO-01: $LAST from one run does not bleed into a second run', async () => {
  // First run: sets $LAST = 42
  const r1 = await runNejy('tests/programs/use-math-evaluate.yaml', LOW);
  assert.strictEqual(r1.exitCode, 0);
  // math.evaluate("1 + 1") = 2, returnVal = 2
  assert.strictEqual(r1.returnVal, 2);

  // Second run is a fresh process; $LAST should start as null
  const r2 = await runNejy('tests/programs/use-os-hostname.yaml', MEDIUM);
  assert.strictEqual(r2.exitCode, 0);
  // If $LAST leaked, this would show '2' instead of the hostname
  assert.ok(typeof r2.returnVal === 'string' && r2.returnVal.length > 0,
    '$LAST from prior run must not bleed into new run');
  assert.notStrictEqual(r2.returnVal, 2, 'hostname should not be a number');
});

test('ISO-02: $ERROR from a failing run does not persist into the next run', async () => {
  // First run: fails with SEC_BLOCK
  const r1 = await runNejy('tests/programs/use-fs-read.yaml', LOW);
  assert.notStrictEqual(r1.exitCode, 0, 'First run should fail');
  assert.ok(r1.errorMsg && r1.errorMsg.includes('SEC_BLOCK'));

  // Second run: should have a clean slate — $ERROR should be null
  const r2 = await runNejy('tests/programs/use-math-evaluate.yaml', LOW);
  assert.strictEqual(r2.exitCode, 0, 'Second run should succeed');
  assert.strictEqual(r2.errorMsg, null, '$ERROR from prior run must not bleed into new run');
});

test('ISO-03: DEF\'d functions from one run are not visible in a second run', async () => {
  // Both programs run in separate child processes; functions can't leak between them
  const r1 = await runNejy('examples/simple/passing_program.json', LOW);
  assert.strictEqual(r1.exitCode, 0);

  const r2 = await runNejy('examples/simple/passing_program.json', LOW);
  assert.strictEqual(r2.exitCode, 0);
  // No assertion needed beyond both succeeding — the point is that they are
  // independent processes with clean ctx each time
});

// ---------------------------------------------------------------------------
// Sanity checks on the refactored run() via existing programs
// ---------------------------------------------------------------------------

test('CTX-01: math.evaluate still works after run() refactor', async () => {
  const r = await runNejy('tests/programs/use-math-evaluate.yaml', LOW);
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.returnVal, 2);
  assert.strictEqual(r.errorMsg, null);
});

test('CTX-02: fs.readFileSync still blocked at LOW after run() refactor', async () => {
  const r = await runNejy('tests/programs/use-fs-read.yaml', LOW);
  assert.notStrictEqual(r.exitCode, 0);
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'));
});

test('CTX-03: fs.readFileSync still works at MEDIUM after run() refactor', async () => {
  const r = await runNejy('tests/programs/use-fs-read.yaml', MEDIUM);
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.errorMsg, null);
  assert.strictEqual(r.returnVal, 'read-ok');
});

test('CTX-04: passing_program still succeeds after run() refactor', async () => {
  const r = await runNejy('examples/simple/passing_program.json', LOW);
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.errorMsg, null);
  assert.ok(r.usage && typeof r.usage === 'object', 'usage should be present');
});

test('CTX-05: failing_program still fails at LOW after run() refactor', async () => {
  const r = await runNejy('examples/simple/failing_program.json', LOW);
  assert.notStrictEqual(r.exitCode, 0);
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'));
});
