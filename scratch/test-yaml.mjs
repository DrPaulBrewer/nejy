import fs from 'node:fs';
import YAML from 'yaml';

try {
    const text = fs.readFileSync('config/security/registry/60-net.yaml', 'utf8');
    const doc = YAML.parse(text);
    console.log("SUCCESS. Entries count:", Array.isArray(doc.entries) ? doc.entries.length : 0);
} catch (e) {
    console.error("YAML PARSE ERROR:", e.message);
}
