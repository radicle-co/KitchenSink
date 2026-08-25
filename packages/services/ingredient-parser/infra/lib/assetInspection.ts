/**
 * The IMPURE half of the packaging guard: everything that reads the filesystem or the interpreter.
 *
 * Split from `assetContents.ts` so the predicate stays pure and can be fired at a deliberately-violating
 * fake — the property `packages/infra/global/__tests__/serviceSources.ts` establishes for the repo-wide
 * gates ("everything here is MECHANISM; the invariants live in the guard suites as pure predicates").
 *
 * ## ⚠️ Python is PARSED, never grepped
 *
 * `readHandlerImports` shells out to the interpreter's own `ast` module. A regex over the handler's text
 * would read the module names in this docstring as imports, would miss a conditional import, and would
 * report its own rationale as a finding — the exact failure `serviceSources.ts` documents for the
 * TypeScript gates ("a gate that fires on its own rationale gets deleted"). The stdlib set comes from
 * `sys.stdlib_module_names` for the same reason: a hand-written list of what Python ships is a copy of a
 * list, and this whole guard exists because copies of lists do not detect their own gaps.
 *
 * ⛔ These throw rather than degrading when `python3` is absent. A machine with no interpreter cannot build
 * this asset at all, so "skip the check" would only ever mean "pass without checking".
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { type RecordedFile, type StagedFile, distInfoDirectory } from './assetContents.js';

/**
 * Run a short Python program and return its stdout.
 *
 * @param program - The program text, passed to `python3 -c`.
 * @param args - Arguments the program reads from `sys.argv[1:]`.
 * @returns The program's stdout.
 * @sideEffect Spawns `python3`.
 * @throws When `python3` is missing or the program fails — never silently, see the file header.
 */
function runPython(program: string, args: readonly string[] = []): string {
    try {
        return execFileSync('python3', ['-c', program, ...args], { encoding: 'utf8', maxBuffer: 1 << 24 });
    } catch (cause) {
        throw new Error(
            'asset-inspection: could not run python3 — this package cannot be packaged or verified without ' +
                'an interpreter',
            { cause },
        );
    }
}

/**
 * Every file in the staged asset directory, with its size.
 *
 * @param directory - The staging root.
 * @returns One entry per file, paths relative to the root with POSIX separators.
 * @sideEffect Walks the filesystem.
 */
export function readStagedAsset(directory: string): readonly StagedFile[] {
    if (!existsSync(directory)) {
        return [];
    }

    const files: StagedFile[] = [];

    const walk = (absolute: string, relative: string): void => {
        for (const entry of readdirSync(absolute, { withFileTypes: true })) {
            const childAbsolute = path.join(absolute, entry.name);
            const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;

            if (entry.isDirectory()) {
                walk(childAbsolute, childRelative);
            } else if (entry.isFile()) {
                files.push({ path: childRelative, bytes: statSync(childAbsolute).size });
            }
        }
    };

    walk(directory, '');

    return files;
}

/**
 * The exactly-pinned requirements declared in a `requirements.txt`.
 *
 * Comments and blank lines are dropped; everything else is returned verbatim so
 * {@link distInfoDirectory} can reject anything that is not a `name==version` pin.
 *
 * @param file - Path to the requirements file.
 * @returns One entry per requirement line, in file order.
 * @sideEffect Reads the file.
 */
export function readRequirements(file: string): readonly string[] {
    return readFileSync(file, 'utf8')
        .split('\n')
        .map((line) => line.replace(/#.*$/u, '').trim())
        .filter((line) => line.length > 0);
}

/**
 * pip's `RECORD` rows for one installed distribution inside a staged asset.
 *
 * Returns an empty array when the dist-info is absent, which `assetViolations` reports as a
 * violation in its own right rather than treating as "nothing to check".
 *
 * @param directory - The staging root.
 * @param requirement - The pinned requirement whose distribution to read.
 * @returns One entry per recorded file.
 * @sideEffect Reads the file.
 */
export function readEngineRecord(directory: string, requirement: string): readonly RecordedFile[] {
    const record = path.join(directory, distInfoDirectory(requirement), 'RECORD');

    if (!existsSync(record)) {
        return [];
    }

    return readFileSync(record, 'utf8')
        .split('\n')
        .flatMap((line) => {
            // `path,sha256=…,size`. The path may be quoted when it contains a comma; pip writes CSV, so
            // splitting on the LAST two commas is what survives that without a CSV parser.
            const trimmed = line.trim();

            if (trimmed.length === 0) {
                return [];
            }

            const lastComma = trimmed.lastIndexOf(',');
            const secondLastComma = trimmed.lastIndexOf(',', lastComma - 1);

            if (lastComma < 0 || secondLastComma < 0) {
                return [];
            }

            const size = trimmed.slice(lastComma + 1);
            const recorded = trimmed.slice(0, secondLastComma).replace(/^"|"$/gu, '');

            return [{ path: recorded, bytes: /^\d+$/u.test(size) ? Number(size) : undefined }];
        });
}

/** Top-level module names a Python source file imports, read from its AST. */
const IMPORT_ROOTS_PROGRAM = `
import ast, sys, json
tree = ast.parse(open(sys.argv[1], encoding='utf-8').read())
roots = set()
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        roots.update(alias.name.split('.')[0] for alias in node.names)
    elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
        roots.add(node.module.split('.')[0])
print(json.dumps(sorted(roots)))
`;

/**
 * Every top-level module a Python source file imports, parsed rather than matched.
 *
 * Relative imports (`from .x import y`) are excluded on purpose: they resolve within the handler's own
 * package, so they say nothing about what must be staged alongside it.
 *
 * @param file - Path to the Python source.
 * @returns Root module names, sorted.
 * @sideEffect Spawns `python3` and reads the file.
 */
export function readHandlerImports(file: string): readonly string[] {
    return JSON.parse(runPython(IMPORT_ROOTS_PROGRAM, [file])) as string[];
}

/**
 * The module names the running interpreter provides itself.
 *
 * @returns `sys.stdlib_module_names`, sorted.
 * @sideEffect Spawns `python3`.
 */
export function readStdlibModules(): readonly string[] {
    return JSON.parse(runPython('import sys, json; print(json.dumps(sorted(sys.stdlib_module_names)))')) as string[];
}
