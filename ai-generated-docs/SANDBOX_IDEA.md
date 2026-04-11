
## Stage 7 — SANDBOX Command

Goal: Run a subprogram with a restricted subset of current capabilities.

### Semantics:
```yaml
["SANDBOX", ["console.log"],   ← capabilities granted (subset of current)
  [                            ← subprogram
    ["EXEC", ["console.log", ["safe"]]],
    ["SET", ["result", "42"]]
  ]
]
```

- Capabilities: list of module/method names, same syntax as REQUEST — must be subset of current context
- vars: starts as a copy of parent vars ($LAST, $ERROR, etc. are visible)
- Changes inside sandbox do NOT propagate back to parent vars
- $RETURN in sandbox → becomes $LAST in parent after SANDBOX completes
- functions: sandbox sees parent functions (read-only)
- Scanner validates sandbox body against sandbox capabilities, not parent

### Tests: `tests/sandbox.test.mjs`

```
TEST: sandbox restricts capabilities below parent
  parent: HIGH (has fs.writeFileSync)
  sandbox: ["console.log"]
  sandbox body tries fs.writeFileSync → SEC_BLOCK

TEST: sandbox cannot escalate above parent
  parent: LOW
  sandbox: ["fs.writeFileSync"]  ← HIGH, exceeds parent LOW
  expected: SEC_BLOCK at SANDBOX declaration

TEST: var isolation — sandbox changes don't propagate
  parent sets $FOO = "hello"
  sandbox sets $FOO = "modified"
  after sandbox, parent's $FOO is still "hello"

TEST: $RETURN propagates out of sandbox
  sandbox sets $RETURN = 42
  parent's $LAST = 42 after SANDBOX

TEST: nested SANDBOX
  outer sandbox: ["math", "console.log"]
  inner sandbox: ["console.log"]  ← subset of outer, valid
  inner body tries math.evaluate → SEC_BLOCK

```