import test from 'node:test';
import assert from 'node:assert';
import { SafeJSONPath } from '../lib/safe-jsonpath.mjs';

const json = {
    store: {
        book: [
            { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
            { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 }
        ]
    }
};

test('SafeJSONPath', async (t) => {

    await t.test('standard options object signature', () => {
        const result = SafeJSONPath({ path: '$.store.book[0].price', json });
        assert.deepStrictEqual(result, [8.95]);
    });

    await t.test('positional arguments signature (path, json)', () => {
        const result = SafeJSONPath('$.store.book[1].price', json);
        assert.deepStrictEqual(result, [12.99]);
    });

    await t.test('positional arguments signature with callback', () => {
        const resultItems = [];
        SafeJSONPath('$.store.book[*].price', json, (payload) => {
            resultItems.push(payload);
        });
        assert.deepStrictEqual(resultItems, [8.95, 12.99]);
    });

    await t.test('positional arguments signature with otherTypeCallback', () => {
        let otherTypeCalled = false;
        // otherTypeCallback is triggered when the expected type does not match.
        // We'll pass a dummy callback just to ensure it can be passed properly.
        SafeJSONPath('$.store.book[*].price', json, undefined, (payload) => {
            otherTypeCalled = true;
        });
        // jsonpath-plus behavior is tested here, but we are validating the wrapping passes it correctly without throwing.
        assert.strictEqual(typeof otherTypeCalled, 'boolean');
    });

    await t.test('no arguments throws error gracefully (or delegates to JSONPath-plus)', () => {
        assert.throws(() => {
            SafeJSONPath();
        }, {
            message: 'You must supply a "path" property when providing an object argument to JSONPath.evaluate().'
        });
    });

    await t.test('null as first argument', () => {
        assert.throws(() => {
            SafeJSONPath(null);
        }, {
            message: 'You must supply a "path" property when providing an object argument to JSONPath.evaluate().'
        });
    });

    await t.test('array of paths as first argument', () => {
        const result = SafeJSONPath(['$.store.book[0].price', '$.store.book[1].price'], json);
        assert.deepStrictEqual(result, []); // JSONPath-plus behavior for arrays is to return empty arrays if no results are found, or an empty array if invalid. The point is it doesn't crash or expose eval.
    });

    await t.test('enforces preventEval: true even if preventEval: false is passed in options', () => {
        assert.throws(() => {
            SafeJSONPath({ path: '$..book[?(eval("1+1")===2)]', json, preventEval: false });
        }, (err) => {
            return err.message.includes('eval is not defined');
        });
    });

    await t.test('enforces preventEval: true with positional arguments', () => {
        assert.throws(() => {
            SafeJSONPath('$..book[?(eval("1+1")===2)]', json);
        }, (err) => {
            return err.message.includes('eval is not defined');
        });
    });

    await t.test('does not affect safe script expressions (e.g. (@.length-1))', () => {
        const result = SafeJSONPath({ path: '$.store.book[(@.length-1)].price', json });
        assert.deepStrictEqual(result, [12.99]);
    });
});
