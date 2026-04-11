import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { runNejy } from './helpers/run.mjs';

const redteamDir = path.join(import.meta.dirname, 'redteam');

if (fs.existsSync(redteamDir)) {
    const files = fs.readdirSync(redteamDir)
        .filter(f => f.endsWith('.yaml') || f.endsWith('.json'));

    for (const file of files) {
        test(`REDTEAM: ${file}`, async () => {
            const filePath = path.join(redteamDir, file);
            // The first word delimited by '-' or '.' indicates the policy
            const policyWord = file.split(/[-.]/)[0].toUpperCase();

            const r = await runNejy(filePath, policyWord);

            // A redteam test PASSES if it fails to execute normally (i.e. if the sandbox halts it).
            // It FAILS if the engine completes execution cleanly without terminating with an error.
            if (r.exitCode === 0 && !r.errorMsg) {
                assert.fail(`VULNERABILITY DETECTED: Script ${file} executed successfully under policy ${policyWord}. Redteam payload succeeded.`);
            } else {
                // Passed the safety check, meaning it crashed/errored correctly.
                assert.ok(true, `Secure: ${file} was correctly blocked.`);
            }
        });
    }
} else {
    // If directory doesn't exist, just pass silently or create it
    console.warn("tests/redteam/ directory not found.");
}
