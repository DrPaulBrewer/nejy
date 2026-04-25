import test from 'node:test';
import assert from 'node:assert';
import { getHintForLine, commandHints } from '../lib/hints.mjs';

test('getHintForLine - partial command matches multiple hints', () => {
    const hint = getHintForLine('["S', 'json');
    assert.ok(hint.includes('SANDBOX'), 'Should include SANDBOX hint');
    assert.ok(hint.includes('SET'), 'Should include SET hint');
    assert.equal(hint, `${commandHints.SANDBOX}\n${commandHints.SET}`);
});

test('getHintForLine - partial command matches single hint', () => {
    const hint = getHintForLine('["SE', 'json');
    assert.equal(hint, commandHints.SET);
});

test('getHintForLine - full command match', () => {
    const hint = getHintForLine('["SET"', 'json');
    assert.equal(hint, commandHints.SET);
});

test('getHintForLine - no match', () => {
    const hint = getHintForLine('["Z', 'json');
    assert.equal(hint, '');
});

test('getHintForLine - non-json format', () => {
    const hint = getHintForLine('["S', 'yaml');
    assert.equal(hint, '');
});
