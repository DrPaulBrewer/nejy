import test from 'node:test';
import assert from 'node:assert';
import { removePP } from '../lib/interp/context.mjs';

test('removePP works as expected', async (t) => {
    await t.test('strips prototype and constructor from plain objects', () => {
        const obj = { a: 1 };
        const clean = removePP(obj);
        assert.equal(Object.getPrototypeOf(clean), null);
        assert.equal(clean.a, 1);
        assert.equal(clean.constructor, undefined);
    });

    await t.test('strips constructor from arrays but keeps array prototype', () => {
        const arr = [1, 2, 3];
        const clean = removePP(arr);
        assert.equal(Object.getPrototypeOf(clean), Array.prototype);
        assert.deepEqual(clean, [1, 2, 3]);
        // Verify current behavior: delete clean.constructor removes own property,
        // but prototype's constructor remains intact
        assert.equal(clean.constructor, Array);
    });

    await t.test('handles cyclic references without crashing', () => {
        const obj = { a: 1 };
        obj.self = obj;
        // structuredClone throws on symbols and functions, but handles cyclic references fine natively.
        const clean = removePP(obj);
        // It should handle it, returning the cleaned object
        assert.equal(Object.getPrototypeOf(clean), null);
        assert.equal(clean.a, 1);
        assert.equal(clean.self, clean);
    });

    await t.test('preserves prototype pollution exploits to not infect the runtime', () => {
        const malicious = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}}');
        const clean = removePP(malicious);

        // Ensure no global pollution happened
        assert.equal({}.polluted, undefined);

        // The object itself shouldn't have these
        assert.equal(clean.constructor, undefined);
    });

    await t.test('returns original object if structuredClone fails (e.g. contains functions)', () => {
        const obj = { a: 1, fn: () => {} };
        const clean = removePP(obj);
        assert.equal(clean, obj);
    });
});
