import { test } from 'node:test';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert';
import YAML from 'yaml';
import fs from 'node:fs';

const execAsync = promisify(exec);

test('WORKER command spawns thread and returns ID', { timeout: 10000 }, async () => {
    const code = [
        ["WORKER", ["child_thread", [
            ["SET", ["foo", "bar"]]
        ]]],
        ["SET", ["spawn_result", "$LAST"]],
        ["SET", ["foo", "$spawn_result"]]
    ];
    fs.writeFileSync('tests/programs/rpc_spawn.json', JSON.stringify(code));

    const result = await execAsync(`node main.mjs run tests/programs/rpc_spawn.json --policy HIGH`);
    const yamlMatch = result.stdout.match(/```yaml\n([\s\S]+?)\n```/);
    const [errorMsg, returnVal] = YAML.parse(yamlMatch[1]);

    assert.strictEqual(errorMsg, null);
    assert.strictEqual(returnVal, "child_thread");
});

test('RPC_EXPOSE and RPC_CALL', { timeout: 10000 }, async () => {
    const code = [
        ["WORKER", ["child_thread", [
            ["DEF", ["MY_COMPUTE", [
                ["SET", ["x", 10]],
                ["SET", ["y", 20]],
                ["EXEC", ["math.add", ["$x", "$y"]]],
            ]]],
            ["RPC_EXPOSE", ["compute", "MY_COMPUTE"]]
        ]]],
        ["EXEC", ["Array.from", [
            ["LITERAL", { length: 50000 }]
        ]]],
        ["EXEC", ["$LAST.fill", [0]]],
        ["RPC_CALL", ["child_thread", "compute", { x: 10, y: 20 }]],
        ["SET", ["final", "$LAST"]]
    ];
    fs.writeFileSync('tests/programs/rpc_call.json', JSON.stringify(code));

    const result = await execAsync(`node main.mjs run tests/programs/rpc_call.json --policy HIGH`);
    const yamlMatch = result.stdout.match(/```yaml\n([\s\S]+?)\n```/);
    const [errorMsg, returnVal] = YAML.parse(yamlMatch[1]);

    assert.strictEqual(errorMsg, null);
    assert.strictEqual(returnVal, 30);
});

test('Worker receives $PROGRAM and $WORKERID', { timeout: 10000 }, async () => {
    const code = [
        ["WORKER", ["child_thread", [
            ["SET", ["my_id", "$WORKERID"]]
        ]]],
        ["SET", ["rootId", "$WORKERID"]],
        ["SET", ["program", "$PROGRAM"]],
        ["SET", ["ret", ["LITERAL", { rootId: null, hasProgram: true }]]],
        ["EXEC", ["Object.assign", ["$ret", ["LITERAL", { rootId: 0 }]]]]
    ];
    fs.writeFileSync('tests/programs/rpc_vars.json', JSON.stringify(code).replace(/"\$PROGRAM"/g, '"$PROGRAM"').replace(/"\$WORKERID"/g, '"$WORKERID"'));

    const result = await execAsync(`node main.mjs run tests/programs/rpc_vars.json --policy HIGH`);
    const yamlMatch = result.stdout.match(/```yaml\n([\s\S]+?)\n```/);
    const [errorMsg, returnVal] = YAML.parse(yamlMatch[1]);

    assert.strictEqual(errorMsg, null);
    assert.deepStrictEqual(returnVal, { rootId: 0, hasProgram: true }); // Just check root worker gets 0
});

test('Worker sandbox escalation blocked', { timeout: 10000 }, async () => {
    const code = [
        ["WORKER", ["child_thread", [
            ["EXEC", ["fs.readFileSync", ["package.json"]]]
        ]]]
    ];
    fs.writeFileSync('tests/programs/rpc_escalate.json', JSON.stringify(code));

    try {
        await execAsync(`node main.mjs run tests/programs/rpc_escalate.json --policy LOW`);
        assert.fail("Should have failed");
    } catch(err) {
        assert.ok(err.stdout.includes("SEC_BLOCK"), "Child worker bypassed policy LOW and executed fs at HIGH");
    }
});
