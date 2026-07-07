import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

import { palette, semantic } from '../dist/tokens/colors.js';
import { radius } from '../dist/tokens/radius.js';
import { shadows } from '../dist/tokens/shadows.js';
import { space } from '../dist/tokens/spacing.js';
import { fonts, fontSizes, fontWeights, lineHeights } from '../dist/tokens/typography.js';

const outDir = process.argv[2] ?? 'dist';
const resolved = join(__dirname, '..', outDir);
if (!existsSync(resolved)) mkdirSync(resolved, { recursive: true });

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const lines = ['@import "tailwindcss";', '', '@theme {'];

for (const [k, v] of Object.entries(palette)) {
    lines.push(`    --color-${kebab(k)}: ${v};`);
}
for (const [k, v] of Object.entries(semantic)) {
    lines.push(`    --color-${kebab(k)}: ${v};`);
}
for (const [k, v] of Object.entries(fonts)) {
    lines.push(`    --font-${kebab(k)}: ${v};`);
}
for (const [k, v] of Object.entries(fontSizes)) {
    lines.push(`    --font-size-${kebab(k)}: ${v};`);
}
for (const [k, v] of Object.entries(lineHeights)) {
    lines.push(`    --line-height-${kebab(k)}: ${v};`);
}
for (const [k, v] of Object.entries(fontWeights)) {
    lines.push(`    --font-weight-${kebab(k)}: ${v};`);
}
for (const [k, v] of Object.entries(space)) {
    lines.push(`    --spacing-${k}: ${v};`);
}
for (const [k, v] of Object.entries(radius)) {
    lines.push(`    --radius-${k}: ${v};`);
}
for (const [k, v] of Object.entries(shadows)) {
    lines.push(`    --shadow-${k}: ${v};`);
}

lines.push('}');

writeFileSync(join(outDir, 'theme.css'), lines.join('\n') + '\n');
console.log(`Generated ${outDir}/theme.css (${lines.length} lines)`);
