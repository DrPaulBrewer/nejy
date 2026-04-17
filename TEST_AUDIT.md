| Test Name | Description / Expected Behavior | Status | Notes |
| --- | --- | --- | --- |
| LOW: math is present and functional | LOW: math is present and functional | GOOD |  |
| LOW: math.import is blocked (HIGH > LOW) | LOW: math.import is blocked (HIGH > LOW) | GOOD |  |
| LOW: console.log is present and callable | LOW: console.log is present and callable | GOOD |  |
| LOW: YAML.parse and YAML.stringify are present | LOW: YAML.parse and YAML.stringify are present | GOOD |  |
| LOW: Object.keys is present | LOW: Object.keys is present | GOOD |  |
| LOW: Object.setPrototypeOf is blocked (HIGH > LOW) | LOW: Object.setPrototypeOf is blocked (HIGH > LOW) | GOOD |  |
| LOW: Object.defineProperty is blocked (HIGH > LOW) | LOW: Object.defineProperty is blocked (HIGH > LOW) | GOOD |  |
| LOW: fs is not present (all fs methods are MEDIUM or higher) | LOW: fs is not present (all fs methods are MEDIUM or higher) | GOOD | Testing module is undefined, implicitly tests all its methods. |
| LOW: os is not present (all os methods are MEDIUM or higher) | LOW: os is not present (all os methods are MEDIUM or higher) | GOOD | Testing module is undefined, implicitly tests all its methods. |
| LOW: child_process is not present (all methods are HIGH or higher) | LOW: child_process is not present (all methods are HIGH or higher) | GOOD | Testing module is undefined, implicitly tests all its methods. |
| LOW: eval is not in Mods (not in registry) | LOW: eval is not in Mods (not in registry) | GOOD |  |
| LOW: process is not in Mods (90-process.yaml not loaded) | LOW: process is not in Mods (90-process.yaml not loaded) | GOOD |  |
| MEDIUM: fs is present with read methods only | MEDIUM: fs is present with read methods only | GOOD |  |
| MEDIUM: fs.writeFileSync is not present (HIGH > MEDIUM) | MEDIUM: fs.writeFileSync is not present (HIGH > MEDIUM) | GOOD |  |
| MEDIUM: fs.unlinkSync is not present (HIGH > MEDIUM) | MEDIUM: fs.unlinkSync is not present (HIGH > MEDIUM) | GOOD |  |
| MEDIUM: os is present with hostname and other methods | MEDIUM: os is present with hostname and other methods | GOOD |  |
| MEDIUM: os.networkInterfaces is not present (HIGH > MEDIUM) | MEDIUM: os.networkInterfaces is not present (HIGH > MEDIUM) | GOOD |  |
| MEDIUM: child_process is still not present (HIGH > MEDIUM) | MEDIUM: child_process is still not present (HIGH > MEDIUM) | GOOD |  |
| MEDIUM: Object.setPrototypeOf still blocked (INSANE > MEDIUM) | MEDIUM: Object.setPrototypeOf still blocked (INSANE > MEDIUM) | GOOD |  |
| MEDIUM: eval and process still not in Mods | MEDIUM: eval and process still not in Mods | GOOD |  |
| HIGH: fs.writeFileSync is present | HIGH: fs.writeFileSync is present | GOOD |  |
| HIGH: fs.chmodSync is not present (INSANE > HIGH) | HIGH: fs.chmodSync is not present (INSANE > HIGH) | GOOD |  |
| HIGH: child_process is present with exec methods | HIGH: child_process is present with exec methods | GOOD |  |
| HIGH: child_process.fork is not present (INSANE > HIGH) | HIGH: child_process.fork is not present (INSANE > HIGH) | GOOD |  |
| HIGH: Object.setPrototypeOf is blocked (INSANE > HIGH) | HIGH: Object.setPrototypeOf is blocked (INSANE > HIGH) | GOOD |  |
| HIGH: Object.defineProperty is blocked (INSANE > HIGH) | HIGH: Object.defineProperty is blocked (INSANE > HIGH) | GOOD |  |
| HIGH: Object.getPrototypeOf is blocked (INSANE > HIGH) | HIGH: Object.getPrototypeOf is blocked (INSANE > HIGH) | GOOD |  |
| HIGH: eval and process still not in Mods (not in any loaded registry) | HIGH: eval and process still not in Mods (not in any loaded registry) | GOOD |  |
| SETUP: math instance is created by setup (not the raw module) | SETUP: math instance is created by setup (not the raw module) | GOOD |  |
| SETUP: $MODULE does not leak into Mods or appear as a key | SETUP: $MODULE does not leak into Mods or appear as a key | GOOD |  |
| F Command - Defines and calls async function correctly | F Command - Defines and calls async function correctly | GOOD |  |
| F Command - Scoping test, child mutations do not leak | F Command - Scoping test, child mutations do not leak | GOOD |  |
| F Command - Inheritance and module protection | F Command - Inheritance and module protection | GOOD |  |
| F Command - Prototype Pollution checks on formal args | F Command - Prototype Pollution checks on formal args | GOOD |  |
| F Command - Scanner validation for PP on function name | F Command - Scanner validation for PP on function name | GOOD |  |
| ISO-01: $LAST from one run does not bleed into a second run | ISO-01: $LAST from one run does not bleed into a second run | GOOD |  |
| ISO-02: $ERROR from a failing run does not persist into the next run | ISO-02: $ERROR from a failing run does not persist into the next run | GOOD |  |
| ISO-03: F functions from one run are not visible in a second run | ISO-03: F functions from one run are not visible in a second run | GOOD |  |
| CTX-01: math.evaluate still works after run() refactor | CTX-01: math.evaluate still works after run() refactor | GOOD |  |
| CTX-02: fs.readFileSync still blocked at LOW after run() refactor | CTX-02: fs.readFileSync still blocked at LOW after run() refactor | GOOD |  |
| CTX-03: fs.readFileSync still works at MEDIUM after run() refactor | CTX-03: fs.readFileSync still works at MEDIUM after run() refactor | GOOD |  |
| CTX-04: passing_program still succeeds after run() refactor | CTX-04: passing_program still succeeds after run() refactor | GOOD |  |
| CTX-05: failing_program still fails at LOW after run() refactor | CTX-05: failing_program still fails at LOW after run() refactor | GOOD |  |
| TEST: NEJY_MAX_RISK=LOW caps --policy=HIGH causing a hard boot failure | TEST: NEJY_MAX_RISK=LOW caps --policy=HIGH causing a hard boot failure | GOOD |  |
| TEST: NEJY_MAX_RISK=HIGH allows --policy=MEDIUM | TEST: NEJY_MAX_RISK=HIGH allows --policy=MEDIUM | GOOD |  |
| TEST: Missing --policy defaults to LOW and allows execution if NEJY_MAX_RISK=MEDIUM | TEST: Missing --policy defaults to LOW and allows execution if NEJY_MAX_RISK=MEDIUM | GOOD |  |
| TEST: Invalid NEJY_MAX_RISK causes hard boot failure | TEST: Invalid NEJY_MAX_RISK causes hard boot failure | GOOD |  |
| nejy run examples/os/health_report.yaml --policy LOW (expected ok: false) | nejy run examples/os/health_report.yaml --policy LOW (expected ok: false) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/os/health_report.yaml --policy MEDIUM (expected ok: true) | nejy run examples/os/health_report.yaml --policy MEDIUM (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/os/health_report.yaml --policy HIGH (expected ok: true) | nejy run examples/os/health_report.yaml --policy HIGH (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/os/health_pipe.yaml --policy LOW (expected ok: false) | nejy run examples/os/health_pipe.yaml --policy LOW (expected ok: false) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/os/health_pipe.yaml --policy MEDIUM (expected ok: true) | nejy run examples/os/health_pipe.yaml --policy MEDIUM (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/os/health_pipe.yaml --policy HIGH (expected ok: true) | nejy run examples/os/health_pipe.yaml --policy HIGH (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/simple/failing_program.json --policy LOW (expected ok: false) | nejy run examples/simple/failing_program.json --policy LOW (expected ok: false) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/simple/failing_program.json --policy MEDIUM (expected ok: false) | nejy run examples/simple/failing_program.json --policy MEDIUM (expected ok: false) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/simple/failing_program.json --policy HIGH (expected ok: true) | nejy run examples/simple/failing_program.json --policy HIGH (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/simple/passing_program.json --policy LOW (expected ok: true) | nejy run examples/simple/passing_program.json --policy LOW (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/simple/passing_program.json --policy MEDIUM (expected ok: true) | nejy run examples/simple/passing_program.json --policy MEDIUM (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/simple/passing_program.json --policy HIGH (expected ok: true) | nejy run examples/simple/passing_program.json --policy HIGH (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi.json --policy LOW (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi.json --policy LOW (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi.json --policy MEDIUM (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi.json --policy MEDIUM (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi.json --policy HIGH (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi.json --policy HIGH (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi-math.json --policy LOW (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi-math.json --policy LOW (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi-math.json --policy MEDIUM (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi-math.json --policy MEDIUM (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi-math.json --policy HIGH (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi-math.json --policy HIGH (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi.yaml --policy LOW (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi.yaml --policy LOW (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi.yaml --policy MEDIUM (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi.yaml --policy MEDIUM (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi.yaml --policy HIGH (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi.yaml --policy HIGH (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi-compiled.json --policy LOW (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi-compiled.json --policy LOW (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi-compiled.json --policy MEDIUM (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi-compiled.json --policy MEDIUM (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi-compiled.json --policy HIGH (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi-compiled.json --policy HIGH (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi-pipe.yaml --policy LOW (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi-pipe.yaml --policy LOW (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi-pipe.yaml --policy MEDIUM (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi-pipe.yaml --policy MEDIUM (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi-pipe.yaml --policy HIGH (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi-pipe.yaml --policy HIGH (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi-turbo-nilakantha.yaml --policy LOW (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi-turbo-nilakantha.yaml --policy LOW (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi-turbo-nilakantha.yaml --policy MEDIUM (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi-turbo-nilakantha.yaml --policy MEDIUM (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run examples/cpu_intensive/pi-turbo-nilakantha.yaml --policy HIGH (expected ok: i-timeout) | nejy run examples/cpu_intensive/pi-turbo-nilakantha.yaml --policy HIGH (expected ok: i-timeout) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run tests/programs/use-literal.yaml --policy LOW (expected ok: true) | nejy run tests/programs/use-literal.yaml --policy LOW (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run tests/programs/use-literal.yaml --policy MEDIUM (expected ok: true) | nejy run tests/programs/use-literal.yaml --policy MEDIUM (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run tests/programs/use-literal.yaml --policy HIGH (expected ok: true) | nejy run tests/programs/use-literal.yaml --policy HIGH (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run tests/programs/use-inline-literal.yaml --policy LOW (expected ok: true) | nejy run tests/programs/use-inline-literal.yaml --policy LOW (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run tests/programs/use-inline-literal.yaml --policy MEDIUM (expected ok: true) | nejy run tests/programs/use-inline-literal.yaml --policy MEDIUM (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run tests/programs/use-inline-literal.yaml --policy HIGH (expected ok: true) | nejy run tests/programs/use-inline-literal.yaml --policy HIGH (expected ok: true) | GOOD | Test verifies execution success/failure against policy. Works as intended. |
| nejy run tests/programs/use-promise-all.yaml --policy LOW (expected ok: true) | nejy run tests/programs/use-promise-all.yaml --policy LOW (expected ok: true) | GOOD | The integration test now properly checks the `expectReturn` array value via `assert.deepStrictEqual`. |
| mathFunction uses Map instead of Object | mathFunction uses Map instead of Object | GOOD |  |
| math.evaluate with $VARS returns correctly using Map proxy | math.evaluate with $VARS returns correctly using Map proxy | GOOD |  |
| REDTEAM: high-escalation-reflect-prototype.yaml | REDTEAM: high-escalation-reflect-prototype.yaml | GOOD | Redteam tests pass if blocked, fail if vulnerability succeeds. Good test pattern. |
| REDTEAM: high-exec-variable-string-bypass.yaml | REDTEAM: high-exec-variable-string-bypass.yaml | GOOD | Redteam tests pass if blocked, fail if vulnerability succeeds. Good test pattern. |
| REDTEAM: high-new-promise.yaml | REDTEAM: high-new-promise.yaml | GOOD | Redteam tests pass if blocked, fail if vulnerability succeeds. Good test pattern. |
| REDTEAM: high-pipe-variable-string-bypass.yaml | REDTEAM: high-pipe-variable-string-bypass.yaml | GOOD | Redteam tests pass if blocked, fail if vulnerability succeeds. Good test pattern. |
| REDTEAM: high-run-variable-string-bypass.yaml | REDTEAM: high-run-variable-string-bypass.yaml | GOOD | Redteam tests pass if blocked, fail if vulnerability succeeds. Good test pattern. |
| C01: program with correct REQUEST succeeds | C01: program with correct REQUEST succeeds | GOOD |  |
| C02: program without REQUEST gets full manifest capabilities (backwards compat) | C02: program without REQUEST gets full manifest capabilities (backwards compat) | GOOD |  |
| C03: EXEC of un-REQUESTed path is SEC_BLOCK at scan time | C03: EXEC of un-REQUESTed path is SEC_BLOCK at scan time | GOOD |  |
| C04: REQUEST of capability exceeding maxRisk is SEC_BLOCK | C04: REQUEST of capability exceeding maxRisk is SEC_BLOCK | GOOD |  |
| C05: REQUEST of entire module grants all methods within maxRisk | C05: REQUEST of entire module grants all methods within maxRisk | GOOD |  |
| C06: REQUEST of entire "os" module at LOW is SEC_BLOCK (os requires MEDIUM) | C06: REQUEST of entire "os" module at LOW is SEC_BLOCK (os requires MEDIUM) | GOOD |  |
| C07: REQUEST appearing after EXEC is SEC_BLOCK | C07: REQUEST appearing after EXEC is SEC_BLOCK | GOOD |  |
| SANDBOX: "copy" isolates variables and returns $RETURN as $LAST | SANDBOX: "copy" isolates variables and returns $RETURN as $LAST | GOOD |  |
| SANDBOX: empty config {} provides no capabilities or variables | SANDBOX: empty config {} provides no capabilities or variables | GOOD |  |
| SANDBOX: escalates capabilities -> SEC_BLOCK | SANDBOX: escalates capabilities -> SEC_BLOCK | GOOD |  |
| SANDBOX: valid subset capabilities succeeds | SANDBOX: valid subset capabilities succeeds | GOOD |  |
| SANDBOX: context array deeply copies specific vars | SANDBOX: context array deeply copies specific vars | GOOD |  |
| SANDBOX: context object sets new initial vars | SANDBOX: context object sets new initial vars | GOOD |  |
| A01: math.evaluate succeeds at LOW risk | A01: math.evaluate succeeds at LOW risk | GOOD |  |
| A02: math.evaluate succeeds at MEDIUM risk | A02: math.evaluate succeeds at MEDIUM risk | GOOD |  |
| A03: fs.readFileSync blocked at LOW risk (SEC_BLOCK) | A03: fs.readFileSync blocked at LOW risk (SEC_BLOCK) | GOOD |  |
| A04: fs.readFileSync succeeds at MEDIUM risk | A04: fs.readFileSync succeeds at MEDIUM risk | GOOD |  |
| A06: fs.writeFileSync succeeds at HIGH risk | A06: fs.writeFileSync succeeds at HIGH risk | GOOD |  |
| A07: child_process blocked at LOW risk (SEC_BLOCK) | A07: child_process blocked at LOW risk (SEC_BLOCK) | GOOD |  |
| B07: LITERAL with prototype pollution is blocked at LOW risk (SEC_BLOCK) | B07: LITERAL with prototype pollution is blocked at LOW risk (SEC_BLOCK) | GOOD |  |
| B08: Inline LITERAL with prototype pollution is blocked at LOW risk (SEC_BLOCK) | B08: Inline LITERAL with prototype pollution is blocked at LOW risk (SEC_BLOCK) | GOOD |  |
| A08: child_process blocked at MEDIUM risk (SEC_BLOCK) | A08: child_process blocked at MEDIUM risk (SEC_BLOCK) | GOOD |  |
| A09: child_process.execSync succeeds at HIGH risk | A09: child_process.execSync succeeds at HIGH risk | GOOD |  |
| A10: os.hostname blocked at LOW risk (SEC_BLOCK) | A10: os.hostname blocked at LOW risk (SEC_BLOCK) | GOOD |  |
| A11: os.hostname succeeds at MEDIUM risk | A11: os.hostname succeeds at MEDIUM risk | GOOD |  |
| B01: eval is blocked at LOW risk (SEC_BLOCK at scan time) | B01: eval is blocked at LOW risk (SEC_BLOCK at scan time) | GOOD |  |
| B02: eval is blocked at HIGH risk (SEC_BLOCK at scan time — not in registry at any level) | B02: eval is blocked at HIGH risk (SEC_BLOCK at scan time — not in registry at any level) | GOOD |  |
| B03: process.exit is blocked and produces YAML output (SEC_BLOCK at scan time) | B03: process.exit is blocked and produces YAML output (SEC_BLOCK at scan time) | GOOD |  |
| B04: Object.setPrototypeOf is blocked at LOW risk (SEC_BLOCK — HIGH > LOW) | B04: Object.setPrototypeOf is blocked at LOW risk (SEC_BLOCK — HIGH > LOW) | GOOD |  |
| B05: Object.setPrototypeOf is blocked at MEDIUM risk (SEC_BLOCK — HIGH > MEDIUM) | B05: Object.setPrototypeOf is blocked at MEDIUM risk (SEC_BLOCK — HIGH > MEDIUM) | GOOD |  |
| B06: fs.writeFileSync is blocked at MEDIUM risk (SEC_BLOCK — HIGH > MEDIUM) | B06: fs.writeFileSync is blocked at MEDIUM risk (SEC_BLOCK — HIGH > MEDIUM) | GOOD |  |