/**
 * `prune [--check] <board.dc.html>...`: removes the CSS rules no element of a board uses, in place.
 *
 *   exit 0  no dead class remains (and, under `--check`, nothing would change)
 *   exit 1  a dead class remains that the pruner keeps on purpose, or `--check` found a board that would change
 *   exit 2  no files, an unknown flag, or a file that cannot be read or written
 *
 * Relative paths resolve against `INIT_CWD`, where npm was started. Every file is read before any is written.
 *
 * @sideEffect Reads and writes the named boards, writes to stdout and stderr, and sets the exit code.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { deadClassSelectors } from '../src/deadClassSelectors.js';
import { pruneBoard } from '../src/pruneDeadClassRules.js';

const args = process.argv.slice(2);
const flags = args.filter((arg) => arg.startsWith('--'));
const paths = args.filter((arg) => !arg.startsWith('--')).map((path) => resolve(process.env['INIT_CWD'] ?? '.', path));
const check = flags.includes('--check');
const unknown = flags.filter((flag) => flag !== '--check');

if (unknown.length > 0 || paths.length === 0) {
    process.stderr.write(
        `usage: prune [--check] <board.dc.html>...${unknown.length > 0 ? ` (unknown: ${unknown.join(' ')})` : ''}\n`,
    );
    process.exit(2);
}

const sources = await Promise.all(paths.map((path) => readFile(path, 'utf8'))).catch((error: unknown) => {
    process.stderr.write(`cannot read: ${String(error)}\n`);

    return process.exit(2);
});

let changed = false;
let residue = false;

for (const [index, path] of paths.entries()) {
    const pruned = pruneBoard(sources[index] ?? '');
    const kept = deadClassSelectors(pruned.html);

    if (pruned.html !== sources[index]) {
        changed = true;
        process.stdout.write(`${path}: removed ${pruned.removed} selectors\n`);

        if (!check) {
            await writeFile(path, pruned.html).catch((error: unknown) => {
                process.stderr.write(`cannot write: ${String(error)}\n`);

                return process.exit(2);
            });
        }
    }

    if (kept.length > 0) {
        residue = true;
        process.stdout.write(`${path}: ${kept.length} dead classes kept: ${kept.join(', ')}\n`);
    }
}

process.exitCode = residue || (check && changed) ? 1 : 0;
