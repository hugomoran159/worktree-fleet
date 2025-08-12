import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

for (const file of ['../dist/index.js', '../dist/index.cjs']) {
  const abs = resolve(__dirname, file);
  let src = readFileSync(abs, 'utf8');
  if (!src.startsWith('#!/usr/bin/env node')) {
    writeFileSync(abs, `#!/usr/bin/env node\n${src}`);
  }
}


