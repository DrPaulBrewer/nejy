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

test('REPL getCompleter - .monitor appears in dot command completions', () => {
    let buffer = '';
    const state = { ctx: { vars: {}, mods: {} } };
    const completer = getCompleter('yaml', state, () => buffer);

    const [completions] = completer('');
    assert.ok(completions.includes('.monitor'), 'Should include .monitor in dot commands');
});

test('REPL getCompleter - .monitor completes on partial input', () => {
    let buffer = '';
    const state = { ctx: { vars: {}, mods: {} } };
    const completer = getCompleter('yaml', state, () => buffer);

    const [completions] = completer('.mon');
    assert.ok(completions.includes('.monitor'), 'Should complete .monitor from .mon');
});

import ResourceMonitor from '../monitor/index.js';

test('ResourceMonitor - disable prevents QUOTA_EXCEEDED from being thrown', () => {
    const mon = new ResourceMonitor({ maxCpuMs: 0.001, maxMemoryMb: 0.001 });
    mon.disable();
    assert.doesNotThrow(() => mon.checkResources(), 'checkResources should not throw when disabled');
    assert.strictEqual(mon.disabled, true, 'disabled flag should be true');
});

test('ResourceMonitor - enable re-activates quota enforcement', () => {
    const mon = new ResourceMonitor({ maxCpuMs: 0.001, maxMemoryMb: 0.001 });
    mon.disable();
    mon.enable();
    assert.strictEqual(mon.disabled, false, 'disabled flag should be false after enable()');
    assert.throws(() => mon.checkResources(), /QUOTA_EXCEEDED/, 'checkResources should enforce quotas once re-enabled');
});

test('ResourceMonitor - disable still tracks usage metrics passively', () => {
    const mon = new ResourceMonitor({ maxCpuMs: 0.001 });
    mon.disable();
    mon.checkResources();
    assert.ok(typeof mon.usage.cpuMs === 'number' && mon.usage.cpuMs >= 0, 'usage.cpuMs should be tracked even when disabled');
});

test('ResourceMonitor - disable prevents FS_QUOTA_EXCEEDED', () => {
    const mon = new ResourceMonitor({ maxFsBytes: 1 });
    mon.disable();

    let writtenData = null;
    const fakeFs = {
        writeFileSync: (path, data) => { writtenData = data; }
    };
    mon.instrumentFs(fakeFs);

    assert.doesNotThrow(() => fakeFs.writeFileSync('/fake/path', 'hello world'), 'FS write should not throw when monitor is disabled');
    assert.strictEqual(writtenData, 'hello world', 'FS write should still execute the underlying call');
});

// ─── .wiz completer tests ─────────────────────────────────────────────────────

test('REPL getCompleter - .wiz appears in dot command completions', () => {
    let buffer = '';
    const state = { ctx: { vars: {}, mods: {} } };
    const completer = getCompleter('yaml', state, () => buffer);

    const [completions] = completer('');
    assert.ok(completions.includes('.wiz'), 'Should include .wiz in dot commands');
});

test('REPL getCompleter - .wiz completes on partial input', () => {
    let buffer = '';
    const state = { ctx: { vars: {}, mods: {} } };
    const completer = getCompleter('yaml', state, () => buffer);

    const [completions] = completer('.wi');
    assert.ok(completions.includes('.wiz'), 'Should complete .wiz from .wi');
});

// ─── lenientParse unit tests ──────────────────────────────────────────────────

import { lenientParse } from '../lib/repl-wizard.mjs';

test('lenientParse - standard JSON is parsed correctly', () => {
    assert.deepStrictEqual(lenientParse('{"a":1,"b":true}'), { a: 1, b: true });
    assert.deepStrictEqual(lenientParse('[1,2,3]'), [1, 2, 3]);
    assert.strictEqual(lenientParse('"hello"'), 'hello');
    assert.strictEqual(lenientParse('42'), 42);
});

test('lenientParse - JSON5 features: unquoted keys and single quotes', () => {
    assert.deepStrictEqual(lenientParse('{a: 5}'), { a: 5 });
    assert.deepStrictEqual(lenientParse("{a: 'hello'}"), { a: 'hello' });
    assert.deepStrictEqual(lenientParse('{a: 1,}'), { a: 1 }); // trailing comma
});

test('lenientParse - bare-word string values are auto-quoted (the key user scenario)', () => {
    // {a:5, b:no} should parse as {a:5, b:"no"}
    const result = lenientParse('{a:5, b:no}');
    assert.deepStrictEqual(result, { a: 5, b: 'no' });
});

test('lenientParse - JSON keywords are NOT quoted', () => {
    const result = lenientParse('{a:true, b:false, c:null}');
    assert.deepStrictEqual(result, { a: true, b: false, c: null });
});

test('lenientParse - raw string fallback for unparseable input', () => {
    // Something that cannot be parsed by any tier
    const raw = 'just a plain string';
    assert.strictEqual(lenientParse(raw), raw);
});

test('lenientParse - empty string returns undefined', () => {
    assert.strictEqual(lenientParse(''), undefined);
    assert.strictEqual(lenientParse('   '), undefined);
});

test('lenientParse - non-string passthrough', () => {
    assert.strictEqual(lenientParse(42), 42);
    assert.deepStrictEqual(lenientParse([1, 2]), [1, 2]);
});


