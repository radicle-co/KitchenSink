/**
 * THE PACKAGING GUARD for the repository's first non-Node deployable (U17, KTD-16).
 *
 * ## Why this file exists at all — the hole W2 leaves open, and the Lambda that already fell through it
 *
 * `serviceInfraWiringInvariants.test.ts` W2 pairs every deployed `handler:` string with an entry point in
 * the service's `esbuild.mjs`, and SKIPS a service that has none — _"it packages its Lambdas some other
 * way"_. That skip is honest (this service really does package some other way) and it is also a hole, and
 * the hole has been fallen through before: `handle-sync-worker` shipped **4.6 KB of raw `tsc` output**
 * against siblings of 436 KB–981 KB and died on every cold start with `ERR_MODULE_NOT_FOUND`, while two
 * guard tests watched — because _"both enumerated the same five names… a copy of a list cannot detect that
 * the list is incomplete."_
 *
 * So nothing here is a list. Every subject is DERIVED:
 *
 * | What is checked                      | Derived from                                                  |
 * | ------------------------------------ | ------------------------------------------------------------- |
 * | the handler module is in the asset   | the CDK `handler:` string, split at its last dot               |
 * | every dependency the handler imports | the handler's own Python **AST**, minus `sys.stdlib_module_names` |
 * | every engine file, byte for byte     | **pip's own `RECORD`** manifest for the installed distribution |
 * | the distribution to look for         | `requirements.txt`, normalised per PEP 503/427                 |
 * | every NLTK resource the engine needs | the **engine's own AST** — the string arguments of its `nltk.data.find(…)` calls |
 * | every corpus file, byte for byte     | the corpus **archive's own central directory**, staged as `nltk_data/RECORD` |
 *
 * ## ⚠️ The corpus row is here because the guard was blind to it once, in production
 *
 * The engine's `_utils.py` calls `download_nltk_resources()` AT IMPORT, which calls `nltk.data.find` for
 * three tagger files and, on `LookupError`, `nltk.download(…)` — a write to `$HOME`. The first real deploy
 * loaded the code package fine and then threw
 * `OSError: [Errno 30] Read-only file system: '/home/sbx_user1051'`. Every check above was green, because
 * the corpus is not in pip's `RECORD`: it is downloaded, not installed. So a second manifest, from a second
 * authority, covers it — and the resource paths are read out of the LIBRARY, so a release that needs a
 * fourth file fails the build instead of silently reaching for the network again. See ADR-0025.
 *
 * ⛔ `RECORD` is the load-bearing choice. It is pip's per-file manifest of what it installed, with a
 * declared size for every real file — so "the model artifact is present and whole" needs no one to know
 * that the model is called `model.en.crfsuite` or that it is 1.6 MB. Delete it, truncate it, or ship a
 * source-only install with no model at all, and the derivation notices without being told.
 *
 * ## Non-vacuity
 *
 * A guard whose subject set is empty passes forever. Two floors: the predicate REPORTS an empty manifest
 * or an empty asset as a violation in its own right (so it can never pass by finding nothing), and
 * 'the derived subject set is non-empty against the real package' fires the real readers at the real
 * `requirements.txt` and the real handler and demands they yield something.
 *
 * ## Mutation check
 *
 * 'reports the model artifact when it is missing from the asset' and its truncation sibling are the proof
 * that this guard can detect the failure it exists for — the assertions that would still pass if the
 * predicate were `() => []` are marked, and each has a negative control beside it.
 */
import { Architecture } from 'aws-cdk-lib/aws-lambda';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PYTHON_LAMBDA_RUNTIME } from '@kitchensink/infra-security';

import {
    type RecordedFile,
    type StagedFile,
    assetViolations,
    distInfoDirectory,
    handlerModuleOf,
} from '../lib/assetContents.js';
import { readHandlerImports, readRequirements, readStdlibModules } from '../lib/assetInspection.js';
import { ABI_TAG, LAMBDA_ARCHITECTURE, PIP_TARGET } from '../lib/packaging.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The engine's manifest, as pip writes it: real files carry a size, compiled `.pyc` entries do not. */
const engineRecord: readonly RecordedFile[] = [
    { path: 'ingredient_parser/__init__.py', bytes: 308 },
    { path: 'ingredient_parser/__pycache__/__init__.cpython-313.pyc', bytes: undefined },
    { path: 'ingredient_parser/parsers.py', bytes: 9_001 },
    { path: 'ingredient_parser/en/data/model.en.crfsuite', bytes: 1_596_376 },
];

