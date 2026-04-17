import test from 'node:test';
import assert from 'node:assert';
import { runNejy } from './helpers/run.mjs';
const LOW = 'config/security/manifests/low-risk.json';
import { run } from '../lib/interp/commands.mjs';

test('MATH command uses Map instead of Object and handles destructuring', async () => {
    const OriginalMap = Map;
    let mapCalled = false;
    global.Map = class SpyMap extends OriginalMap {
        constructor(iterable) {
            super(iterable);
            mapCalled = true;
        }
    };

    const ctx = { vars: {}, mods: {}, mon: { checkResources: () => {} } };

    try {
        await run([
            ["MATH", ["myMathFn", ["x", "y", { objVal: "z" }], "x + y + z"]]
        ], ctx);

        assert.strictEqual(typeof ctx.vars.$myMathFn, 'function');
        const res = ctx.vars.$myMathFn(2, 3, { objVal: 5 });
        assert.strictEqual(res, 10);
        assert.ok(mapCalled, 'MATH must construct a Map to pass to math.evaluate');
    } finally {
        global.Map = OriginalMap;
    }
});

test('MATH and F commands append themselves to ctx.history', async () => {
    const ctx = { vars: {}, mods: {}, history: [], mon: { checkResources: () => {} } };

    await run([
        ["MATH", ["myMathFn", ["x", "y"], "x + y"]],
        ["F", ["myFFn", ["a"], [["SET", ["RESULT", "a"]]]]]
    ], ctx);

    assert.strictEqual(ctx.history.length, 2);
    assert.deepStrictEqual(ctx.history[0], ["MATH", ["myMathFn", ["x", "y"], "x + y"]]);
    assert.deepStrictEqual(ctx.history[1], ["F", ["myFFn", ["a"], [["SET", ["RESULT", "a"]]]]]);
});

test('MATH command rejects pass-by-reference (&)', async () => {
    const ctx = { vars: {}, mods: {}, mon: { checkResources: () => {} } };

    try {
        await run([
            ["MATH", ["myMathFn", ["&x", "y"], "x + y"]]
        ], ctx);
        assert.fail('Should have thrown an error for & prefix');
    } catch (e) {
        assert.match(e.message, /Command parsing error: MATH does not support pass-by-reference/);
    }
});

test('math.evaluate with $VARS returns correctly using Map proxy', async () => {
    // If we run a program that uses math.evaluate with $VARS
    const prog = `
- ["SET", ["A", 10]]
- ["SET", ["B", 20]]
- ["EXEC", ["math.evaluate", ["$A + $B", "$VARS"]]]
- ["SET", ["RETURN", "$LAST"]]
    `;
    const fs = await import('fs');
    fs.writeFileSync('tests/programs/math-vars-test.yaml', prog);

    const r = await runNejy('tests/programs/math-vars-test.yaml', LOW);
    assert.strictEqual(r.exitCode, 0, r.stderr || r.stdout);
    assert.strictEqual(r.returnVal, 30);
});
