/**
 * Writes docs/architecture/recipeStateModel.md (between the markers) and recipeStateModel.json from the recipe-core state
 * module, or checks that they are current.
 *
 *   npm run recipeState:generate   write both
 *   npm run recipeState:verify     exit 1 when either differs from the module (CI)
 *
 * @sideEffect Reads and writes the two files under docs/architecture.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateFiles } from '../src/generate.js';

const root = resolve(fileURLToPath(import.meta.url), '../../../../..');
const docPath = resolve(root, 'docs/architecture/recipeStateModel.md');
const jsonPath = resolve(root, 'docs/architecture/recipeStateModel.json');

const check = process.argv.includes('--check');
const [doc, json] = await Promise.all([readFile(docPath, 'utf8'), readFile(jsonPath, 'utf8')]);
const next = await generateFiles({ docPath, jsonPath, doc });
const stale = [doc !== next.doc ? docPath : undefined, json !== next.json ? jsonPath : undefined].filter(
    (path): path is string => path !== undefined,
);

if (check) {
    if (stale.length > 0) {
        process.stderr.write(
            `Stale generated files (run \`npm run recipeState:generate\` and commit):\n${stale.join('\n')}\n`,
        );
        process.exit(1);
    }

    process.stdout.write('recipeState: the document and the JSON match the module.\n');
} else {
    await Promise.all([writeFile(docPath, next.doc), writeFile(jsonPath, next.json)]);
    process.stdout.write(
        stale.length === 0 ? 'recipeState: already current.\n' : `recipeState: wrote ${stale.join(', ')}\n`,
    );
}
