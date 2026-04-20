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
    try {
        const result = await runNejy(codePath, LOW);
        assert.strictEqual(result.exitCode, 0, result.errorMsg || result.stderr);
        assert.deepStrictEqual(result.returnVal, ["bar", "modified"]);
    } finally {
        fs.unlinkSync(codePath);
    }
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
    try {
        const result = await runNejy(codePath, LOW);
        assert.strictEqual(result.exitCode, 0, result.errorMsg || result.stderr);
        assert.strictEqual(result.returnVal, null); // because $foo wasn't passed in
    } finally {
        fs.unlinkSync(codePath);
    }
});

test('SANDBOX: escalates capabilities -> SEC_BLOCK', async () => {
    const codePath = 'tests/sandbox/test_escalate.json';
    const program = [
        ["SANDBOX", [{ capabilities: ["fs.writeFileSync"] }, [
            ["SET", ["RETURN", "ok"]]
        ]]]
    ];
    fs.writeFileSync(codePath, JSON.stringify(program));
    try {
        const result = await runNejy(codePath, LOW); // LOW manifest doesn't have fs.writeFileSync
        assert.strictEqual(result.exitCode, 1);
        assert.match(result.errorMsg, /SEC_BLOCK/);
    } finally {
        fs.unlinkSync(codePath);
    }
});

test('SANDBOX: valid subset capabilities succeeds', async () => {
    const codePath = 'tests/sandbox/test_subset.json';
    const program = [
        ["REQUEST", ["console.log", "math.evaluate"]],
        ["SANDBOX", [{ capabilities: ["math.evaluate"] }, [
            [" 1 + 1"],
            ["SET", ["RETURN", "$LAST"]]
        ]]]
    ];
    fs.writeFileSync(codePath, JSON.stringify(program));
    try {
        const result = await runNejy(codePath, LOW);
        assert.strictEqual(result.exitCode, 0, result.errorMsg || result.stderr);
        assert.strictEqual(result.returnVal, 2);
    } finally {
        fs.unlinkSync(codePath);
    }
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
    try {
        const result = await runNejy(codePath, LOW);
        assert.strictEqual(result.exitCode, 0, result.errorMsg || result.stderr);
        // [ parent_obj, [ sandbox_obj, sandbox_ignored ] ]
        assert.deepStrictEqual(result.returnVal, [{a: 1}, [{a: 2}, null]]);
    } finally {
        fs.unlinkSync(codePath);
    }
});

test('SANDBOX: context object sets new initial vars', async () => {
    const codePath = 'tests/sandbox/test_ctx_obj.json';
    const program = [
        ["SANDBOX", [{ context: { "$foo": "bar" } }, [
            ["SET", ["RETURN", "$foo"]]
        ]]]
    ];
    fs.writeFileSync(codePath, JSON.stringify(program));
    try {
        const result = await runNejy(codePath, LOW);
        assert.strictEqual(result.exitCode, 0, result.errorMsg || result.stderr);
        assert.strictEqual(result.returnVal, "bar");
    } finally {
        fs.unlinkSync(codePath);
    }
});

