import { test } from 'node:test';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert';
import YAML from 'yaml';

const execAsync = promisify(exec);

// Define variables to support the unquoted diff provided by the user
const i_timeout = "i-timeout";
const e_timeout = "e-timeout";

/**
 * Parameterized list of test cases.
 * Each object contains the program path, policy path, and whether it's expected to pass (ok).
 * Failure is defined as (exit code !== 0).
 */
const testCases = [
  // examples/os/health_report.yaml
  { code: "examples/os/health_report.yaml", policy: "LOW", ok: false },
  { code: "examples/os/health_report.yaml", policy: "MEDIUM", ok: true },
  { code: "examples/os/health_report.yaml", policy: "HIGH", ok: true },

  // examples/os/health_pipe.yaml
  { code: "examples/os/health_pipe.yaml", policy: "LOW", ok: false },
  { code: "examples/os/health_pipe.yaml", policy: "MEDIUM", ok: true },
  { code: "examples/os/health_pipe.yaml", policy: "HIGH", ok: true },

  // examples/simple/failing_program.json (HIGH risk - uses child_process and IMPORT)
  { code: "examples/simple/failing_program.json", policy: "LOW", ok: false },
  { code: "examples/simple/failing_program.json", policy: "MEDIUM", ok: false },
  { code: "examples/simple/failing_program.json", policy: "HIGH", ok: true },

  // examples/simple/passing_program.json (LOW risk)
  { code: "examples/simple/passing_program.json", policy: "LOW", ok: true },
  { code: "examples/simple/passing_program.json", policy: "MEDIUM", ok: true },
  { code: "examples/simple/passing_program.json", policy: "HIGH", ok: true },

  // examples/cpu_intensive/pi.json (LOW risk commands, but high CPU usage)
  { code: "examples/cpu_intensive/pi.json", policy: "LOW", ok: i_timeout },
  { code: "examples/cpu_intensive/pi.json", policy: "MEDIUM", ok: i_timeout }, // Hits quota
  { code: "examples/cpu_intensive/pi.json", policy: "HIGH", ok: i_timeout }, // Hits quota

  // examples/cpu_intensive/pi-math.json (LOW risk)
  { code: "examples/cpu_intensive/pi-math.json", policy: "LOW", ok: i_timeout },
  { code: "examples/cpu_intensive/pi-math.json", policy: "MEDIUM", ok: i_timeout },
  { code: "examples/cpu_intensive/pi-math.json", policy: "HIGH", ok: i_timeout },

  // examples/cpu_intensive/pi.yaml (LOW risk)
  { code: "examples/cpu_intensive/pi.yaml", policy: "LOW", ok: i_timeout },
  { code: "examples/cpu_intensive/pi.yaml", policy: "MEDIUM", ok: i_timeout },
  { code: "examples/cpu_intensive/pi.yaml", policy: "HIGH", ok: i_timeout },

  // examples/cpu_intensive/pi-compiled.json (LOW risk)
  { code: "examples/cpu_intensive/pi-compiled.json", policy: "LOW", ok: i_timeout },
  { code: "examples/cpu_intensive/pi-compiled.json", policy: "MEDIUM", ok: i_timeout },
  { code: "examples/cpu_intensive/pi-compiled.json", policy: "HIGH", ok: i_timeout },

  // examples/cpu_intensive/pi-pipe.yaml (LOW risk)
  { code: "examples/cpu_intensive/pi-pipe.yaml", policy: "LOW", ok: i_timeout },
  { code: "examples/cpu_intensive/pi-pipe.yaml", policy: "MEDIUM", ok: i_timeout },
  { code: "examples/cpu_intensive/pi-pipe.yaml", policy: "HIGH", ok: i_timeout },

  // examples/cpu_intensive/pi-turbo-nilakantha.yaml (LOW risk)
  { code: "examples/cpu_intensive/pi-turbo-nilakantha.yaml", policy: "LOW", ok: i_timeout },
  { code: "examples/cpu_intensive/pi-turbo-nilakantha.yaml", policy: "MEDIUM", ok: i_timeout },
  { code: "examples/cpu_intensive/pi-turbo-nilakantha.yaml", policy: "HIGH", ok: i_timeout }
];

testCases.forEach(({ code, policy, ok }) => {
  test(`nejy run ${code} --policy ${policy} (expected ok: ${ok})`, { timeout: 15000 }, async () => {
    let stdout, stderr, killed = false, exitCode = 0;
    try {
      const result = await execAsync(`node main.mjs run "${code}" --policy="${policy}"`, {
        shell: '/bin/bash',
        timeout: 10000
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      stdout = error.stdout || "";
      stderr = error.stderr || "";
      exitCode = error.code || 0;
      killed = error.killed || false;
    }

    // 1. Check for Environment Timeout (e-timeout)
    if (ok === e_timeout) {
      assert.strictEqual(killed, true, `Expected environment timeout (e-timeout) but process was not killed. Exit code: ${exitCode}\nStdout: ${stdout}\nStderr: ${stderr}`);
      return;
    }

    // Process was not killed, check YAML output
    const yamlMatch = stdout.match(/```yaml\n([\s\S]+?)\n```/);
    assert.ok(yamlMatch, `Could not find YAML output block in stdout.\nStdout: ${stdout}\nStderr: ${stderr}`);

    const [errorMsg, returnVal, usage] = YAML.parse(yamlMatch[1]);

    if (ok === true) {
      assert.strictEqual(exitCode, 0, `Expected success but got exit code ${exitCode}.\nError in YAML: ${errorMsg}\nStderr: ${stderr}`);
      assert.strictEqual(errorMsg, null, `Expected null error in YAML, but got: ${errorMsg}`);
      assert.ok(usage && typeof usage === 'object', `Expected usage object in YAML, but got: ${JSON.stringify(usage)}`);
    } else if (ok === false) {
      assert.notStrictEqual(exitCode, 0, `Expected failure but got exit code 0.\nStdout: ${stdout}`);
      assert.notStrictEqual(errorMsg, null, `Expected an error message in YAML, but got null.`);
      // usage may be null if scanner blocked before the monitor was created
    } else if (ok === i_timeout) {
      assert.notStrictEqual(exitCode, 0, `Expected interpreter quota timeout but got exit code 0.`);
      assert.strictEqual(errorMsg, "QUOTA_EXCEEDED", `Expected error message 'QUOTA_EXCEEDED', but got: ${errorMsg}`);
      assert.ok(usage && typeof usage === 'object', `Expected usage object in YAML, but got: ${JSON.stringify(usage)}`);
    }
  });
});
