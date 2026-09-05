/**
 * Python in this repository was UNCHECKED. ESLint does not read `.py`, `tsc` does not read `.py`, and
 * Prettier does not format it — so every gate the TypeScript passes through was structurally blind to the
 * committed Python, and a syntax error in it was invisible to every suite.
 *
 * ADR-0025 recorded that as a residual risk of shipping the repository's first non-Node deployable, and
 * named the file it knew about (`packages/services/ingredient-parser/src/handler.py`). It knew about ONE.
 * There are TWO — `packages/tools/cookbook-import/scripts/crfParse.py` is the sidecar that loads the CRF
 * model once for a whole corpus — which is the ordinary way a hand-written list goes stale, and exactly why
 * this guard ENUMERATES NOTHING. Every rule below starts from `git ls-files`, so a third Python file added
 * anywhere under `packages/` is covered on the commit that adds it or fails this suite.
 *
 * ## One toolchain, one config, checked from the root
 *
 * The checks are declared ONCE, in the root manifest, rather than per workspace. Two workspaces hold
 * Python today; giving each its own `pyproject.toml` would be two copies of "how this repository writes
 * Python", and mypy does not walk up the tree to find a shared one — so per-workspace scripts would each
 * carry a relative `--config-file` path whose depth differs by workspace group. Root-level is what both
 * tools are designed for, and it makes the coverage question structural: the target is `packages`, so a
 * new Python file is inside it by construction.
 *
 * ⚠️ They are SUFFIXED (`lint:python`) rather than folded into `lint`/`typecheck`/`format:check`. Those
 * three are turbo tasks every workspace and every developer runs, and folding Python in would make a
 * Python toolchain a precondition for `npm run lint` across the whole monorepo — the opposite of the
 * decision `packages/services/ingredient-parser/package.json` already records in its `localSandbox`
 * note, that a local sandbox "must not require a Python toolchain or network to START".
 *
 * ## Why a check that no job runs is worse than no check
 *
 * The repository has already paid for this twice — 21 k6 scripts that no job invoked, and
 * `recipes/ingredient-catalog-blend.yaml`, a committed Maestro flow executed by nothing for months. A
 * declared `lint:python` that CI never calls is the same silent success, so the third rule closes the loop
 * from the manifest to a real workflow step.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * The npm scripts the ROOT manifest must declare — one per check the TypeScript already gets. `lint:python`
 * is ESLint's analogue, `format:check:python` is Prettier's, `typecheck:python` is `tsc`'s, and
 * `format:python` is the writing half of `npm run format`.
 */
const REQUIRED_PYTHON_SCRIPTS = ['lint:python', 'format:python', 'format:check:python', 'typecheck:python'] as const;

/** The one directory every Python check must cover: the tree this repository authors. */
const OWN_SOURCE_ROOT = 'packages';

/** The pinned dev toolchain, and the config both tools read. */
const DEV_REQUIREMENTS = 'requirements-dev.txt';
const PYTHON_CONFIG = 'pyproject.toml';

interface WorkflowDocument {
    readonly jobs?: Readonly<Record<string, { readonly steps?: readonly { readonly run?: string }[] }>>;
}

/** Every tracked file, POSIX-relative to the repo root. `git ls-files` IS the definition of "committed". */
function trackedFiles(): readonly string[] {
    return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((line) => line.length > 0);
}

/** Committed `.py` files under `packages/` — the Python this repository authors, as opposed to vendors. */
export function ownPythonSources(tracked: readonly string[]): readonly string[] {
    return tracked.filter((file) => file.startsWith(`${OWN_SOURCE_ROOT}/`) && file.endsWith('.py'));
}

