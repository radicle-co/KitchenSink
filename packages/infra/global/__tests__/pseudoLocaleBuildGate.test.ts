// @vitest-environment node
/**
 * The `en-XA` pseudo-locale reaches no deployed build (`docs/architecture/uiOverhaulBlueprint.md` Part B,
 * "Pseudo-localisation": "a guard asserts that a production build's `SUPPORTED_LOCALES` is unchanged").
 *
 * The web app routes `en-XA` only in a build made with `COMMISE_PSEUDO_LOCALE=1`, which `next.config.ts` inlines
 * (`packages/apps/commise/web/src/lib/i18n.ts`; its unit tests prove both builds). So the question this guard answers
 * is WHO sets that flag at build time. Exactly one place may: `_ci.yml`'s `build` job, whose web output is "deployed
 * nowhere" and is served only to the stubbed-API Playwright tier (the comment on that step, and
 * `webE2eProductionBuild.test.ts`), where `controlLabels.spec.ts` lays the app out in `en-XA`. Vercel, which builds
 * every preview and production, and every other workflow must never set it.
 *
 * Read as YAML for the one sanctioned place, and as TEXT for everything else, so a `COMMISE_PSEUDO_LOCALE=1 npm run …`
 * inside a `run:` script — invisible to an env-map reader — is caught too.
 */
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
