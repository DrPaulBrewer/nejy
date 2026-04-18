import { run } from './lib/interp/commands.mjs';
import { SecurityScanner } from './lib/interp/scanner.mjs';

const ctx = {
    vars: {},
    mods: {},
    mon: { checkResources: () => {} },
    history: []
};

const program = [
    ["MATH", ["add", ["a", "b"], "a + b"]],
    ["MATH", ["sub", ["a", "b"], "a - b"]],
    ["F", ["my_calc", ["x", "y", "all functions"], [
        ["EXEC", ["$add", ["$x", "$y"]]],
        ["TO", ["temp", ["EXEC", ["$sub", ["$LAST", 1]]]]],
        ["SET", ["RETURN", "$temp"]]
    ]]],
    ["EXEC", ["$my_calc", [10, 5]]]
];

(async () => {
    try {
        await run(program, ctx);
        console.log("LAST:", ctx.vars.$LAST);
    } catch (e) {
        console.error(e);
    }
})();
