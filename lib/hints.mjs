export const commandHints = {
    AWAIT: '["AWAIT", ["sourcePromiseVar", "destVariable"]]',
    CHILD: '["CHILD", ["functionName", ["arg1", "arg2"], "destPromiseVariable"]]',
    EXEC: '["EXEC", ["target.path", ["arg1", "$arg2"], "destVariable"]]',
    F: '["F", ["FunctionName", ["arg1", "arg2"], [ ["Step1", ["..."]], ["SET", ["RETURN", "result"]] ]]]',
    FOR_EACH: '["FOR_EACH", ["$myList", [ ["Step1", ["..."]] ]]]',
    IF: '["IF", ["$conditionVariable", [ ["Step1", ["..."]] ], [ ["Step2", ["..."]] ]]]',
    LITERAL: '["LITERAL", "value", "destVariable"]',
    MATH: '["MATH", ["FunctionName", ["arg1", "arg2"], "math expression string"]]',
    NEW: '["NEW", ["TargetConstructor", ["arg1", "arg2"], "destVariable"]]',
    REQUEST: '["REQUEST", ["capability.path", "another.path"]]',
    SANDBOX: '["SANDBOX", [{"policy": "LOW", "capabilities": [], "context": ["$varToExpose"]}, [ ["Step1", ["..."]] ]]]',
    SET: '["SET", ["variableName", "value"]]',
    TRY: '["TRY", [ ["Step1", ["..."]] ], [ ["Step2", ["..."]] ]]'
};

export function getHintForLine(line, format) {
    if (format !== 'json') return '';

    // Check if the line matches a command, like ["SET" or [ "SET"
    const match = line.match(/^\s*\[?\s*"([A-Z_]+)"?/);
    if (match) {
        const cmd = match[1];
        if (commandHints[cmd]) {
            return commandHints[cmd];
        }
    }
    return '';
}
