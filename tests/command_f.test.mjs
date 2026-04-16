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
                ["EXEC", ["math.add", ["$a", "$b"]]],
                ["SET", ["RETURN", "$LAST"]]
            ]
        ]],
        ["EXEC", ["$addNums", [5, 10]]]
    ];

    await run(program, ctx);

    assert.equal(typeof ctx.vars.$addNums, 'function');
    assert.equal(ctx.vars.$LAST, 15);
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
        ["EXEC", ["$mutateVars", []]]
    ];

    await run(program, ctx);

    assert.equal(ctx.vars.$LAST, "I have been mutated!");
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
                ["EXEC", ["math.multiply", [4, 5]]],
                ["SET", ["RETURN", "$LAST"]]
            ]
        ]],
        ["EXEC", ["$testMods", []]]
    ];

    await run(program, ctx);
    assert.equal(ctx.vars.$LAST, 20);
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
