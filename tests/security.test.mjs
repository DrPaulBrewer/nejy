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

test('B07: LITERAL with prototype pollution is blocked at LOW risk (SEC_BLOCK)', async () => {
  const r = await runNejy('tests/programs/use-literal-proto.yaml', LOW);
  assert.notStrictEqual(r.exitCode, 0, 'Program should be killed/fail');
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'), 'Expected SEC_BLOCK in error message');
});

test('B08: Inline LITERAL with prototype pollution is blocked at LOW risk (SEC_BLOCK)', async () => {
  const r = await runNejy('tests/programs/use-inline-literal-proto.yaml', LOW);
  assert.notStrictEqual(r.exitCode, 0, 'Program should be killed/fail');
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'), 'Expected SEC_BLOCK in error message');
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
// Section B — Fixed by Stage 3 (Mods), hardened by Stage 4 (Scanner registry)
//
// Stage 3: these were blocked at runtime ("Link Fail: ...").
// Stage 4: these are now blocked at SCAN TIME ("SEC_BLOCK: ...").
// Tests verify the tighter SEC_BLOCK guarantee.
// ---------------------------------------------------------------------------

test('B01: eval is blocked at LOW risk (SEC_BLOCK at scan time)', async () => {
  const r = await runNejy('tests/programs/use-eval.yaml', LOW);
  assert.notStrictEqual(r.exitCode, 0, 'eval should be blocked');
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
    `Expected SEC_BLOCK, got: ${r.errorMsg}`);
});

test('B02: eval is blocked at HIGH risk (SEC_BLOCK at scan time — not in registry at any level)', async () => {
  const r = await runNejy('tests/programs/use-eval.yaml', HIGH);
  assert.notStrictEqual(r.exitCode, 0, 'eval should be blocked even at HIGH risk');
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
    `Expected SEC_BLOCK, got: ${r.errorMsg}`);
});

test('B03: process.exit is blocked and produces YAML output (SEC_BLOCK at scan time)', async () => {
  const r = await runNejy('tests/programs/use-process-exit.yaml', LOW);
  assert.notStrictEqual(r.exitCode, 0, 'process.exit should be blocked');
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
    `Expected SEC_BLOCK in YAML output, got: ${r.errorMsg}`);
});

test('B04: Object.setPrototypeOf is blocked at LOW risk (SEC_BLOCK — HIGH > LOW)', async () => {
  const r = await runNejy('tests/programs/use-object-setprototypeof.yaml', LOW);
  assert.notStrictEqual(r.exitCode, 0, 'Object.setPrototypeOf should be blocked at LOW');
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
    `Expected SEC_BLOCK, got: ${r.errorMsg}`);
});

test('B05: Object.setPrototypeOf is blocked at MEDIUM risk (SEC_BLOCK — HIGH > MEDIUM)', async () => {
  const r = await runNejy('tests/programs/use-object-setprototypeof.yaml', MEDIUM);
  assert.notStrictEqual(r.exitCode, 0, 'Object.setPrototypeOf should be blocked at MEDIUM');
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
    `Expected SEC_BLOCK, got: ${r.errorMsg}`);
});

test('B06: fs.writeFileSync is blocked at MEDIUM risk (SEC_BLOCK — HIGH > MEDIUM)', async () => {
  const r = await runNejy('tests/programs/use-fs-write.yaml', MEDIUM);
  assert.notStrictEqual(r.exitCode, 0, 'fs.writeFileSync should be blocked at MEDIUM');
  assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
    `Expected SEC_BLOCK, got: ${r.errorMsg}`);
});