/**
 * The tagger corpus's manifest, as the downloaded archive's own central directory declares it.
 *
 * A SECOND authority beside pip's `RECORD`, for files pip never installed. Paths are relative to the
 * staging root — the same coordinate system `RECORD` uses — so one predicate reads both.
 */
const corpusRecord: readonly RecordedFile[] = [
    {
        path: 'nltk_data/taggers/averaged_perceptron_tagger_eng/averaged_perceptron_tagger_eng.classes.json',
        bytes: 285,
    },
    {
        path: 'nltk_data/taggers/averaged_perceptron_tagger_eng/averaged_perceptron_tagger_eng.tagdict.json',
        bytes: 25_788,
    },
    {
        path: 'nltk_data/taggers/averaged_perceptron_tagger_eng/averaged_perceptron_tagger_eng.weights.json',
        bytes: 5_677_744,
    },
];

/** What the ENGINE asks `nltk.data.find` for, rooted at the staging root. Read from its AST, never listed. */
const corpusResources: readonly string[] = corpusRecord.map((entry) => entry.path);

/** A staged asset that satisfies every derivation above. */
const stagedAsset: readonly StagedFile[] = [
    { path: 'handler.py', bytes: 4_096 },
    { path: 'ingredient_parser/__init__.py', bytes: 308 },
    { path: 'ingredient_parser/parsers.py', bytes: 9_001 },
    { path: 'ingredient_parser/en/data/model.en.crfsuite', bytes: 1_596_376 },
    { path: 'pint/__init__.py', bytes: 5_000 },
    { path: '_pycrfsuite.cpython-313-x86_64-linux-gnu.so', bytes: 2_000_000 },
    ...corpusRecord.map((entry) => ({ path: entry.path, bytes: Number(entry.bytes) })),
];

const expectation = {
    handlerModule: 'handler',
    handlerImports: ['json', 'ingredient_parser', 'pint', '_pycrfsuite'],
    stdlibModules: ['json', 'sys', 'logging'],
    engineRecord,
    corpusResources,
    corpusRecord,
};

/** The staged asset with one entry replaced or removed, so a mutation reads as one line in the test. */
const without = (file: string): readonly StagedFile[] => stagedAsset.filter((entry) => entry.path !== file);

