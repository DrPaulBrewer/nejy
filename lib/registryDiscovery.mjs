import fs from 'node:fs';
import path from 'node:path';

export function discoverRegistryFiles(dirPath) {
    const registryFiles = [];
    if (!fs.existsSync(dirPath)) {
        return registryFiles;
    }

    const files = fs.readdirSync(dirPath);
    for (const file of files) {
        if (file.endsWith('.yaml') || file.endsWith('.json')) {
            registryFiles.push(path.join(dirPath, file));
        }
    }
    // Sort files to ensure deterministic loading order
    return registryFiles.sort();
}
