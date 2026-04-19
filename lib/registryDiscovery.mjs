import fs from 'node:fs';

export function getDefaultRegistry() {
    const enabledDir = new URL('../config/security/registry/enabled', import.meta.url);
    const files = fs.readdirSync(enabledDir);

    return files
        .filter(f => f.endsWith('.yaml') || f.endsWith('.json'))
        .sort()
        .map(f => `config/security/registry/enabled/${f}`);
}
