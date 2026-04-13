import { test } from 'node:test';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert';
import YAML from 'yaml';
import fs from 'node:fs';

const execAsync = promisify(exec);

test('CPU command requires MEDIUM risk', { timeout: 10000 }, async () => {
    const code = [
        ["CPU", ["math.evaluate", ["1+1"]]]
    ];
    fs.writeFileSync('tests/programs/cpu_test.json', JSON.stringify(code));

    try {
        await execAsync(`node main.mjs run tests/programs/cpu_test.json --policy LOW`);
        assert.fail("Should have failed");
    } catch(err) {
        assert.ok(err.stdout.includes("SEC_BLOCK"), "CPU block should fail at LOW risk");
    }
});

test('CPU command succeeds at MEDIUM risk and returns value', { timeout: 10000 }, async () => {
    const code = [
        ["CPU", ["math.evaluate", ["1+1"]]]
    ];
    fs.writeFileSync('tests/programs/cpu_test.json', JSON.stringify(code));

    const result = await execAsync(`node main.mjs run tests/programs/cpu_test.json --policy MEDIUM`);
    const yamlMatch = result.stdout.match(/```yaml\n([\s\S]+?)\n```/);
    const [errorMsg, returnVal] = YAML.parse(yamlMatch[1]);

    assert.strictEqual(errorMsg, null);
    assert.strictEqual(returnVal, 2);
});
