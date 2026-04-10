# Nejy `main.mjs` Code Review

This document contains a structured code review of the `main.mjs` entry point, identifying immediate bugs, architectural flaws, "dead code" blocks, and security-breaking global manipulations.

1. Fixed
2. Fixed


---

## 3. The `ON_QUOTA` Call-Stack Trap (Critical Bug)

**Observation:** When `run()` catches the `QUOTA_EXCEEDED` error, it intercepts it, runs `ctx.functions.ON_QUOTA` (if declared), and then blindly re-throws the exception vertically.

Because AST structures like `FOR_EACH` or `CALL` invoke `run()` recursively, every single frame on the call stack catches that same `QUOTA_EXCEEDED` exception. Since `em = false` in those upper frames, they *all* independently sequentially trigger `ON_QUOTA` again before re-throwing it. This is why `ON_QUOTA` prints 3 separate times during a deep stack depth.
**Recommendation:** Mark the exception (e.g., `err.handledQuota = true`) when initially handled, or don't try/catch `QUOTA_EXCEEDED` inside the recursive `run` method at all—only catch it at the top-level executor of the CLI wrapper.

---

## 4. `TRY` Block Privilege Escalation (Security Smell)
**File Location:** `main.mjs` Lines 367-374
**Observation:** In the `TRY` command AST operation:
```javascript
TRY: async ([tryB, catchB], ctx, em) => {
    try { await run(tryB, ctx, em); }
    catch (e) {
        if (e.type === "RETURN_SIGNAL") throw e;
        ctx.vars["$ERROR"] = e.message;
        if (catchB) await run(catchB, ctx, em);
    }
}
```
If a user writes a script that intentionally throws a `QUOTA_EXCEEDED` by exhausting resources inside `tryB`, the `TRY` block swallows that error into `$ERROR` because it's not a `RETURN_SIGNAL`! The program is then allowed to continue running code indefinitely by executing `catchB`, totally rescuing the hard process termination.
**Recommendation:** Expand the explicit bypass list. The interpreter `TRY` must *never* be allowed to catch infrastructure fatal errors. `if (e.message === "QUOTA_EXCEEDED") throw e;` must be added so users cannot rescue runtime limits.

---

## 5. Magic Strings for Flow Control
**Observation:** Control flow hinges heavily on arbitrary string matching (`if (err.message === "QUOTA_EXCEEDED")`, `if (err.type === "RETURN_SIGNAL")`). 
**Recommendation:** Constructing explicit error sub-classes (e.g. `class QuotaExceededError extends Error {}`) provides standard, type-verified inheritance checks (`err instanceof QuotaExceededError`) separating control-flow instructions from unpredictable user-thrown standard string errors.

---

## 6. Duplicated `SecurityScanner` Risk Mappings
**Observation:** 
`riskMap = { "LOW": 0, "MEDIUM": 1, "HIGH": 2, "INSANE": 3 }` is defined independently in `SecurityScanner` (line 32) and completely duplicated locally inside the `loadSetup` function. These should be merged to a single constant enum outside the class.

---

## 7. Overloaded `code` structure (Parsing Smells)
**Observation:** In `commands.TO`:
```javascript
const block = (Array.isArray(code) && typeof code[0] === 'string') ? [code] : code;
```
It ambiguously guesses whether an argument is a single execution statement or a deeply nested sequence of statements by checking `typeof code[0] === 'string'`. Parsing transformations should be resolved purely within the scanner and validated. Normalizing single statements to standard arrays at the front-door would prevent branching conditionals across execution.
