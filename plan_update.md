1. Update `lib/interp/commands.mjs`:
   - Move the stringification and resolution of `all functions` from `ctx.history` and `ctx.vars` **outside** the `fn = async (...) =>` closure to satisfy the user's explicit requirement that functions are captured at **definition time**, not execution time.
   - Store these captured references in a variable (`capturedVars`).
   - When the `fn` executes, seed `childVars` with `capturedVars` first.
2. Verify tests again.
3. Rerun code review.
