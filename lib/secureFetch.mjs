import 'urlpattern-polyfill';

export default function createSecureFetch(fetchRules = []) {
  const globalFetch = globalThis.fetch;
  // If no fetching is permitted, or if the runtime doesn't have fetch
  if (!globalFetch) return async () => { throw new Error("FETCH_BLOCKED: fetch not available"); };

  // Pre-compile rules to improve performance (Item 20 & 21)
  const compiledRules = fetchRules.map(r => {
    return {
      ...r,
      _pattern: new URLPattern(r.pattern),
      _forbiddenHeadersSet: r.forbiddenHeaders
        ? new Set(r.forbiddenHeaders.map(h => h.toLowerCase()))
        : null
    };
  });

  return async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    const urlStr = typeof url === 'string' ? url : url.href;

    const rule = compiledRules.find(r => {
      return r._pattern.test(urlStr) && r.methods.includes(method);
    });

    if (!rule) throw new Error(`FETCH_BLOCKED: ${method} ${urlStr}`);

    const requestHeaders = options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : (options.headers || {});

    if (rule._forbiddenHeadersSet) {
      const sentKeys = Object.keys(requestHeaders);
      for (const sent of sentKeys) {
        if (rule._forbiddenHeadersSet.has(sent.toLowerCase())) {
          throw new Error("FORBIDDEN_HEADER");
        }
      }
    }

    if (rule.forcedHeaders) Object.assign(requestHeaders, rule.forcedHeaders);
    options.headers = requestHeaders;

    return globalFetch(url, options);
  };
}
