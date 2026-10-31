// @vitest-environment node
/**
 * The `en-XA` pseudo-locale reaches no deployed build (`docs/architecture/uiOverhaulBlueprint.md` Part B,
 * "Pseudo-localisation": "a guard asserts that a production build's `SUPPORTED_LOCALES` is unchanged").
 *
 * The web app routes `en-XA` only in a build made with `COMMISE_PSEUDO_LOCALE=1`, which `next.config.ts` inlines
 * (`packages/apps/commise/web/src/lib/i18n.ts`; its unit tests prove both builds). So the question this guard answers
 * is WHO sets that flag at build time. Exactly two places may, and both build output that is deployed nowhere: in CI,
 * `_ci.yml`'s `build` job, served only to the stubbed-API Playwright tier (the comment on that step, and
 * `webE2eProductionBuild.test.ts`), where `controlLabels.spec.ts` lays the app out in `en-XA`; on a developer's
 * machine, the build command of the local Playwright lane (`scripts/e2eLocal.sh`), for the same spec. Vercel, which
 * builds every preview and production, and every other workflow must never set it.
 *
 * Read as YAML for the one sanctioned place, and as TEXT for everything else, so a `COMMISE_PSEUDO_LOCALE=1 npm run …`
 * inside a `run:` script — invisible to an env-map reader — is caught too.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const FLAG = 'COMMISE_PSEUDO_LOCALE';

interface Step {
    readonly name?: string;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly env?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly Step[];
}

interface Workflow {
    readonly env?: Readonly<Record<string, unknown>>;
    readonly jobs?: Readonly<Record<string, Job>>;
}

/** Every place a workflow's env maps name the flag, as `file::job::step` (`file` for workflow env, `file::job`). */
function envSites(file: string, workflow: Workflow): readonly string[] {
    const sites: string[] = [];

    if (workflow.env !== undefined && FLAG in workflow.env) {
        sites.push(file);
    }

    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
        if (job.env !== undefined && FLAG in job.env) {
            sites.push(`${file}::${jobId}`);
        }

        for (const step of job.steps ?? []) {
            if (step.env !== undefined && FLAG in step.env) {
                sites.push(`${file}::${jobId}::${step.name ?? '(unnamed)'}`);
            }
        }
    }

    return sites;
}

/** The number of times a text names the flag. */
const mentions = (text: string): number => text.split(FLAG).length - 1;

const workflowFiles = (): readonly string[] => globSync('.github/**/*.{yml,yaml}', { cwd: repoRoot, dot: true }).sort();

const read = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');

describe('the pseudo-locale build flag', () => {
    it('is set by exactly one workflow env map: the build job’s Build step, whose web output is deployed nowhere', () => {
        const sites = workflowFiles().flatMap((file) => envSites(path.basename(file), parse(read(file)) as Workflow));

        expect(sites).toEqual(['_ci.yml::build::Build']);
    });

    it('is set to exactly "1" there, the only value the web build reads as on', () => {
        const ci = parse(read('.github/workflows/_ci.yml')) as Workflow;
        const build = ci.jobs?.['build']?.steps?.find((step) => step.name === 'Build');

        expect(build?.env?.[FLAG]).toBe('1');
    });

    it('is mentioned by no workflow or action outside that env map — no `FLAG=1 npm run …` in a script', () => {
        const total = workflowFiles().reduce((sum, file) => sum + mentions(read(file)), 0);

        // One key in the env map; the comments on that step name it in prose, so count only non-comment lines.
        const outsideComments = workflowFiles().reduce(
            (sum, file) =>
                sum +
                read(file)
                    .split('\n')
                    .filter((line) => !line.trimStart().startsWith('#'))
                    .reduce((lineSum, line) => lineSum + mentions(line), 0),
            0,
        );

        expect(total).toBeGreaterThanOrEqual(1);
        expect(outsideComments).toBe(1);
    });

    it('is set by no Vercel configuration, so no preview or production build routes en-XA', () => {
        const vercelConfigs = globSync('**/vercel.json', { cwd: repoRoot, ignore: ['**/node_modules/**'] });

        expect(vercelConfigs.length).toBeGreaterThan(0);

        for (const file of vercelConfigs) {
            expect(mentions(read(file)), file).toBe(0);
        }
    });

    it('is inlined by next.config.ts as "1" only for exactly "1", and as an empty string otherwise', () => {
        const config = read('packages/apps/commise/web/next.config.ts');

        expect(config).toContain(`${FLAG}: process.env['${FLAG}'] === '1' ? '1' : '',`);
    });
});

