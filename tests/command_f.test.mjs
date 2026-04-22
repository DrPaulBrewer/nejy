import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../lib/interp/commands.mjs';
import { SecurityScanner } from '../lib/interp/scanner.mjs';
import ResourceMonitor from '../monitor/index.js';

test('F Command - Defines and calls async function correctly', async () => {
    const ctx = {
        vars: {},
        mods: { math: { add: (a, b) => a + b } },
        mon: new ResourceMonitor({ maxCpuMs: Infinity, maxMemoryMb: Infinity, maxFsBytes: Infinity }),
        scanner: new SecurityScanner({ maxRisk: "LOW" })
    };

    const program = [
        ["F", [
            "addNums",
            ["a", "b"],
            [
                ["EXEC", ["math.add", ["$a", "$b"], "RETURN"]]
            ]
        ]],
        ["EXEC", ["$addNums", [5, 10], "res"]]
    ];

    await run(program, ctx);

    assert.equal(typeof ctx.vars.$addNums, 'function');
    assert.equal(ctx.vars.$res, 15);
});

test('F Command - Scoping test, child mutations do not leak', async () => {
    const ctx = {
        vars: { global_var: "I am global" },
        mods: {},
        mon: new ResourceMonitor({ maxCpuMs: Infinity, maxMemoryMb: Infinity, maxFsBytes: Infinity }),
        scanner: new SecurityScanner({ maxRisk: "LOW" })
    };

    const program = [
        ["F", [
            "mutateVars",
            [],
            [
                ["SET", ["global_var", "I have been mutated!"]], // this sets childCtx.vars.$global_var
                ["SET", ["RETURN", "$global_var"]]
            ]
        ]],
        ["EXEC", ["$mutateVars", [], "res"]]
    ];

    await run(program, ctx);

    assert.equal(ctx.vars.$res, "I have been mutated!");
    // The parent vars should NOT be modified
    assert.equal(ctx.vars.$global_var, undefined); // Wait, "SET" in the child creates `$global_var` in childCtx.
    assert.equal(ctx.vars.global_var, "I am global");
});

test('F Command - Inheritance and module protection', async () => {
    const ctx = {
        vars: {},
        mods: { math: { multiply: (a, b) => a * b } },
        mon: new ResourceMonitor({ maxCpuMs: Infinity, maxMemoryMb: Infinity, maxFsBytes: Infinity }),
        scanner: new SecurityScanner({ maxRisk: "LOW" })
    };

    const program = [
        ["F", [
            "testMods",
            [],
            [
                ["EXEC", ["math.multiply", [4, 5], "RETURN"]]
            ]
        ]],
        ["EXEC", ["$testMods", [], "res"]]
    ];

    await run(program, ctx);
    assert.equal(ctx.vars.$res, 20);
});

test('F Command - Prototype Pollution checks on formal args', async () => {
    const ctx = {
        vars: {},
        mods: {},
        mon: new ResourceMonitor({ maxCpuMs: Infinity, maxMemoryMb: Infinity, maxFsBytes: Infinity }),
        scanner: new SecurityScanner({ maxRisk: "LOW" })
    };

    // This should fail securely when the F function is called (or defined, depending on implementation)
    const program = [
        ["F", [
            "badArgs",
            ["__proto__"],
            [
                ["SET", ["RETURN", "bad"]]
            ]
        ]],
        ["EXEC", ["$badArgs", ["hacked"]]]
    ];

    try {
        await run(program, ctx);
        assert.fail("Should have thrown SEC_BLOCK error for __proto__ arg");
    } catch (e) {
        assert.match(e.message, /SEC_BLOCK: Illegal argument name/);
    }
});

test('F Command - Scanner validation for PP on function name', async () => {
    const scanner = new SecurityScanner({ maxRisk: "LOW" });
    const program = [
        ["F", ["__proto__", [], []]]
    ];

    try {
        await scanner.analyze(program);
        assert.fail("Should have thrown SEC_BLOCK for prototype function name");
    } catch (e) {
        assert.match(e.message, /SEC_BLOCK: Illegal function name/);
    }
});

test('F Command - "all functions" pseudo-parameter', async () => {
    const ctx = {
        vars: {},
        mods: {},
        mon: new ResourceMonitor({ maxCpuMs: Infinity, maxMemoryMb: Infinity, maxFsBytes: Infinity }),
        scanner: new SecurityScanner({ maxRisk: "LOW" }),
        history: []
    };

    const program = [
        ["MATH", ["add", ["a", "b"], "a + b"]],
        ["MATH", ["sub", ["a", "b"], "a - b"]],
        ["F", ["my_calc", ["x", "y", "All Functions"], [
            ["EXEC", ["$add", ["$x", "$y"], "temp"]],
            ["EXEC", ["$sub", ["$temp", 1], "temp"]],
            ["SET", ["RETURN", "$temp"]]
        ]]],
        ["EXEC", ["$my_calc", [10, 5], "res"]]
    ];

    await run(program, ctx);
    assert.equal(ctx.vars.$res, 14);
});

test('F Command - Scanner validation "all functions" not at the end', async () => {
    const scanner = new SecurityScanner({ maxRisk: "LOW" });
    const program = [
        ["F", ["test", ["all Functions", "x"], []]]
    ];

    try {
        await scanner.analyze(program);
        assert.fail("Should have thrown SEC_BLOCK for all functions not at the end");
    } catch (e) {
        assert.match(e.message, /'all Functions' must be the last parameter/);
    }
});


test('F Command - "all functions" captured at definition time, not execution time', async () => {
    const ctx = {
        vars: {},
        mods: {},
        mon: new ResourceMonitor({ maxCpuMs: Infinity, maxMemoryMb: Infinity, maxFsBytes: Infinity }),
        scanner: new SecurityScanner({ maxRisk: "LOW" }),
        history: []
    };

    const program = [
        ["MATH", ["add", ["a", "b"], "a + b"]],
        // F uses $add
        ["F", ["my_calc", ["x", "y", "All Functions"], [
            ["EXEC", ["$add", ["$x", "$y"], "RETURN"]]
        ]]],
        // Now redefine add to something malicious or different.
        // It shouldn't affect $my_calc because it was captured at definition time.
        ["MATH", ["add", ["a", "b"], "a * b * 100"]],
        ["EXEC", ["$my_calc", [10, 5], "res"]]
    ];

    await run(program, ctx);
    // Should be 10 + 5 = 15, NOT 10 * 5 * 100 = 5000
    assert.equal(ctx.vars.$res, 15);
});