/** A required check the root manifest does not declare, or declares against something narrower than ours. */
export function findMissingPythonScripts(scripts: Readonly<Record<string, string>>): readonly string[] {
    return REQUIRED_PYTHON_SCRIPTS.flatMap((name) => {
        const command = scripts[name];

        if (typeof command !== 'string') {
            return [`the root manifest declares no \`${name}\` script`];
        }

        // The TARGET is what makes coverage structural. A check aimed at one file or one workspace passes
        // for as long as nobody adds Python somewhere else, which is the failure this whole guard exists
        // to make impossible — so the target must be the whole authored tree.
        if (!new RegExp(`(^| )${OWN_SOURCE_ROOT}( |$)`).test(command)) {
            return [`\`${name}\` does not target \`${OWN_SOURCE_ROOT}\` — it cannot cover Python added elsewhere`];
        }

        return [];
    });
}

/** Every `run:` body across the given workflows. */
export function workflowRunBodies(workflows: readonly WorkflowDocument[]): readonly string[] {
    return workflows.flatMap((doc) =>
        Object.values(doc.jobs ?? {}).flatMap((job) =>
            (job.steps ?? []).map((step) => step.run).filter((run): run is string => typeof run === 'string'),
        ),
    );
}

/** A declared Python check that no workflow step invokes — a gate that cannot fail. */
export function findUnrunPythonScripts(
    scripts: Readonly<Record<string, string>>,
    runBodies: readonly string[],
): readonly string[] {
    // `format:python` WRITES; it is the developer's fix command and must never run in CI, so only the
    // three verifying checks are required to appear in a workflow.
    return REQUIRED_PYTHON_SCRIPTS.filter((name) => name !== 'format:python')
        .filter((name) => typeof scripts[name] === 'string')
        .filter((name) => !runBodies.some((body) => body.includes(name)))
        .map((name) => `no CI step runs \`${name}\` — a check no job invokes cannot fail`);
}

/**
 * A dev tool whose version is not `==`-pinned.
 *
 * An unpinned linter changes its own verdict on someone else's release schedule: a new ruff rule turns a
 * green branch red with no diff of ours, on the tier least able to explain itself. This is the same
 * argument `packages/services/ingredient-parser/requirements.txt` already makes for the engine and
 * `_ci-heavy.yml` makes for the Maestro CLI.
 */
export function findUnpinnedTools(requirements: string): readonly string[] {
    return requirements
        .split('\n')
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter((line) => line.length > 0)
        .filter((line) => !/^[A-Za-z0-9._-]+==[0-9]/.test(line))
        .map((line) => `\`${line}\` is not \`==\`-pinned — the toolchain's verdict must not float`);
}

/**
 * An exclusion in the tool config that would silently drop one of our own sources from the check.
 *
 * This is the one way a structurally-covering target can still check nothing: `ruff check packages` with
 * `exclude = ["packages/services/ingredient-parser"]` reports success over the file it was aimed at. The
 * comparison is on the raw config text rather than a parsed TOML tree deliberately — an exclusion may be
 * written as `exclude`, `extend-exclude`, or mypy's `exclude` regex, and a rule that had to know which
 * would miss the two it did not.
 */
