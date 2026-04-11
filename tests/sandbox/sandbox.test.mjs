import { test } from 'node:test';
import assert from 'node:assert';
import { runNejy } from '../helpers/run.mjs';
import fs from 'node:fs';

const LOW    = 'config/security/manifests/low-risk.json';
const MEDIUM = 'config/security/manifests/medium-net.json';
const HIGH   = 'config/security/manifests/high-net.json';

test('SANDBOX: "copy" isolates variables and returns $RETURN as $LAST', async () => {
    const codePath = 'tests/sandbox/test_copy.json';
    const program = [
        ["SET", ["foo", "bar"]],
        ["SANDBOX", ["copy", [
            ["SET", ["foo", "modified"]],
            ["SET", ["RETURN", "$foo"]]
        ]]],
        // We set $RETURN at the end so it propagates out
        ["SET", ["RETURN", ["$foo", "$LAST"]]]
    ];
    fs.writeFileSync(codePath, JSON.stringify(program));
    const result = await runNejy(codePath, LOW);
    fs.unlinkSync(codePath);

    assert.strictEqual(result.exitCode, 0, result.errorMsg || result.stderr);
    assert.deepStrictEqual(result.returnVal, ["bar", "modified"]);
});

test('SANDBOX: empty config {} provides no capabilities or variables', async () => {
    const codePath = 'tests/sandbox/test_empty.json';
    const program = [
        ["SET", ["foo", "bar"]],
        ["SANDBOX", [{}, [
            ["TO", ["bar", "$foo"]], // $foo should be null/undefined
            ["SET", ["RETURN", "$bar"]]
        ]]]
    ];
    fs.writeFileSync(codePath, JSON.stringify(program));
    const result = await runNejy(codePath, LOW);
    fs.unlinkSync(codePath);

    assert.strictEqual(result.exitCode, 0, result.errorMsg || result.stderr);
    assert.strictEqual(result.returnVal, null); // because $foo wasn't passed in
});

test('SANDBOX: escalates capabilities -> SEC_BLOCK', async () => {
    const codePath = 'tests/sandbox/test_escalate.json';
    const program = [
        ["SANDBOX", [{ capabilities: ["fs.writeFileSync"] }, [
            ["SET", ["RETURN", "ok"]]
        ]]]
    ];
    fs.writeFileSync(codePath, JSON.stringify(program));
    const result = await runNejy(codePath, LOW); // LOW manifest doesn't have fs.writeFileSync
    fs.unlinkSync(codePath);

    assert.strictEqual(result.exitCode, 1);
    assert.match(result.errorMsg, /SEC_BLOCK/);
});

test('SANDBOX: valid subset capabilities succeeds', async () => {
    const codePath = 'tests/sandbox/test_subset.json';
    const program = [
        ["REQUEST", ["console.log", "math.evaluate"]],
        ["SANDBOX", [{ capabilities: ["math.evaluate"] }, [
            ["EXEC", ["math.evaluate", ["1 + 1"]]],
            ["SET", ["RETURN", "$LAST"]]
        ]]]
    ];
    fs.writeFileSync(codePath, JSON.stringify(program));
    const result = await runNejy(codePath, LOW);
    fs.unlinkSync(codePath);

    assert.strictEqual(result.exitCode, 0, result.errorMsg || result.stderr);
    assert.strictEqual(result.returnVal, 2);
});

test('SANDBOX: context array deeply copies specific vars', async () => {
    const codePath = 'tests/sandbox/test_ctx_arr.json';
    const program = [
        ["SET", ["obj", { a: 1 }]],
        ["SET", ["ignored", "hello"]],
        ["SANDBOX", [{ context: ["$obj"] }, [
            // should not see $ignored
            ["TO", ["temp_ignored", "$ignored"]],
            // modify $obj to prove isolation
            ["SET", ["obj", { a: 2 }]],
            ["SET", ["RETURN", ["$obj", "$temp_ignored"]]]
        ]]],
        ["SET", ["RETURN", ["$obj", "$LAST"]]]
    ];
    fs.writeFileSync(codePath, JSON.stringify(program));
    const result = await runNejy(codePath, LOW);
    fs.unlinkSync(codePath);

    assert.strictEqual(result.exitCode, 0, result.errorMsg || result.stderr);
    // [ parent_obj, [ sandbox_obj, sandbox_ignored ] ]
    assert.deepStrictEqual(result.returnVal, [{a: 1}, [{a: 2}, null]]);
});

test('SANDBOX: context object sets new initial vars', async () => {
    const codePath = 'tests/sandbox/test_ctx_obj.json';
    const program = [
        ["SANDBOX", [{ context: { "$foo": "bar" } }, [
            ["SET", ["RETURN", "$foo"]]
        ]]]
    ];
    fs.writeFileSync(codePath, JSON.stringify(program));
    const result = await runNejy(codePath, LOW);
    fs.unlinkSync(codePath);

    assert.strictEqual(result.exitCode, 0, result.errorMsg || result.stderr);
    assert.strictEqual(result.returnVal, "bar");
});

test('SANDBOX: functions are inherited but isolated', async () => {
    const codePath = 'tests/sandbox/test_funcs.json';
    const program = [
        ["DEF", ["HELLO", [
            ["SET", ["LAST", "world"]]
        ]]],
        ["SANDBOX", ["copy", [
            ["CALL", ["HELLO"]],
            ["TO", ["first", "$LAST"]],
            ["DEF", ["LOCAL", [
                ["SET", ["LAST", "local"]]
            ]]],
            ["CALL", ["LOCAL"]],
            ["SET", ["RETURN", ["$first", "$LAST"]]]
        ]]],
        ["TO", ["sb_res", "$LAST"]],
        // CALL LOCAL should fail in parent
        ["TRY", [
            [["CALL", ["LOCAL"]]],
            [["SET", ["RETURN", ["$sb_res", "$ERROR"]]]]
        ]]
    ];
    fs.writeFileSync(codePath, JSON.stringify(program));
    const result = await runNejy(codePath, LOW);
    fs.unlinkSync(codePath);

    assert.strictEqual(result.exitCode, 0, result.errorMsg || result.stderr);
    assert.deepStrictEqual(result.returnVal[0], ["world", "local"]);
    assert.match(result.returnVal[1], /Fn Undefined: LOCAL/);
});
