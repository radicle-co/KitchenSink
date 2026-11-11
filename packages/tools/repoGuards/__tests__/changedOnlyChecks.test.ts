// @vitest-environment node
/**
 * Repo-wide guard for ADR-0091: on a pull request the fast tiers (unit and integration tests, lint, typecheck, format)
 * run only on what the change affects, and anything the selector cannot attribute runs them all.
 *
 * What it proves, by reading the workflow and by running the real `selectChecks.sh`:
 * 1. `select-checks` needs nothing, reads the whole history, and its decision widens to everything for any event that
 *    is not a pull request, for a change outside every package, and for a change too large to pass along.
 * 2. Every job that runs a fast tier reads the change from `select-checks`, and every step that runs one goes through
 *    the selector (`npm run -s scope …` or a root script that does); no step runs `turbo run` on a fast tier bare.
 * 3. Every `npm run test:integration --workspace=X` step is gated on X being in that job's selection, so a new step
 *    cannot run unscoped forever, and the gate names the same package the step runs.
 * 4. The Python checks run only when the decision says Python is affected, and say so when they do not.
 * 5. The root scripts a developer types go through the selector too.
 *
 * What it does not prove: that the selector picks the right packages (that is `@kitchensink/e2e-plan`'s
 * `checkScope` suites, which run against turbo's real graph).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import yaml from 'yaml';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const SCRIPT = `${REPO_ROOT}.github/scripts/selectChecks.sh`;

interface Step {
    readonly name?: string;
    readonly id?: string;
    readonly if?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly with?: Record<string, unknown>;
}

interface Job {
    readonly needs?: string | readonly string[];
    readonly env?: Record<string, string>;
    readonly steps?: readonly Step[];
    readonly outputs?: Record<string, string>;
}

const CI = yaml.parse(readFileSync(`${REPO_ROOT}.github/workflows/_ci.yml`, 'utf8')) as { jobs: Record<string, Job> };
const ROOT_SCRIPTS = (
    JSON.parse(readFileSync(`${REPO_ROOT}package.json`, 'utf8')) as { scripts: Record<string, string> }
).scripts;

const needsOf = (job: Job): readonly string[] =>
    job.needs === undefined ? [] : typeof job.needs === 'string' ? [job.needs] : job.needs;

/** The fast tiers, as turbo tasks. `build` and `test:e2e` are not fast tiers. */
const BARE_FAST_TIER = /turbo run (?:[\w:-]+ )*(?:test|test:integration|lint|typecheck|format:check)(?:\s|$)/u;
const SCOPED = /npm run -s scope -- (?:run|list|files) /u;

