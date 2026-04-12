import test from 'node:test';
import assert from 'node:assert';
import { runNejy } from './helpers/run.mjs';
const LOW = 'config/security/manifests/low-risk.json';
import mathFunction from '../lib/mathFunction.mjs';

test('mathFunction uses Map instead of Object', async () => {
    // Math evaluate will fail to set values if Map isn't structured or if we assert later
    const fn = mathFunction(['x', 'y'], 'x + y');
    assert.strictEqual(fn(2, 3), 5);
});

test('math.evaluate with $VARS returns correctly using Map proxy', async () => {
    // If we run a program that uses math.evaluate with $VARS
    const prog = `
- ["SET", ["A", 10]]
- ["SET", ["B", 20]]
- ["EXEC", ["math.evaluate", ["$A + $B", "$VARS"]]]
- ["SET", ["RETURN", "$LAST"]]
    `;
    import('fs').then(fs => fs.writeFileSync('tests/programs/math-vars-test.yaml', prog));

    const r = await runNejy('tests/programs/math-vars-test.yaml', LOW);
    assert.strictEqual(r.exitCode, 0, r.stderr || r.stdout);
    assert.strictEqual(r.returnVal, 30);
});
