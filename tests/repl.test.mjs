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
