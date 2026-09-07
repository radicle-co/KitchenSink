/**
 * Stage the Python Lambda asset, and REFUSE to produce a broken one.
 *
 * The analogue of every other service's `esbuild.mjs`, for a service that has none — deliberately, so W2 of
 * `serviceInfraWiringInvariants.test.ts` skips this service truthfully ("it packages its Lambdas some other
 * way") rather than being worked around. See ADR-0025 and KTD-16.
 *
 * ## ⛔ The verification is the point, not the copy
 *
 * `handle-sync-worker` shipped 4.6 KB of unbundled output because nothing between "the build ran" and "the
 * function cold-started" ever looked at what was in the archive. So the last thing this script does is run
 * the same pure predicate the guard suite fires at fakes (`infra/lib/assetContents.ts`) against the tree it
 * just produced, and exit non-zero on any finding. A bad asset is never PRODUCED, so there is nothing for a
 * later gate to catch.
 *
 * ## ⚠️ pip is not the only thing the asset needs
 *
 * The engine imports `nltk` and, at import time, asks it for a part-of-speech tagger that pip never
 * installs — NLTK data is DOWNLOADED. Left to itself the engine downloads it on first use, into `$HOME`,
 * which on Lambda is read-only: the first real deploy of this function threw
 * `OSError: [Errno 30] Read-only file system: '/home/sbx_user1051'` with a perfectly-verified asset,
 * because every derivation in the guard came from pip's `RECORD` and the corpus is in no `RECORD`. So this
 * script stages the corpus too, and the predicate now checks it against the archive's own manifest.
 *
 * ## Why `--platform` / `--only-binary` and not a plain `pip install`
 *
 * The build machine is x86-64 Linux or macOS on Node 24; the target is `python3.13` on **arm64** Lambda. A
 * plain install resolves wheels — or builds sdists — for the BUILD host, and `python-crfsuite` and `numpy`
 * are native. Those artifacts load nowhere on Lambda, and the failure is a cold-start `ImportError` in
 * production rather than an error here. `--only-binary=:all:` also turns "no wheel exists for this target"
 * into a loud build failure instead of a silent source build for the wrong platform.
 *
 * @sideEffect Deletes and rewrites `build/asset`, shells out to `python3 -m pip`, and exits the process.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetViolations, handlerModuleOf } from '../lib/assetContents.js';
import {
    readEngineRecord,
    readHandlerImports,
    readNltkRecord,
    readNltkResourceRequests,
    readRequirements,
    readStagedAsset,
    readStdlibModules,
    stageNltkResources,
} from '../lib/assetInspection.js';
import { ASSET_DIRECTORY, HANDLER, NLTK_DATA_DIRECTORY, PIP_TARGET } from '../lib/packaging.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceDirectory = path.join(packageRoot, 'src');
const assetDirectory = path.join(packageRoot, ASSET_DIRECTORY);
const requirementsFile = path.join(packageRoot, 'requirements.txt');

/**
 * Everything the guard predicate needs, each part derived rather than written down here.
 *
 * ⛔ READ-ONLY, deliberately. Every field is read back off the staged tree, including the corpus manifest —
 * which is read from the `RECORD` staging wrote rather than taken from staging's return value, so the
 * predicate is checking the artifact that will ship, not the intent of the code that produced it. It used
 * to stage the corpus itself, which put a side effect at an argument position: `readStagedAsset(…)` was
 * evaluated FIRST and the guard reported three files it had not yet been given the chance to write.
 *
 * @param engine - The engine's pinned requirement.
 * @param requested - The NLTK resources the engine's own AST asks for, as the library states them.
 * @returns The expectation.
 * @sideEffect Reads the staged tree and spawns `python3`.
 */
function expectationFor(engine: string, requested: readonly string[]): Parameters<typeof assetViolations>[1] {
    const handlerModule = handlerModuleOf(HANDLER);

    return {
        handlerModule,
        handlerImports: readHandlerImports(path.join(sourceDirectory, `${handlerModule}.py`)),
        stdlibModules: readStdlibModules(),
        engineRecord: readEngineRecord(assetDirectory, engine),
        corpusResources: requested.map((resource) => `${NLTK_DATA_DIRECTORY}/${resource}`),
        corpusRecord: readNltkRecord(assetDirectory, NLTK_DATA_DIRECTORY),
    };
}

function main(): void {
    const requirements = readRequirements(requirementsFile);
    const [engine] = requirements;

    if (engine === undefined) {
        throw new Error('build-asset: requirements.txt declares nothing to install');
    }

    rmSync(assetDirectory, { recursive: true, force: true });
    mkdirSync(assetDirectory, { recursive: true });

    execFileSync(
        'python3',
        [
            '-m',
            'pip',
            'install',
            '--disable-pip-version-check',
            '--no-cache-dir',
            '--target',
            assetDirectory,
            '--implementation',
            PIP_TARGET.implementation,
            '--python-version',
            PIP_TARGET.pythonVersion,
            ...PIP_TARGET.platforms.flatMap((platform) => ['--platform', platform]),
            '--only-binary=:all:',
            '--requirement',
            requirementsFile,
        ],
        { stdio: 'inherit' },
    );

    // The handler and anything beside it. Copied rather than symlinked: CDK's asset staging follows the
    // directory, and a symlink would publish a broken archive on a machine where the target moved.
    for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.py')) {
            copyFileSync(path.join(sourceDirectory, entry.name), path.join(assetDirectory, entry.name));
        }
    }

    // ⛔ The corpus pip never installs, staged BEFORE the tree is read. What the engine asks nltk for comes
    // out of the engine's own sources, and only then is that asked for — so a release needing a fourth
    // resource stages a fourth resource, and a release whose lookups this scan no longer recognises fails
    // the build here rather than reaching for the network on a read-only filesystem at cold start.
    const requested = readNltkResourceRequests(assetDirectory, readEngineRecord(assetDirectory, engine));

    stageNltkResources(assetDirectory, NLTK_DATA_DIRECTORY, requested);

    const violations = assetViolations(readStagedAsset(assetDirectory), expectationFor(engine, requested));

    if (violations.length > 0) {
        process.stderr.write(
            `build-asset: the staged asset would not start:\n${violations.map((line) => `  - ${line}`).join('\n')}\n`,
        );
        process.exit(1);
    }

    process.stdout.write(
        `build-asset: staged ${readStagedAsset(assetDirectory).length} files into ${ASSET_DIRECTORY}\n`,
    );
}

main();