/**
 * The developer's lane builds through TURBO, not `npm run build`, and turbo runs in strict env mode: a variable no task
 * declares never reaches the task. The flag was declared nowhere, so `scripts/e2eLocal.sh` built a bundle with no
 * `en-XA` and `controlLabels.spec.ts` failed on every test, while CI (which builds with `npm run build`) passed.
 *
 * It is declared as hashed `env`, never `passThroughEnv`: the flag changes the bundle, so a pass-through would let a
 * pseudo build and a plain build share one cache key, and the next run would restore the wrong one.
 */
describe('the pseudo-locale flag in the local Playwright lane', () => {
    const LANE = 'packages/apps/commise/web/scripts/e2eLocal.sh';

    /** Turbo's resolved plan for the web build, made with the flag set the way the lane sets it. */
    function webBuildPlan(): {
        readonly environmentVariables: { readonly configured: readonly string[]; readonly inferred: readonly string[] };
        readonly resolvedTaskDefinition: { readonly dependsOn: readonly string[]; readonly outputs: readonly string[] };
    } {
        const stdout = execFileSync(
            path.join(repoRoot, 'node_modules/.bin/turbo'),
            ['run', 'build', '--filter=@commise/web', '--dry=json'],
            {
                cwd: repoRoot,
                encoding: 'utf8',
                env: { ...process.env, [FLAG]: '1', NEXT_PUBLIC_RECIPE_API_URL: 'http://localhost:3010' },
                maxBuffer: 64 * 1024 * 1024,
            },
        );
        const plan = JSON.parse(stdout) as {
            tasks: (ReturnType<typeof webBuildPlan> & { readonly taskId: string })[];
        };
        const task = plan.tasks.find((candidate) => candidate.taskId === '@commise/web#build');

        if (task === undefined) {
            throw new Error('turbo planned no @commise/web#build');
        }

        return task;
    }

    it('reaches the web build through turbo, and is part of its cache key', () => {
        const plan = webBuildPlan();

        expect(plan.environmentVariables.configured.some((entry) => entry.startsWith(`${FLAG}=`))).toBe(true);
    });

    it('keeps turbo’s Next.js inference, which hashes the NEXT_PUBLIC_* API origins the lane bakes', () => {
        // The lane bakes the run's own port into those origins, so this hash is what rebuilds the bundle when the
        // free port changes; without it a run on one port would serve a bundle baked for another. Vercel builds through
        // the same task (`vercel.json`), so this is the production build's hash too.
        const { inferred } = webBuildPlan().environmentVariables;

        expect(inferred.some((entry) => entry.startsWith('NEXT_PUBLIC_RECIPE_API_URL='))).toBe(true);
    });

    it('keeps the web build’s own dependency edge and outputs (a package task REPLACES the base task)', () => {
        const { dependsOn, outputs } = webBuildPlan().resolvedTaskDefinition;

        expect(dependsOn).toContain('^build');
        expect([...outputs].sort()).toEqual(['!.next/cache/**', '.next/**', 'dist/**']);
    });

    it('is set by the lane on its build command alone, never exported to the rest of the run', () => {
        const lines = read(LANE)
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('#') && mentions(line) > 0);

        expect(lines.map((line) => line.trim())).toEqual([`${FLAG}=1 npx turbo run build --filter=@commise/web`]);
    });
});
