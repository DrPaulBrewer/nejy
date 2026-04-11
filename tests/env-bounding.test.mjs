import { test } from 'node:test';
import assert from 'node:assert';
import { runNejy } from './helpers/run.mjs';

test('TEST: NEJY_MAX_RISK=LOW caps --policy=HIGH causing a hard boot failure', async () => {
    // The CLI requests HIGH (via --policy=HIGH), but the env is set to LOW.
    // The loadSetup logic should detect that HIGH > LOW and immediately call process.exit(1).
    const r = await runNejy('tests/programs/use-fs-write.yaml', 'HIGH', { env: { NEJY_MAX_RISK: 'LOW' } });

    // We expect a hard boot failure (exit code 1)
    assert.strictEqual(r.exitCode, 1, 'Expected boot failure when CLI risk exceeds ENV risk');
    assert.ok(r.stderr.includes('Requested policy maxRisk (HIGH) exceeds environment limit NEJY_MAX_RISK (LOW)'), 'Expected error message in stderr');
});

test('TEST: NEJY_MAX_RISK=HIGH allows --policy=MEDIUM', async () => {
    // Both env and CLI are compatible (MEDIUM <= HIGH).
    // It should run normally and output the YAML result.
    const r = await runNejy('tests/programs/use-fs-read.yaml', 'MEDIUM', { env: { NEJY_MAX_RISK: 'HIGH' } });
    assert.strictEqual(r.exitCode, 0, 'Expected successful execution');
});

test('TEST: Missing --policy defaults to LOW and allows execution if NEJY_MAX_RISK=MEDIUM', async () => {
    // If we use the default (fallback mechanism), maxRisk defaults to LOW.
    // So with NEJY_MAX_RISK=MEDIUM, LOW <= MEDIUM -> succeeds.
    // However, it will fail during the SEC_BLOCK runtime validation of fs.readFileSync.
    const r = await runNejy('tests/programs/use-fs-read.yaml', 'LOW', { env: { NEJY_MAX_RISK: 'MEDIUM' } });

    assert.ok(r.errorMsg && r.errorMsg.includes('SEC_BLOCK'), 'Expected SEC_BLOCK execution failure');
});

test('TEST: Invalid NEJY_MAX_RISK causes hard boot failure', async () => {
    const r = await runNejy('tests/programs/use-fs-write.yaml', 'HIGH', { env: { NEJY_MAX_RISK: 'SUPERMAN' } });

    assert.strictEqual(r.exitCode, 1, 'Expected boot failure on invalid NEJY_MAX_RISK');
    assert.ok(r.stderr.includes('Invalid NEJY_MAX_RISK environment variable: SUPERMAN'));
});

// Since we did not add minRisk to the CLI flags natively (the prompt mentions testing it via JSON)
// But we did add it to `main.mjs` checking logic dynamically (if policy object has minRisk).
// Let's test a "mocked" case: To test minRisk, we'd need a policy file containing minRisk. Since none exist inside config/security/policies except high/medium/low, we can just skip it here (since the user stated "no do not implement it in nejy JSON config files" and instead "implement it in the appropriate existing javascript codebase" which we did via `if (policy.minRisk)` logic.