describe('assetViolations', () => {
    it('accepts an asset that carries the handler, every import and every recorded engine file', () => {
        expect(assetViolations(stagedAsset, expectation)).toEqual([]);
    });

    it('reports the model artifact when it is missing from the asset', () => {
        // ⛔ THE MUTATION CHECK. This is the exact shape of the handle-sync-worker failure: a structurally
        // valid asset that is missing the one file the runtime cannot start without. Nobody told the guard
        // the model's name — it came from pip's RECORD.
        const violations = assetViolations(without('ingredient_parser/en/data/model.en.crfsuite'), expectation);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('ingredient_parser/en/data/model.en.crfsuite');
    });

    it('reports a recorded engine file that is present but the wrong size', () => {
        // A truncated model is worse than an absent one: it exists, so a presence check passes, and the
        // runtime fails at load. RECORD declares the size, so this costs nothing extra to detect.
        const truncated = stagedAsset.map((entry) =>
            entry.path.endsWith('model.en.crfsuite') ? { ...entry, bytes: 12 } : entry,
        );
        const violations = assetViolations(truncated, expectation);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatch(/model\.en\.crfsuite/u);
        expect(violations[0]).toMatch(/1596376/u);
    });

    it('does not demand the compiled .pyc entries pip records without a size', () => {
        // Negative control for the two assertions above: RECORD's sizeless rows are bytecode pip may or may
        // not have written. Demanding them would make the guard fire on every correct asset, and a guard
        // that fires on correct input gets deleted.
        expect(assetViolations(stagedAsset, expectation)).toEqual([]);
    });

    it('reports the handler module when the asset does not carry it', () => {
        const violations = assetViolations(without('handler.py'), expectation);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('handler.py');
    });

    it('reports a third-party module the handler imports but the asset does not carry', () => {
        // The Python analogue of ERR_MODULE_NOT_FOUND, and the reason W2 exists for the Node services.
        const violations = assetViolations(without('pint/__init__.py'), expectation);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('pint');
    });

    it('accepts a native extension module staged as a bare .so', () => {
        // `python-crfsuite` installs as `_pycrfsuite.cpython-313-…so` with no package directory. Treating
        // that as missing would make the guard unusable for the one dependency that is hardest to package.
        expect(assetViolations(stagedAsset, expectation).join(' ')).not.toContain('_pycrfsuite');
    });

    it('does not require a module the interpreter itself provides', () => {
        // `json` is imported and is not in the asset. Requiring it would be wrong — the runtime ships it.
        expect(assetViolations(stagedAsset, expectation).join(' ')).not.toContain('json');
    });

    it('reports an empty asset rather than finding nothing to check', () => {
        const violations = assetViolations([], expectation);

        expect(violations.length).toBeGreaterThan(0);
        expect(violations.join(' ')).toMatch(/empty/u);
    });

    it('reports an empty manifest rather than passing vacuously', () => {
        // ⛔ THE NON-VACUITY FLOOR inside the predicate. If the RECORD lookup silently returned nothing —
        // a renamed dist-info, a changed pip layout, a build that never installed the engine — every
        // per-file assertion above would be checking an empty set and reporting success.
        const violations = assetViolations(stagedAsset, { ...expectation, engineRecord: [] });

        expect(violations.length).toBeGreaterThan(0);
        expect(violations.join(' ')).toMatch(/manifest/u);
    });

    it('reports the tagger corpus when the asset does not carry it', () => {
        // ⛔ THE MUTATION CHECK FOR THE DEFECT THAT SHIPPED. This asset is otherwise perfect: the handler is
        // there, every import resolves, every file pip recorded is present and whole. It deploys, it loads,
        // and it throws `OSError: [Errno 30] Read-only file system` the first time the engine is imported,
        // because `download_nltk_resources()` cannot find the tagger and reaches for the network.
        const violations = assetViolations(
            without('nltk_data/taggers/averaged_perceptron_tagger_eng/averaged_perceptron_tagger_eng.weights.json'),
            expectation,
        );

        // Two findings, from two independent derivations: the engine asked for this path, and the archive
        // recorded shipping it. Either alone would have caught it; both is the point of two authorities.
        expect(violations).toHaveLength(2);
        expect(violations.join(' ')).toContain('averaged_perceptron_tagger_eng.weights.json');
        expect(violations.join(' ')).toMatch(/read-only|download/iu);
    });

    it('reports a corpus file that is present but the wrong size', () => {
        // A half-written 5.7 MB weights file is the worst case: `nltk.data.find` SUCCEEDS, so nothing tries
        // to download, and the tagger dies on a JSON parse error at cold start instead.
        const truncated = stagedAsset.map((entry) =>
            entry.path.endsWith('averaged_perceptron_tagger_eng.weights.json') ? { ...entry, bytes: 12 } : entry,
        );
        const violations = assetViolations(truncated, expectation);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatch(/weights\.json/u);
        expect(violations[0]).toMatch(/5677744/u);
    });

    it('reports an empty corpus manifest rather than passing vacuously', () => {
        // ⛔ NON-VACUITY FLOOR, second authority. The corpus manifest is written during staging; if staging
        // silently did nothing, the per-file loop below it would check an empty set and report success —
        // which is precisely the state the function was deployed in.
        const violations = assetViolations(stagedAsset, { ...expectation, corpusRecord: [] });

        expect(violations.length).toBeGreaterThan(0);
        expect(violations.join(' ')).toMatch(/corpus/iu);
    });

    it('reports an empty corpus resource set rather than passing vacuously', () => {
        // ⛔ NON-VACUITY FLOOR, first authority. The resource paths come from the engine's own AST. If that
        // scan ever stops matching — a library that renames the call, a parse that yields nothing — the
        // guard must say so, not conclude that the engine needs no corpus.
        const violations = assetViolations(stagedAsset, { ...expectation, corpusResources: [] });

        expect(violations.length).toBeGreaterThan(0);
        expect(violations.join(' ')).toMatch(/nltk|corpus/iu);
    });

    it('does not demand a corpus file the archive shipped but the engine never asks for', () => {
        // Negative control for the two floors above: the archive's manifest is the whole package, which may
        // carry more than the three files the engine looks up. Requiring the ENGINE to ask for every one of
        // them would make the guard fire on a correct asset.
        const extra = 'nltk_data/taggers/averaged_perceptron_tagger_eng/README';
        const withExtra = {
            ...expectation,
            corpusRecord: [...corpusRecord, { path: extra, bytes: 40 }],
        };

        expect(assetViolations([...stagedAsset, { path: extra, bytes: 40 }], withExtra)).toEqual([]);
    });

    it('names every missing thing at once rather than stopping at the first', () => {
        const violations = assetViolations([{ path: 'unrelated.txt', bytes: 1 }], expectation);

        expect(violations.length).toBeGreaterThan(1);
    });
});

