/**
 * Shared test helper for running nejy programs as child processes.
 * Used by integration.test.mjs and security.test.mjs.
 */
import { exec } from 'node:child_process';
import YAML from 'yaml';

/**
 * Run a nejy program with a given policy manifest.
 * Returns structured result with exitCode, YAML-parsed output, and timeout info.
 *
 * @param {string} code - path to program file (relative to project root)
 * @param {string} policy - path to manifest file (relative to project root)
 * @param {object} opts
 * @param {number} opts.timeout - milliseconds before forcibly killing the process (default 10000)
 * @returns {Promise<{exitCode, killed, stdout, stderr, errorMsg, returnVal, usage}>}
 */
export async function runNejy(code, policy, { timeout = 10000, env = {} } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const policyName = policy.split('/').pop().replace('-risk.json','').replace('-net.json','').toUpperCase();
    const proc = exec(
      `node nejy.mjs run "${code}" --policy="${policyName}"`,
      { shell: '/bin/bash', timeout, env: { ...process.env, ...env } },
      (err, out, err2) => {
        if (err && err.killed) killed = true;
        stdout = out || '';
        stderr = err2 || '';
      }
    );

    proc.on('close', (exitCode) => {
      // Parse structured YAML output block
      const yamlMatch = stdout.match(/```yaml\n([\s\S]+?)\n```/);
      let errorMsg = null;
      let returnVal = null;
      let usage = null;

      if (yamlMatch) {
        try {
          const parsed = YAML.parse(yamlMatch[1]);
          if (Array.isArray(parsed)) {
            [errorMsg, returnVal, usage] = parsed;
          }
        } catch (_) {}
      }

      resolve({
        exitCode: exitCode ?? 0,
        killed,
        stdout,
        stderr,
        errorMsg,
        returnVal,
        usage,
      });
    });
  });
}
