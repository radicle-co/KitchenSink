/**
 * Every CI job that installs the CRF engine, runs Python against it, or builds its Lambda asset runs on the
 * LAMBDA'S interpreter, set up from `packages/services/ingredient-parser/pythonVersion.txt`.
 *
 * Without this, those jobs ran on whatever `python3` the `ubuntu-latest` image ships. When the label moved from
 * 24.04 (3.12) to 26.04 (3.14), `pip install -r requirements.txt` stopped resolving `ingredient-parser-nlp==2.3.0`
 * (`Requires-Python: <3.14`) and two jobs went red with no change of ours. A later image would just as silently
 * change which interpreter the asset build reads `sys.stdlib_module_names` from — a 3.14 host counts a module new in
 * 3.14 as stdlib, so the build passes and the 3.13 Lambda fails at import (ADR-0025).
 *
 * The version lives in ONE file, held equal to `PYTHON_LAMBDA_RUNTIME` by the parser's own `packaging.test.ts`;
 * this guard holds every job that needs it to that file and forbids a literal `python-version` anywhere.
 *
 * Not covered on purpose: `zizmor.yml` pip-installs its own scanner (not the engine) and a few jobs use `python3 -c`
 * to read JSON. Neither cares which Python it gets.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const PYTHON_VERSION_FILE = 'packages/services/ingredient-parser/pythonVersion.txt';
const PARSER_DIR = 'packages/services/ingredient-parser';
const SETUP_PYTHON = /^actions\/setup-python@[0-9a-f]{40}$/u;

interface Step {
    readonly name?: string;
    readonly if?: string;
    readonly uses?: string;
    readonly run?: string;
    readonly 'working-directory'?: string;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface WorkflowDocument {
    readonly jobs?: Readonly<Record<string, { readonly steps?: readonly Step[] }>>;
}

/** A step that needs the pinned interpreter: it pip-installs a requirements file, or builds or tests the asset. */
export function needsPinnedPython(step: Step): boolean {
    const run = step.run ?? '';
    const directory = step['working-directory'] ?? '';
    const packageDirectory = step.with?.['directory'];

    return (
        /\bpip install\b[^\n]*--requirement\b/u.test(run) ||
        (/\bbundle:lambda\b/u.test(run) && `${run} ${directory}`.includes(PARSER_DIR)) ||
        (step.uses === './.github/actions/infra-package' &&
            typeof packageDirectory === 'string' &&
            packageDirectory.startsWith(PARSER_DIR)) ||
        (directory.startsWith(`${PARSER_DIR}/infra`) && /\btest:integration\b/u.test(run))
    );
}

function isSetupPython(step: Step): boolean {
    return (step.uses ?? '').startsWith('actions/setup-python@');
}

/** Violations in one workflow: a step needing the pinned Python with no pinned setup before it, or a literal version. */
export function findUnpinnedPythonSteps(file: string, doc: WorkflowDocument): readonly string[] {
    return Object.entries(doc.jobs ?? {}).flatMap(([jobId, job]) => {
        const steps = job.steps ?? [];
        const where = (step: Step): string => `${file}::${jobId}::${step.name ?? step.uses ?? step.run ?? '?'}`;

        const literal = steps
            .filter((step) => isSetupPython(step))
            .flatMap((step) => {
                const problems: string[] = [];

                if (!SETUP_PYTHON.test(step.uses ?? '')) {
                    problems.push(`${where(step)} → setup-python is not pinned to a commit SHA`);
                }

                if (step.with?.['python-version'] !== undefined) {
                    problems.push(`${where(step)} → states a literal python-version instead of ${PYTHON_VERSION_FILE}`);
                }

                if (step.with?.['python-version-file'] !== PYTHON_VERSION_FILE) {
                    problems.push(`${where(step)} → python-version-file is not ${PYTHON_VERSION_FILE}`);
                }

                return problems;
            });

        // A setup gated on a DIFFERENT condition may not have run when the needing step does, so it must be
        // unconditional or carry the same `if:`.
        const prepares = (earlier: Step, step: Step): boolean =>
            isSetupPython(earlier) && (earlier.if === undefined || earlier.if === step.if);
        const unprepared = steps.flatMap((step, index) =>
            needsPinnedPython(step) && !steps.slice(0, index).some((earlier) => prepares(earlier, step))
                ? [`${where(step)} → runs before any setup-python in its job`]
                : [],
        );

        return [...literal, ...unprepared];
    });
}