export function findExcludedOwnSources(config: string, sources: readonly string[]): readonly string[] {
    const excludeBlocks = config
        .split('\n')
        .filter((line) => /^\s*(extend-)?exclude\s*=/.test(line) || /^\s*"/.test(line))
        .join('\n');

    return sources
        .filter((source) => {
            const workspace = source.split('/').slice(0, 3).join('/');

            return excludeBlocks.includes(source) || excludeBlocks.includes(workspace);
        })
        .map((source) => `${source} is named in an exclusion — the check would report success over it`);
}

function realWorkflowDocuments(): readonly WorkflowDocument[] {
    return execFileSync('git', ['ls-files', '.github/workflows'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .map((file) => parse(readFileSync(join(REPO_ROOT, file), 'utf8')) as WorkflowDocument);
}

describe('every Python source this repository owns is linted, formatted and type-checked', () => {
    const tracked = trackedFiles();
    const sources = ownPythonSources(tracked);
    const rootScripts =
        (
            JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
                scripts?: Record<string, string>;
            }
        ).scripts ?? {};

    it('is not vacuous — the tree really does hold Python under packages/', () => {
        // A vacuous pass here would make every rule below assert nothing, which is precisely the state
        // this suite exists to end.
        expect(sources.length).toBeGreaterThanOrEqual(2);
    });

    it('leaves the VENDORED Spec Kit extension alone — it arrives with its own toolchain', () => {
        // `.specify/extensions/v-model/` carries 46 Python files, its own pyproject.toml and its own
        // requirements-dev.txt. Re-linting a vendored tree to our house style is churn we would then own.
        expect(tracked.filter((file) => file.startsWith('.specify/') && file.endsWith('.py')).length).toBeGreaterThan(
            0,
        );
        expect(sources.filter((file) => file.startsWith('.specify/'))).toEqual([]);
    });

    it('declares every check at the root, aimed at the whole authored tree', () => {
        expect(findMissingPythonScripts(rootScripts)).toEqual([]);
    });

    it('has CI actually run each verifying check', () => {
        expect(findUnrunPythonScripts(rootScripts, workflowRunBodies(realWorkflowDocuments()))).toEqual([]);
    });

    it('pins the dev toolchain exactly', () => {
        expect(tracked).toContain(DEV_REQUIREMENTS);
        expect(findUnpinnedTools(readFileSync(join(REPO_ROOT, DEV_REQUIREMENTS), 'utf8'))).toEqual([]);
    });

    it('configures both tools in one place, and excludes none of our own sources', () => {
        expect(tracked).toContain(PYTHON_CONFIG);

        const config = readFileSync(join(REPO_ROOT, PYTHON_CONFIG), 'utf8');

        expect(config).toMatch(/^\[tool\.ruff/m);
        expect(config).toMatch(/^\[tool\.mypy]/m);
        expect(findExcludedOwnSources(config, sources)).toEqual([]);
    });
});

describe('the rules themselves detect the absence they exist to detect', () => {
    it('flags a missing check, and one aimed somewhere narrower than the authored tree', () => {
        expect(findMissingPythonScripts({})).toHaveLength(4);
        expect(
            findMissingPythonScripts({
                'lint:python': 'ruff check packages/services/ingredient-parser',
                'format:python': 'ruff format packages',
                'format:check:python': 'ruff format --check packages',
                'typecheck:python': 'mypy packages',
            }),
        ).toEqual(['`lint:python` does not target `packages` — it cannot cover Python added elsewhere']);
    });

    it('flags a declared check that no workflow step invokes, and never demands CI run the WRITER', () => {
        expect(
            findUnrunPythonScripts(
                {
                    'lint:python': 'ruff check packages',
                    'format:python': 'ruff format packages',
                    'format:check:python': 'ruff format --check packages',
                    'typecheck:python': 'mypy packages',
                },
                ['npm run lint:python'],
            ),
        ).toEqual([
            'no CI step runs `format:check:python` — a check no job invokes cannot fail',
            'no CI step runs `typecheck:python` — a check no job invokes cannot fail',
        ]);
    });

    it('flags an unpinned tool, and accepts a pinned one', () => {
        expect(findUnpinnedTools('ruff\n')).toHaveLength(1);
        expect(findUnpinnedTools('ruff>=0.1\n')).toHaveLength(1);
        expect(findUnpinnedTools('# a comment\nruff==0.14.5\n\nmypy==1.19.0\n')).toEqual([]);
    });

    it('flags an exclusion that would drop one of our own sources', () => {
        const sources = ['packages/services/ingredient-parser/src/handler.py'];

        expect(findExcludedOwnSources('[tool.ruff]\nexclude = ["node_modules"]\n', sources)).toEqual([]);
        expect(
            findExcludedOwnSources('[tool.ruff]\nexclude = ["packages/services/ingredient-parser"]\n', sources),
        ).toHaveLength(1);
        expect(
            findExcludedOwnSources(
                '[tool.mypy]\nexclude = [\n  "packages/services/ingredient-parser/src/handler.py",\n]\n',
                sources,
            ),
        ).toHaveLength(1);
    });
});
