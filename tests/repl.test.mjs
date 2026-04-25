import test from 'node:test';
import assert from 'node:assert';
import { getCompleter } from '../lib/repl.mjs';

test('REPL getCompleter - JSON format empty prompt', () => {
    let buffer = '';
    const state = { ctx: { vars: {}, mods: {} } };
    const completer = getCompleter('json', state, () => buffer);

    const [completions, match] = completer('');
    assert.ok(completions.includes('['), 'Should suggest [ for JSON mode');
    assert.ok(completions.includes('.help'), 'Should suggest dot commands');
    assert.ok(!completions.includes('EXEC'), 'Should NOT suggest EXEC on empty prompt');
});

test('REPL getCompleter - YAML format empty prompt', () => {
    let buffer = '';
    const state = { ctx: { vars: {}, mods: {} } };
    const completer = getCompleter('yaml', state, () => buffer);

    const [completions, match] = completer('');
    assert.ok(completions.includes('-'), 'Should suggest - for YAML mode');
    assert.ok(completions.includes('.help'), 'Should suggest dot commands');
});

test('REPL getCompleter - command autocompletion', () => {
    let buffer = '['; // not empty buffer
    const state = { ctx: { vars: {}, mods: {} } };
    const completer = getCompleter('json', state, () => buffer);

    const [completions, match] = completer('"E');
    assert.ok(completions.includes('EXEC'), 'Should complete EXEC');
});

test('REPL getCompleter - module properties via prototype chain', () => {
    let buffer = '['; 
    const mockURL = URL;
    const state = { 
        ctx: { 
            vars: {}, 
            mods: { URL: mockURL } 
        } 
    };
    const completer = getCompleter('json', state, () => buffer);

    const [completions, match] = completer('"URL.');
    assert.ok(completions.includes('URL.createObjectURL'), 'Should find prototype methods on URL');
    assert.ok(completions.includes('URL.revokeObjectURL'), 'Should find prototype methods on URL');
});

test('REPL getCompleter - Math module', () => {
    let buffer = '['; 
    const state = { 
        ctx: { 
            vars: {}, 
            mods: { Math: Math } 
        } 
    };
    const completer = getCompleter('json', state, () => buffer);

    const [completions, match] = completer('"Math.');
    assert.ok(completions.includes('Math.abs'), 'Should find Math.abs');
    assert.ok(completions.includes('Math.PI'), 'Should find Math.PI');
});

import { startREPL } from '../lib/repl.mjs';
import { PassThrough } from 'node:stream';

test('REPL startREPL - does not throw on startup due to missing _refreshLine', async () => {
    const originalStdin = process.stdin;
    const originalStdout = process.stdout;
    const originalExit = process.exit;

    try {
        const mockStdin = new PassThrough();
        const mockStdout = new PassThrough();

        Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true });
        Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true });

        let exitCalled = false;
        Object.defineProperty(process, 'exit', {
            value: (code) => { exitCalled = true; },
            configurable: true
        });

        // We run startREPL but don't await indefinitely, we just want to see if it throws synchronously or during setup.
        // It's technically async but readline sets up synchronously.
        const replPromise = startREPL('json', { policy: 'LOW' });

        // Let event loop tick to allow initialization
        await new Promise(resolve => setTimeout(resolve, 50));

        // If it hasn't crashed by now, the bug is probably fixed.
        // We'll simulate .exit to close it cleanly.
        mockStdin.write('.exit\n');

        // Wait another tick to allow the line event to fire
        await new Promise(resolve => setTimeout(resolve, 50));

        assert.ok(true, 'startREPL did not throw an error during initialization');

    } finally {
        Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
        Object.defineProperty(process, 'stdout', { value: originalStdout, configurable: true });
        Object.defineProperty(process, 'exit', { value: originalExit, configurable: true });
    }
});