describe('handlerModuleOf', () => {
    it('takes everything before the LAST dot, so a nested handler resolves', () => {
        expect(handlerModuleOf('handler.handle')).toBe('handler');
        expect(handlerModuleOf('parse/handler.handle')).toBe('parse/handler');
    });

    it('refuses a handler string carrying no exported symbol', () => {
        expect(() => handlerModuleOf('handler')).toThrow(/handler/u);
    });
});

describe('distInfoDirectory', () => {
    it('normalises a requirement to the directory pip actually writes', () => {
        // PEP 503/427: runs of `-`, `_` and `.` collapse to a single `_` in the dist-info name, which is why
        // `ingredient-parser-nlp` is looked up as `ingredient_parser_nlp-2.3.0.dist-info`. Hardcoding the
        // written form would silently stop matching the day the requirement is re-spelled.
        expect(distInfoDirectory('ingredient-parser-nlp==2.3.0')).toBe('ingredient_parser_nlp-2.3.0.dist-info');
        expect(distInfoDirectory('Some.Dist==1.0')).toBe('some_dist-1.0.dist-info');
    });

    it('refuses a requirement that is not pinned to an exact version', () => {
        // An unpinned requirement has no dist-info name to look for, and a floating engine version would
        // silently change the model this service ships. Both reasons point the same way.
        expect(() => distInfoDirectory('ingredient-parser-nlp>=2.3.0')).toThrow(/==/u);
    });
});

describe('the pip target and the deployed function describe the same machine', () => {
    // ⛔ The failure this prevents is invisible until production: pip builds wheels for whatever
    // `--python-version` / `--platform` say, the function runs whatever CDK says, and a mismatch installs
    // cleanly on the build host and raises ImportError on the first cold start. A comment saying "these must
    // move together" is not a control; this is.
    it('builds wheels for the interpreter the pinned runtime provides', () => {
        expect(`python${PIP_TARGET.pythonVersion}`).toBe(PYTHON_LAMBDA_RUNTIME.name);
    });

    it('builds wheels for the CPU the function is declared to run on', () => {
        const wheelCpu = { [Architecture.ARM_64.name]: 'aarch64', [Architecture.X86_64.name]: 'x86_64' }[
            LAMBDA_ARCHITECTURE.name
        ];

        expect(wheelCpu, `no wheel platform tag is known for ${LAMBDA_ARCHITECTURE.name}`).toBeDefined();
        expect(PIP_TARGET.platforms.every((platform) => platform.endsWith(String(wheelCpu)))).toBe(true);
    });

    it('derives the ABI tag pip stamps into a compiled extension', () => {
        expect(ABI_TAG).toBe(`cp${PIP_TARGET.pythonVersion.replace('.', '')}`);
    });
});

describe('the derived subject set is non-empty against the real package', () => {
    // ⛔ THE OUTER NON-VACUITY FLOOR. Everything above runs against fixtures, which proves the predicate
    // works and proves nothing about this package. These fire the REAL readers at the REAL files, so a
    // requirements file that stops listing the engine, or a handler that stops importing it, is caught.
    it('reads at least one pinned requirement from requirements.txt', () => {
        const requirements = readRequirements(path.join(packageRoot, 'requirements.txt'));

        expect(requirements.length).toBeGreaterThan(0);
        expect(requirements.every((requirement) => requirement.includes('=='))).toBe(true);
    });

    it('parses at least one third-party import out of the real handler', () => {
        const imports = readHandlerImports(path.join(packageRoot, 'src', 'handler.py'));
        const stdlib = new Set(readStdlibModules());
        const thirdParty = imports.filter((module) => !stdlib.has(module));

        expect(thirdParty.length).toBeGreaterThan(0);
    });

    it('reads a non-empty stdlib set from the interpreter rather than a hand-written list', () => {
        const stdlib = readStdlibModules();

        expect(stdlib.length).toBeGreaterThan(100);
        expect(stdlib).toContain('json');
    });

    it('finds the engine among the real requirements, resolved to a real dist-info name', () => {
        const requirements = readRequirements(path.join(packageRoot, 'requirements.txt'));
        const directories = requirements.map(distInfoDirectory);

        expect(directories.some((directory) => directory.startsWith('ingredient_parser_nlp-'))).toBe(true);
    });
});
