import { JSONPath } from 'jsonpath-plus';

export function SafeJSONPath(...args) {
    // If the first argument is an object, enforce preventEval on it
    if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
        args[0] = { ...args[0], preventEval: true };
    }
    // If the first argument is a string (or an array of paths) and second is an object (the json),
    // jsonpath-plus supports the signature (path, json, callback, other) but we can convert it
    // to the options object format, which is the officially supported way to pass advanced options.
    else if (args.length > 0) {
        let opts = { preventEval: true };
        opts.path = args[0];
        if (args.length > 1) opts.json = args[1];
        if (args.length > 2) opts.callback = args[2];
        if (args.length > 3) opts.otherTypeCallback = args[3];
        return JSONPath(opts);
    }

    // In case no arguments were provided, or it's somehow called weirdly
    return JSONPath(...args);
}
export default { JSONPath: SafeJSONPath };