const decide = (event: string, files: readonly string[]) => {
    const result = spawnSync('bash', [SCRIPT, 'decide'], {
        input: files.join('\n'),
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', EVENT_NAME: event },
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    return Object.fromEntries(
        result.stdout
            .trim()
            .split('\n')
            .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    ) as Record<'full' | 'files' | 'python', string>;
};

describe('selectChecks.sh decide', () => {
    it('passes a pull request change through as a JSON list and leaves Python out when no Python changed', () => {
        expect(decide('pull_request', ['packages/apps/commise/query/src/a.ts', 'docs/x.md'])).toEqual({
            full: '',
            files: '["packages/apps/commise/query/src/a.ts","docs/x.md"]',
            python: 'false',
        });
    });

    it.each(['push', 'workflow_dispatch', 'merge_group'])(
        'runs everything on %s, so main is always fully verified',
        (event) => {
            const decision = decide(event, ['packages/apps/commise/query/src/a.ts']);

            expect(decision.full).toMatch(new RegExp(event, 'u'));
            expect(decision.python).toBe('true');
        },
    );

    it.each([
        'packages/services/ingredient-parser/src/handler.py',
        'packages/services/ingredient-parser/stubs/x.pyi',
        'pyproject.toml',
        'requirementsDev.txt',
        'packages/services/ingredient-parser/pythonVersion.txt',
        '.github/workflows/_ci.yml',
        'package-lock.json',
    ])('runs the Python checks when %s changes', (file) => {
        expect(decide('pull_request', [file]).python).toBe('true');
    });

    it('runs everything for a change too large to pass along', () => {
        const many = Array.from({ length: 3001 }, (_, i) => `packages/apps/commise/web/src/f${i}.ts`);
        const decision = decide('pull_request', many);

        expect(decision.full).toMatch(/3001 files/u);
        expect(decision.files).toBe('[]');
    });

    it('keeps a path with spaces whole', () => {
        expect(decide('pull_request', ['docs/a b.md']).files).toBe('["docs/a b.md"]');
    });
});

describe('select-checks', () => {
    const job = CI.jobs['select-checks'];

    it('needs nothing, so it is ready before the install finishes', () => {
        expect(job).toBeDefined();
        expect(needsOf(job as Job)).toEqual([]);
    });

    it('reads the whole history, which the merge base needs', () => {
        const checkout = (job?.steps ?? []).find((step) => step.uses?.startsWith('actions/checkout@'));

        expect(checkout?.with?.['fetch-depth']).toBe(0);
    });

    it('publishes the decision from the script and nowhere else', () => {
        expect(Object.keys(job?.outputs ?? {}).sort()).toEqual(['files', 'full', 'python']);
        expect((job?.steps ?? []).map((step) => step.run ?? '').join('\n')).toContain(
            'bash .github/scripts/selectChecks.sh',
        );
    });
});

const allSteps = Object.entries(CI.jobs).flatMap(([name, job]) =>
    (job.steps ?? []).map((step) => ({ job: name, step })),
);

describe('the fast tiers in _ci.yml', () => {
    it('never run turbo on a fast tier bare', () => {
        const bare = allSteps.filter(({ step }) => BARE_FAST_TIER.test(step.run ?? ''));

        expect(bare.map(({ job, step }) => `${job}: ${step.name ?? step.run}`)).toEqual([]);
    });

    const scopedJobs = Object.entries(CI.jobs).filter(([, job]) =>
        (job.steps ?? []).some(
            (step) => SCOPED.test(step.run ?? '') || /npm run (?:-s )?format:check:docs/u.test(step.run ?? ''),
        ),
    );

    it('run through the selector in each job that runs one', () => {
        expect(scopedJobs.map(([name]) => name).sort()).toEqual(
            expect.arrayContaining(['format', 'lint', 'test', 'typecheck', 'integration-selfcontained']),
        );
    });

    it.each(scopedJobs.map(([name, job]) => [name, job] as const))(
        '%s reads the change from select-checks',
        (_name, job) => {
            expect(needsOf(job)).toContain('select-checks');
            expect(job.env?.['CHECK_SCOPE_FULL']).toBe('${{ needs.select-checks.outputs.full }}');
            expect(job.env?.['CHECK_SCOPE_FILES']).toBe('${{ needs.select-checks.outputs.files }}');
        },
    );
});

const workspaceName = (spec: string): string =>
    spec.startsWith('packages/')
        ? (JSON.parse(readFileSync(`${REPO_ROOT}${spec}/package.json`, 'utf8')) as { name: string }).name
        : spec;

describe('integration steps', () => {
    const integration = allSteps.flatMap(({ job, step }) => {
        const match = /npm run test:integration --workspace=(\S+)/u.exec(step.run ?? '');

        return match?.[1] === undefined ? [] : [{ job, step, pkg: workspaceName(match[1]) }];
    });

    it('exist (the guard is reading the right file)', () => {
        expect(integration.length).toBeGreaterThan(10);
    });

    it.each(integration.map(({ job, step, pkg }) => [`${job} → ${pkg}`, step, pkg, job] as const))(
        '%s runs only when its package is selected',
        (_label, step, pkg, job) => {
            expect(step.if).toBe(`\${{ contains(fromJSON(steps.scope.outputs.packages), '${pkg}') }}`);

            const scope = (CI.jobs[job]?.steps ?? []).find((candidate) => candidate.id === 'scope');

            expect(scope?.run).toBe('npm run -s scope -- list test:integration');
        },
    );
});

describe('python-checks', () => {
    const job = CI.jobs['python-checks'];

    it('runs its tools only when the decision says Python is affected', () => {
        expect(needsOf(job as Job)).toContain('select-checks');

        const tools = (job?.steps ?? []).filter((step) => /python|pip/u.test(`${step.run ?? ''} ${step.uses ?? ''}`));

        expect(tools.length).toBeGreaterThanOrEqual(4);
        tools.forEach((step) => expect(step.if).toBe("needs.select-checks.outputs.python == 'true'"));
    });

    it('says why when it does not run them', () => {
        const notice = (job?.steps ?? []).find((step) => step.if === "needs.select-checks.outputs.python != 'true'");

        expect(notice?.run).toMatch(/::notice::/u);
    });
});

describe('root scripts', () => {
    it.each(['test', 'lint', 'typecheck', 'format', 'format:check', 'format:docs', 'format:check:docs'])(
        '%s goes through the selector',
        (script) => {
            expect(ROOT_SCRIPTS[script]).toMatch(/^npm run -s scope -- /u);
        },
    );
});
