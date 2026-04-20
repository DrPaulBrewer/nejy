export default function createSecureFetch(fetchRules = []) {
  const globalFetch = globalThis.fetch;
  // If no fetching is permitted, or if the runtime doesn't have fetch
  if (!globalFetch) return async () => { throw new Error("FETCH_BLOCKED: fetch not available"); };

  const processedRules = fetchRules.map(r => ({
    ...r,
    _pattern: new URLPattern(r.pattern),
    _forbiddenHeaders: r.forbiddenHeaders?.map(h => h.toLowerCase())
  }));

  return async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    const urlStr = typeof url === 'string' ? url : url.href;

    const rule = processedRules.find(r => {
      return r._pattern.test(urlStr) && r.methods.includes(method);
    });

    if (!rule) throw new Error(`FETCH_BLOCKED: ${method} ${urlStr}`);

    const requestHeaders = options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : (options.headers || {});

    if (rule._forbiddenHeaders) {
      const sentKeys = new Set(Object.keys(requestHeaders).map(k => k.toLowerCase()));
      for (const forbidden of rule._forbiddenHeaders) {
        if (sentKeys.has(forbidden)) throw new Error("FORBIDDEN_HEADER");
      }
    }

    if (rule.forcedHeaders) Object.assign(requestHeaders, rule.forcedHeaders);
    options.headers = requestHeaders;

    return globalFetch(url, options);
  };
}
