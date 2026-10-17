/**
 * Write the Tailwind v4 `theme.css` artifact the web app imports.
 *
 * The COMPOSITION lives in `src/tokens/themeCss.ts` (pure, and imported by the byte-identity test), so this
 * script owns only the filesystem side-effect. Keeping the two apart is what lets the test guard the real
 * generator output instead of re-implementing the emission loops and hoping the two stay in agreement.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { themeCss } from '../dist/tokens/themeCss.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const outDir = process.argv[2] ?? 'dist';
const resolved = join(__dirname, '..', outDir);
if (!existsSync(resolved)) mkdirSync(resolved, { recursive: true });

const css = themeCss();

writeFileSync(join(outDir, 'theme.css'), css);
console.log(`Generated ${outDir}/theme.css (${css.split('\n').length - 1} lines)`);
