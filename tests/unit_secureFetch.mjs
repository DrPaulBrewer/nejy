import createSecureFetch from '../lib/secureFetch.mjs';
import assert from 'node:assert';

// Mock URLPattern
globalThis.URLPattern = class {
  constructor(pattern) { this.pattern = pattern; }
  test(url) { return url.includes('example.com'); }
};

const rules = [
  {
    pattern: 'https://example.com/*',
    methods: ['GET'],
    forbiddenHeaders: ['Cookie', 'X-Secret'],
    forcedHeaders: { 'X-Bot': 'Secure' }
  }
];

let lastFetchUrl = null;
let lastFetchOptions = null;
globalThis.fetch = async (url, options) => {
  lastFetchUrl = url;
  lastFetchOptions = options;
  return { ok: true };
};

async function test() {
  const secureFetch = createSecureFetch(rules);

  // 1. Success case
  await secureFetch('https://example.com/data', { headers: { 'Accept': 'application/json' } });
  assert.strictEqual(lastFetchUrl, 'https://example.com/data');
  assert.strictEqual(lastFetchOptions.headers['X-Bot'], 'Secure');
  assert.strictEqual(lastFetchOptions.headers['Accept'], 'application/json');

  // 2. Forbidden header (mixed case)
  try {
    await secureFetch('https://example.com/data', { headers: { 'x-secret': 'stolen' } });
    assert.fail('Should have thrown FORBIDDEN_HEADER');
  } catch (e) {
    assert.strictEqual(e.message, 'FORBIDDEN_HEADER');
  }

  // 3. Blocked URL
  try {
    await secureFetch('https://malicious.com', { methods: ['GET'] });
    assert.fail('Should have thrown FETCH_BLOCKED');
  } catch (e) {
    assert.ok(e.message.includes('FETCH_BLOCKED'));
  }

  // 4. Headers object support
  const headers = new Headers();
  headers.set('Cookie', 'session=123');
  try {
    await secureFetch('https://example.com/', { headers });
    assert.fail('Should have thrown FORBIDDEN_HEADER for Headers object');
  } catch (e) {
    assert.strictEqual(e.message, 'FORBIDDEN_HEADER');
  }

  console.log('Unit tests passed!');
}

test().catch(e => {
  console.error(e);
  process.exit(1);
});
