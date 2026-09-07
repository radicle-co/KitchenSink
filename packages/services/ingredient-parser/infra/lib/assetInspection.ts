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
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type RecordedFile, type StagedFile, distInfoDirectory } from './assetContents.js';

/**
 * The module whose `data.find` calls name the corpora the engine needs.
 *
 * The scan below matches `nltk.data.find(<literal>)` specifically rather than any `*.data.find`, because a
 * looser match would collect whatever else in the tree happens to spell those two attributes. What is
 * derived is WHICH resources — never how many, never their names.
 */
const NLTK_MODULE = 'nltk';

/** Where the archive-derived corpus manifest is written, inside the corpus directory. Mirrors pip's name. */
const CORPUS_RECORD_FILE = 'RECORD';

/**
 * Run a short Python program and return its stdout.
 *
 * @param program - The program text, passed to `python3 -c`.
 * @param args - Arguments the program reads from `sys.argv[1:]`.
 * @param options - `input` is fed to the program's stdin; `modulePath` is prepended to `PYTHONPATH`.
 * @returns The program's stdout.
 * @sideEffect Spawns `python3`.
 * @throws When `python3` is missing or the program fails — never silently, see the file header.
 */
function runPython(
    program: string,
    args: readonly string[] = [],
    options: { readonly input?: string; readonly modulePath?: string } = {},
): string {
    const environment =
        options.modulePath === undefined
            ? process.env
            : {
                  ...process.env,
                  PYTHONPATH: [options.modulePath, process.env['PYTHONPATH']].filter(Boolean).join(path.delimiter),
              };

    try {
        return execFileSync('python3', ['-c', program, ...args], {
            encoding: 'utf8',
            maxBuffer: 1 << 24,
            env: environment,
            ...(options.input === undefined ? {} : { input: options.input }),
            // The corpus download prints progress and pip prints resolution; both go to the caller's stderr
            // so a build log still says what happened, while stdout stays a clean JSON channel.
            stdio: ['pipe', 'pipe', 'inherit'],
        });
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
    return readRecordFile(path.join(directory, distInfoDirectory(requirement), 'RECORD'));
}

/**
 * One `RECORD` file, in pip's CSV form, as manifest rows.
 *
 * @param record - Path to the file.
 * @returns One entry per recorded row; empty when the file is absent, which `assetViolations` reports as a
 *   violation in its own right rather than treating as "nothing to check".
 * @sideEffect Reads the file.
 */
function readRecordFile(record: string): readonly RecordedFile[] {
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

/** Every distribution installed under a `pip --target` tree, as its `.dist-info` directory name. */
function distInfoDirectories(directory: string): readonly string[] {
    if (!existsSync(directory)) {
        return [];
    }

    return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.endsWith('.dist-info'))
        .map((entry) => entry.name);
}

/**
 * The exact requirement pin for whichever installed distribution PROVIDES a top-level module.
 *
 * ⛔ Derived, not `nltk==<whatever we last saw>`. The build downloads the corpus with the SAME nltk release
 * the asset will run, so the archive layout it writes is the layout the deployed interpreter reads. Which
 * distribution provides `nltk` is answered by pip's own `RECORD` — a distribution name and a module name
 * are not the same thing, and assuming they are is how a guard stops pointing at its subject.
 *
 * @param directory - The staging root.
 * @param module - The top-level module name to find a provider for.
 * @returns A `name==version` requirement, ready for pip.
 * @sideEffect Reads the filesystem.
 * @throws When nothing installed provides the module — the corpus could then not be fetched at all, and a
 *   silent skip is what put the download back on the cold-start path in the first place.
 */
export function providingRequirement(directory: string, module: string): string {
    const provider = distInfoDirectories(directory).find((distInfo) =>
        readRecordFile(path.join(directory, distInfo, 'RECORD')).some(
            (row) => row.path === `${module}/__init__.py` || row.path === `${module}.py`,
        ),
    );

    if (provider === undefined) {
        throw new Error(
            `asset-inspection: no distribution installed under '${directory}' records providing the '${module}' ` +
                'module, so the build cannot fetch the corpus that module downloads',
        );
    }

    const nameAndVersion = provider.replace(/\.dist-info$/u, '');
    const lastDash = nameAndVersion.lastIndexOf('-');

    if (lastDash <= 0) {
        throw new Error(`asset-inspection: '${provider}' is not a 'name-version.dist-info' directory`);
    }

    return `${nameAndVersion.slice(0, lastDash)}==${nameAndVersion.slice(lastDash + 1)}`;
}

/** The string arguments of every `nltk.data.find(…)` call in a set of Python sources. */
const NLTK_RESOURCE_PROGRAM = `
import ast, json, sys
module = sys.argv[1]
resources = set()
for source in json.loads(sys.stdin.read()):
    tree = ast.parse(open(source, encoding='utf-8').read())
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        found = node.func
        if not isinstance(found, ast.Attribute) or found.attr != 'find':
            continue
        data = found.value
        if not isinstance(data, ast.Attribute) or data.attr != 'data':
            continue
        owner = data.value
        if not isinstance(owner, ast.Name) or owner.id != module:
            continue
        for argument in node.args:
            if isinstance(argument, ast.Constant) and isinstance(argument.value, str):
                resources.add(argument.value)
print(json.dumps(sorted(resources)))
`;

/**
 * Every NLTK resource the installed ENGINE looks up, read from the engine's own AST.
 *
 * ⛔ This is the derivation the whole corpus check hangs on. `ingredient_parser/_common.py` names the three
 * tagger files as string literals inside `download_nltk_resources()`; reading them out of the library means
 * an engine release that needs a FOURTH file fails the build loudly instead of silently downloading it at
 * cold start onto a read-only filesystem. Parsed, never grepped, for the reasons in the file header.
 *
 * Only the engine's OWN sources are scanned — from pip's `RECORD`, so the file set is pip's statement, not
 * a walk of whatever else is in the tree. nltk itself calls `find` for corpora nothing here uses.
 *
 * @param directory - The staging root.
 * @param engineRecord - pip's `RECORD` rows for the engine distribution.
 * @returns Resource paths as the library states them, e.g. `taggers/…/….classes.json`, sorted.
 * @sideEffect Spawns `python3` and reads the engine's sources.
 */
export function readNltkResourceRequests(directory: string, engineRecord: readonly RecordedFile[]): readonly string[] {
    const sources = engineRecord
        .filter((row) => row.path.endsWith('.py'))
        .map((row) => path.join(directory, row.path))
        .filter((source) => existsSync(source));

    return JSON.parse(runPython(NLTK_RESOURCE_PROGRAM, [NLTK_MODULE], { input: JSON.stringify(sources) })) as string[];
}

/**
 * Download each NLTK package, keep only its extracted files, and report the archive's own manifest.
 *
 * `info.filename` already carries the collection subdirectory (`taggers/x.zip`), so the extracted files land
 * at `<subdir>/<entry>` and the archive's central directory is a per-file manifest for exactly that layout.
 * The archive is DELETED after extraction: nltk can read a corpus straight out of a zip, but a 1.5 MB
 * already-compressed blob does not shrink again inside the deployment package, while the 5.7 MB of JSON it
 * holds compresses to about the same — so keeping both is pure cost against Lambda's 50 MB zipped limit.
 */
const NLTK_DOWNLOAD_PROGRAM = `
import contextlib, json, os, posixpath, sys, zipfile
import nltk, nltk.downloader

target = sys.argv[1]
manifest = []
with contextlib.redirect_stdout(sys.stderr):
    downloader = nltk.downloader.Downloader()
    for package in sys.argv[2:]:
        if not nltk.download(package, download_dir=target, quiet=True, raise_on_error=True):
            raise SystemExit("nltk refused to download " + package)
        archive = os.path.join(target, *downloader.info(package).filename.split('/'))
        collection = posixpath.dirname(downloader.info(package).filename)
        with zipfile.ZipFile(archive) as opened:
            for entry in opened.infolist():
                if not entry.is_dir():
                    manifest.append({
                        "path": posixpath.join(collection, entry.filename),
                        "bytes": entry.file_size,
                    })
        os.remove(archive)
print(json.dumps(manifest))
`;

/**
 * Stage the NLTK corpora the engine needs INTO the asset, and write the manifest that proves it.
 *
 * ## Why a second, host-native pip install
 *
 * The nltk already in the asset cannot be imported here: it sits beside arm64/CPython-3.13 wheels that this
 * build host cannot load. So the downloader is installed for the HOST, at the version the asset itself
 * records — see {@link providingRequirement} — and used only to fetch.
 *
 * ## Why the manifest is written into the asset
 *
 * The archive's central directory is the only upstream statement of what the corpus contains, and it exists
 * only while the archive does. Persisting it as `<corpus>/RECORD`, in pip's own CSV shape and pip's own
 * coordinate system (paths relative to the staging root), lets every later check — the build's own
 * predicate, the integration tier, anything that inspects a staged tree — verify the corpus without
 * re-downloading it. What it asserts is upstream's: the files this package ships and their sizes.
 *
 * @param directory - The staging root.
 * @param corpusDirectory - Where the corpus goes inside it, relative — `NLTK_DATA_DIRECTORY`.
 * @param resources - Resource paths from {@link readNltkResourceRequests}.
 * @returns The archive-derived manifest, paths relative to the staging root.
 * @sideEffect Installs nltk into a temporary directory, downloads over the network, writes into the asset.
 * @throws When no resource was requested — staging nothing and reporting an empty manifest would leave the
 *   predicate's floors as the only thing standing between here and another read-only-filesystem crash.
 */
export function stageNltkResources(
    directory: string,
    corpusDirectory: string,
    resources: readonly string[],
): readonly RecordedFile[] {
    if (resources.length === 0) {
        throw new Error(
            'asset-inspection: the engine requested no NLTK resource, so there is nothing to stage — the scan ' +
                'of its `nltk.data.find` calls found nothing and the corpus check would be vacuous',
        );
    }

    // A resource is `<collection>/<package>/<file>`; the package is what nltk's downloader is asked for. A
    // wrong guess cannot pass silently: the predicate checks each REQUESTED path against the staged tree.
    const packages = [...new Set(resources.map((resource) => resource.split('/')[1] ?? ''))].filter(
        (name) => name !== '',
    );

    if (packages.length === 0) {
        throw new Error(
            `asset-inspection: none of the requested NLTK resources (${resources.join(', ')}) name a package ` +
                'to download — the expected shape is `<collection>/<package>/<file>`',
        );
    }

    const corpusRoot = path.join(directory, corpusDirectory);
    const downloader = mkdtempSync(path.join(tmpdir(), 'ingredient-parser-nltk-'));

    try {
        execFileSync(
            'python3',
            [
                '-m',
                'pip',
                'install',
                '--disable-pip-version-check',
                '--no-cache-dir',
                '--target',
                downloader,
                providingRequirement(directory, NLTK_MODULE),
            ],
            { stdio: 'inherit' },
        );

        const manifest = (
            JSON.parse(runPython(NLTK_DOWNLOAD_PROGRAM, [corpusRoot, ...packages], { modulePath: downloader })) as {
                path: string;
                bytes: number;
            }[]
        ).map((entry) => ({ path: `${corpusDirectory}/${entry.path}`, bytes: entry.bytes }));

        writeFileSync(
            path.join(corpusRoot, CORPUS_RECORD_FILE),
            `${manifest.map((entry) => `${entry.path},,${entry.bytes}`).join('\n')}\n`,
            'utf8',
        );

        return manifest;
    } finally {
        rmSync(downloader, { recursive: true, force: true });
    }
}

/**
 * The corpus manifest a previous {@link stageNltkResources} left in the asset.
 *
 * @param directory - The staging root.
 * @param corpusDirectory - Where the corpus lives inside it, relative.
 * @returns One entry per recorded file, paths relative to the staging root; empty when absent.
 * @sideEffect Reads the file.
 */
export function readNltkRecord(directory: string, corpusDirectory: string): readonly RecordedFile[] {
    return readRecordFile(path.join(directory, corpusDirectory, CORPUS_RECORD_FILE));
}
