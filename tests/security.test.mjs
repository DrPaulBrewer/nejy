/**
 * tests/security.test.mjs — Stage 0 Baseline Security Tests
 *
 * Two sections:
 *
 * Section A — "Currently Correct": behavior that should already be right.
 *   These tests pass now and must continue to pass through all stages.
 *
 * Section B — "Known Gaps": behavior that is currently WRONG.
 *   These tests are marked { todo: true } and document what must be fixed
 *   in Stages 3–4. They will be converted to normal tests as gaps are closed.
 *
 * "The first principle is that you must not fool yourself — and you are the
 *  easiest person to fool." — Richard Feynman
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { runNejy } from './helpers/run.mjs';

const LOW    = 'config/security/manifests/low-risk.json';
const MEDIUM = 'config/security/manifests/medium-net.json';
const HIGH   = 'config/security/manifests/high-net.json';

// ---------------------------------------------------------------------------
// Section A — Currently Correct
// ---------------------------------------------------------------------------

test('A01: math.evaluate succeeds at LOW risk', async () => {
  const r = await runNejy('tests/programs/use-math-evaluate.yaml', LOW);
  assert.strictEqual(r.exitCode, 0, `Expected exit 0, got ${r.exitCode}\nStdout: ${r.stdout}`);
  assert.strictEqual(r.errorMsg, null, `Expected null error, got: ${r.errorMsg}`);
  assert.ok(r.usage && typeof r.usage === 'object', 'Expected usage object');
});

test('A02: math.evaluate succeeds at MEDIUM risk', async () => {
  const r = await runNejy('tests/programs/use-math-evaluate.yaml', MEDIUM);
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.errorMsg, null);
});

test('A03: fs.readFileSync blocked at LOW risk (SEC_BLOCK)', async () => {
  const r = await runNejy('tests/programs/use-fs-read.yaml', LOW);
  assert.notStrictEqual(r.exitCode, 0, 'Expected non-zero exit for SEC_BLOCK');
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
    `Expected SEC_BLOCK in error, got: ${r.errorMsg}`);
});

test('A04: fs.readFileSync succeeds at MEDIUM risk', async () => {
  const r = await runNejy('tests/programs/use-fs-read.yaml', MEDIUM);
  assert.strictEqual(r.exitCode, 0, `Expected exit 0, got ${r.exitCode}\n${r.stdout}`);
  assert.strictEqual(r.errorMsg, null);
});


test('A06: fs.writeFileSync succeeds at HIGH risk', async () => {
  const r = await runNejy('tests/programs/use-fs-write.yaml', HIGH);
  assert.strictEqual(r.exitCode, 0, `Expected exit 0, got ${r.exitCode}\n${r.stdout}`);
  assert.strictEqual(r.errorMsg, null);
});

test('A07: child_process blocked at LOW risk (SEC_BLOCK)', async () => {
  const r = await runNejy('tests/programs/use-child-process.yaml', LOW);
  assert.notStrictEqual(r.exitCode, 0);
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
    `Expected SEC_BLOCK, got: ${r.errorMsg}`);
});

test('A08: child_process blocked at MEDIUM risk (SEC_BLOCK)', async () => {
  const r = await runNejy('tests/programs/use-child-process.yaml', MEDIUM);
  assert.notStrictEqual(r.exitCode, 0);
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
    `Expected SEC_BLOCK, got: ${r.errorMsg}`);
});

test('A09: child_process.execSync succeeds at HIGH risk', async () => {
  const r = await runNejy('tests/programs/use-child-process.yaml', HIGH);
  assert.strictEqual(r.exitCode, 0, `Expected exit 0, got ${r.exitCode}\n${r.stdout}`);
  assert.strictEqual(r.errorMsg, null);
});

test('A10: os.hostname blocked at LOW risk (SEC_BLOCK)', async () => {
  const r = await runNejy('tests/programs/use-os-hostname.yaml', LOW);
  assert.notStrictEqual(r.exitCode, 0);
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
    `Expected SEC_BLOCK, got: ${r.errorMsg}`);
});

test('A11: os.hostname succeeds at MEDIUM risk', async () => {
  const r = await runNejy('tests/programs/use-os-hostname.yaml', MEDIUM);
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.errorMsg, null);
});

// ---------------------------------------------------------------------------
// Section B — Previously Known Gaps, now fixed by Stage 3 (Mods replaces global)
//
// eval, process, and Object.setPrototypeOf are no longer reachable because
// ctx.mods does not expose them. This produces "Link Fail: <path>" at runtime.
// Stage 4 will additionally block them at scan time with SEC_BLOCK.
// ---------------------------------------------------------------------------

test('B01: eval is blocked at LOW risk (Link Fail — not in Mods)', async () => {
  const r = await runNejy('tests/programs/use-eval.yaml', LOW);
  assert.notStrictEqual(r.exitCode, 0, 'eval should be blocked; expected non-zero exit');
  assert.ok(r.errorMsg !== null, `Expected an error message, got: ${r.errorMsg}`);
});

test('B02: eval is blocked at HIGH risk (Link Fail — not in Mods at any level)', async () => {
  const r = await runNejy('tests/programs/use-eval.yaml', HIGH);
  assert.notStrictEqual(r.exitCode, 0, 'eval should be blocked even at HIGH risk');
  assert.ok(r.errorMsg !== null, `Expected an error message, got: ${r.errorMsg}`);
});

test('B03: process.exit is blocked and produces YAML output (Link Fail — process not in Mods)', async () => {
  const r = await runNejy('tests/programs/use-process-exit.yaml', LOW);
  // After Stage 3: runs() catches Link Fail, boot() produces YAML before exit
  assert.notStrictEqual(r.exitCode, 0, 'process.exit should be blocked; expected non-zero exit');
  assert.ok(r.errorMsg !== null, `Expected an error in YAML output, got: ${r.errorMsg}\nStdout: ${r.stdout}`);
});

test('B04: Object.setPrototypeOf is blocked at LOW risk (Proxy returns undefined — not in Mods at LOW)', async () => {
  const r = await runNejy('tests/programs/use-object-setprototypeof.yaml', LOW);
  assert.notStrictEqual(r.exitCode, 0, 'Object.setPrototypeOf should be blocked at LOW');
  assert.ok(r.errorMsg !== null, `Expected an error message, got: ${r.errorMsg}`);
});

test('B05: Object.setPrototypeOf is blocked at MEDIUM risk (Proxy returns undefined — HIGH > MEDIUM)', async () => {
  const r = await runNejy('tests/programs/use-object-setprototypeof.yaml', MEDIUM);
  assert.notStrictEqual(r.exitCode, 0, 'Object.setPrototypeOf should be blocked at MEDIUM');
  assert.ok(r.errorMsg !== null, `Expected an error message, got: ${r.errorMsg}`);
});

test('B06: fs.writeFileSync is blocked at MEDIUM risk (not in mods.fs at MEDIUM — HIGH > MEDIUM)', async () => {
  const r = await runNejy('tests/programs/use-fs-write.yaml', MEDIUM);
  assert.notStrictEqual(r.exitCode, 0, 'fs.writeFileSync should be blocked at MEDIUM');
  assert.ok(r.errorMsg !== null, `Expected an error message, got: ${r.errorMsg}`);
});
