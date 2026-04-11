const args = ["fetch", ["http://example.com", {"method": "POST"}]];
console.log((args[1] && typeof args[1] === 'object' && !Array.isArray(args[1])) ? args[1] : (args[1]?.[1] || {}));
