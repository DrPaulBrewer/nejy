/**
 * tests/request.test.mjs — Stage 5: REQUEST Command Tests
 *
 * Verifies that:
 *   1. REQUEST at the top of a program restricts callable paths to the declared set.
 *   2. Programs without REQUEST get full manifest capabilities (backwards compatible).
 *   3. REQUEST items exceeding maxRisk are blocked at scan time.
 *   4. REQUEST appearing after any executable step is blocked.
 *   5. Whole-module REQUEST grants all allowed methods of that module.
 *
 * "The first principle is that you must not fool yourself — and you are the
 *  easiest person to fool."  — Richard Feynman
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { runNejy } from './helpers/run.mjs';

const LOW    = 'config/security/manifests/low-risk.json';
const MEDIUM = 'config/security/manifests/medium-net.json';
const HIGH   = 'config/security/manifests/high-net.json';

// ---------------------------------------------------------------------------
// C01 – C05: Basic REQUEST behaviour
// ---------------------------------------------------------------------------

test('C01: program with correct REQUEST succeeds', async () => {
    const r = await runNejy('tests/programs/request-math-and-console.yaml', LOW);
    assert.strictEqual(r.exitCode, 0,
        `Expected exit 0\nStdout: ${r.stdout}\nStderr: ${r.stderr}`);
    assert.strictEqual(r.errorMsg, null,
        `Expected null error, got: ${r.errorMsg}`);
});

test('C02: program without REQUEST gets full manifest capabilities (backwards compat)', async () => {
    // use-math-evaluate.yaml has no REQUEST; must still work exactly as before.
    const r = await runNejy('tests/programs/use-math-evaluate.yaml', LOW);
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.errorMsg, null);
});

test('C03: EXEC of un-REQUESTed path is SEC_BLOCK at scan time', async () => {
    // Program REQUESTs only "math" but EXECs "console.log".
    const r = await runNejy('tests/programs/request-math-use-console.yaml', LOW);
    assert.notStrictEqual(r.exitCode, 0, 'Expected non-zero exit for SEC_BLOCK');
    assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
        `Expected SEC_BLOCK, got: ${r.errorMsg}`);
    assert.ok(r.errorMsg.includes('console.log'),
        `Error should mention 'console.log', got: ${r.errorMsg}`);
    assert.ok(r.errorMsg.includes('REQUEST'),
        `Error should mention 'REQUEST', got: ${r.errorMsg}`);
});

test('C04: REQUEST of capability exceeding maxRisk is SEC_BLOCK', async () => {
    // fs.writeFileSync is HIGH risk; requesting it under LOW → SEC_BLOCK.
    const r = await runNejy('tests/programs/request-exceeds-maxrisk.yaml', LOW);
    assert.notStrictEqual(r.exitCode, 0);
    assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
        `Expected SEC_BLOCK, got: ${r.errorMsg}`);
});

test('C05: REQUEST of entire module grants all methods within maxRisk', async () => {
    // REQUEST ["os", "console.log"]; uses os.hostname (MEDIUM) + console.log (LOW).
    const r = await runNejy('tests/programs/request-os-module.yaml', MEDIUM);
    assert.strictEqual(r.exitCode, 0,
        `Expected exit 0\nStdout: ${r.stdout}\nStderr: ${r.stderr}`);
    assert.strictEqual(r.errorMsg, null);
});

test('C06: REQUEST of entire "os" module at LOW is SEC_BLOCK (os requires MEDIUM)', async () => {
    // "os" module base risk is MEDIUM; requesting it under LOW → SEC_BLOCK.
    const r = await runNejy('tests/programs/request-os-module.yaml', LOW);
    assert.notStrictEqual(r.exitCode, 0);
    assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
        `Expected SEC_BLOCK, got: ${r.errorMsg}`);
});

test('C07: REQUEST appearing after EXEC is SEC_BLOCK', async () => {
    // EXEC console.log then REQUEST math — REQUEST is not first → blocked.
    const r = await runNejy('tests/programs/request-after-exec.yaml', LOW);
    assert.notStrictEqual(r.exitCode, 0);
    assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'),
        `Expected SEC_BLOCK, got: ${r.errorMsg}`);
    assert.ok(r.errorMsg.includes('REQUEST'),
        `Error should mention 'REQUEST', got: ${r.errorMsg}`);
});