function realWorkflows(): readonly (readonly [string, WorkflowDocument])[] {
    return execFileSync('git', ['ls-files', '.github/workflows'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .map((file) => [file, parse(readFileSync(join(REPO_ROOT, file), 'utf8')) as WorkflowDocument] as const);
}

describe('every job that runs the CRF engine’s Python runs the Lambda’s interpreter', () => {
    const workflows = realWorkflows();

    it('is not vacuous — the five known jobs are found by the predicate', () => {
        const jobs = workflows.flatMap(([file, doc]) =>
            Object.entries(doc.jobs ?? {})
                .filter(([, job]) => (job.steps ?? []).some((step) => needsPinnedPython(step)))
                .map(([jobId]) => `${file}::${jobId}`),
        );

        expect(jobs).toEqual(
            expect.arrayContaining([
                '.github/workflows/_ci.yml::python-checks',
                '.github/workflows/_ci.yml::test',
                '.github/workflows/_ci.yml::integration-selfcontained',
                '.github/workflows/deployInfra.yml::ingredient-parser',
                '.github/workflows/prod-deploy.yml::deploy',
            ]),
        );
    });

    it('sets up Python from the one version file before each such step, and nowhere states a literal version', () => {
        expect(readFileSync(join(REPO_ROOT, PYTHON_VERSION_FILE), 'utf8')).toMatch(/^\d+\.\d+$/mu);
        expect(workflows.flatMap(([file, doc]) => findUnpinnedPythonSteps(file, doc))).toEqual([]);
    });
});

describe('the rule detects the absence it exists to detect', () => {
    const setup: Step = {
        uses: 'actions/setup-python@6d4fd22b20465ccc0f7354476588e8df7c9ca0e0',
        with: { 'python-version-file': PYTHON_VERSION_FILE },
    };
    const install: Step = {
        name: 'install',
        run: 'python3 -m pip install --user --requirement packages/services/ingredient-parser/requirements.txt',
    };

    it('flags an engine install with no setup-python before it, and passes one with', () => {
        expect(findUnpinnedPythonSteps('w.yml', { jobs: { j: { steps: [install] } } })).toEqual([
            'w.yml::j::install → runs before any setup-python in its job',
        ]);
        expect(findUnpinnedPythonSteps('w.yml', { jobs: { j: { steps: [install, setup] } } })).toHaveLength(1);
        expect(findUnpinnedPythonSteps('w.yml', { jobs: { j: { steps: [setup, install] } } })).toEqual([]);
    });

    it('flags a setup gated on another condition than the step it must prepare, and passes the same gate', () => {
        const gated = { ...install, if: "matrix.group == 'services'" };

        expect(
            findUnpinnedPythonSteps('w.yml', {
                jobs: { j: { steps: [{ ...setup, if: "matrix.group == 'web'" }, gated] } },
            }),
        ).toHaveLength(1);
        expect(
            findUnpinnedPythonSteps('w.yml', { jobs: { j: { steps: [{ ...setup, if: gated.if }, gated] } } }),
        ).toEqual([]);
    });

    it('flags a literal version, a tag pin and another version file', () => {
        expect(
            findUnpinnedPythonSteps('w.yml', {
                jobs: { j: { steps: [{ ...setup, with: { 'python-version': '3.13' } }, install] } },
            }),
        ).toHaveLength(2);
        expect(
            findUnpinnedPythonSteps('w.yml', {
                jobs: { j: { steps: [{ ...setup, uses: 'actions/setup-python@v7' }] } },
            }),
        ).toHaveLength(1);
        expect(
            findUnpinnedPythonSteps('w.yml', {
                jobs: { j: { steps: [{ ...setup, with: { 'python-version-file': '.python-version' } }] } },
            }),
        ).toHaveLength(1);
    });

    it('treats the asset build and its tiers as needing the pinned Python, and an unrelated pip install as not', () => {
        expect(
            needsPinnedPython({ run: 'npm run bundle:lambda --workspace=packages/services/ingredient-parser' }),
        ).toBe(true);
        expect(needsPinnedPython({ run: 'npm run bundle:lambda --workspace=packages/services/identity' })).toBe(false);
        expect(
            needsPinnedPython({
                uses: './.github/actions/infra-package',
                with: { directory: 'packages/services/ingredient-parser/infra' },
            }),
        ).toBe(true);
        expect(
            needsPinnedPython({
                uses: './.github/actions/infra-package',
                with: { directory: 'packages/services/food-service/infra' },
            }),
        ).toBe(false);
        expect(needsPinnedPython({ 'working-directory': `${PARSER_DIR}/infra`, run: 'npm run test:integration' })).toBe(
            true,
        );
        expect(needsPinnedPython({ run: "python3 -m pip install --disable-pip-version-check 'zizmor==1.29.0'" })).toBe(
            false,
        );
    });
});
