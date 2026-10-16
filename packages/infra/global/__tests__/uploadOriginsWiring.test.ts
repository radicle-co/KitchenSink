// @vitest-environment node
/**
 * Repo-wide guard: every workflow that synthesizes the global app has the Clerk `azp` selectors in its environment
 * BEFORE it does (ADR-0064).
 *
 * `packages/infra/global/bin/app.ts` derives the media bucket's CORS origins from `CLERK_AUTHORIZED_PARTIES` (prod) or
 * `CLERK_AZP_PATTERN` + `CLERK_AZP_PREVIEW_MODE` (every other stage) and THROWS when neither is set. A deployer that
 * never exports them does not deploy a bucket with the wrong CORS - it fails every synth, which is the loud direction -
 * but a deployer that exports them AFTER its first synth fails too, so this asserts the ORDER, not only the presence.
 *
 * ## Derived, never enumerated
 *
 * A deployer is a workflow with a step that runs `cdk deploy|synth` on `infra/global/bin/app.ts` or uses the
 * `infra-package` action on `packages/infra/global`, exactly as `costAlertEmailWiring.test.ts` reads it. Both come from
 * disk, so a deployer added tomorrow is held to the rule the day it lands.
 *
 * | Invariant                                                                     | Test                              |
 * | ----------------------------------------------------------------------------- | --------------------------------- |
 * | the walk finds the known deployers                                            | 'finds the known deployers'       |
 * | each exports the selectors before its first global synth                      | 'exports ... before'              |
 * | turbo's synth task names all three, so they are neither stripped nor uncached | 'turbo keeps ...'                 |
 * | the export script reads the same parameters the services read                 | 'exportClerkAzp.sh reads ...'     |
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { repoRoot } from './serviceSources.js';

const SELECTORS = ['CLERK_AUTHORIZED_PARTIES', 'CLERK_AZP_PATTERN', 'CLERK_AZP_PREVIEW_MODE'] as const;
const GLOBAL_APP = /infra\/global\/bin\/app\.ts/u;
const GLOBAL_DIRECTORY = 'packages/infra/global';

interface WorkflowStep {
    readonly uses?: string;
    readonly run?: string;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface Workflow {
    readonly jobs?: Readonly<Record<string, { readonly steps?: readonly WorkflowStep[] }>>;
}

const WORKFLOWS = path.join(repoRoot, '.github/workflows');

const load = (file: string): Workflow => parseYaml(readFileSync(path.join(WORKFLOWS, file), 'utf8')) as Workflow;

/** Whether a step synthesizes or deploys the global app.  */
function synthesizesGlobalApp(step: WorkflowStep): boolean {
    // A shell comment inside a `run` is still part of the scalar, so strip them: a step that merely MENTIONS
    // `cdk deploy` in prose (prod's flags step does) is not a synth.
    const run = (step.run ?? '').replace(/^\s*#.*$/gmu, '');

    if (/cdk (deploy|synth|ls)/u.test(run) && GLOBAL_APP.test(run)) {
        return true;
    }

    return (step.uses ?? '').endsWith('/actions/infra-package') && step.with?.['directory'] === GLOBAL_DIRECTORY;
}

/** Whether a step puts the selectors in the environment: the shared script, or prod's own safeEnv export. */
function exportsSelectors(step: WorkflowStep): boolean {
    const run = step.run ?? '';

    return run.includes('exportClerkAzp.sh') || /safeEnv\.sh CLERK_AUTHORIZED_PARTIES/u.test(run);
}

const deployers = readdirSync(WORKFLOWS)
    .filter((file) => /\.ya?ml$/u.test(file))
    .filter((file) => Object.values(load(file).jobs ?? {}).some((job) => (job.steps ?? []).some(synthesizesGlobalApp)))
    .toSorted();

describe('every workflow that synthesizes the global app exports the Clerk azp selectors first', () => {
    it('finds the known deployers (a vacuous pass here would hide every rule below)', () => {
        expect(deployers).toEqual(
            expect.arrayContaining(['deployInfra.yml', 'prod-deploy.yml', 'sandbox-identity-deploy.yml']),
        );
    });

    it.each(deployers)('%s exports the selectors in the same job, before its first global synth', (file) => {
        for (const [jobName, job] of Object.entries(load(file).jobs ?? {})) {
            const steps = job.steps ?? [];
            const firstSynth = steps.findIndex(synthesizesGlobalApp);

            if (firstSynth === -1) {
                continue;
            }

            const exported = steps.findIndex(exportsSelectors);

            expect(exported, `${file} job ${jobName}: no step exports the selectors`).toBeGreaterThanOrEqual(0);
            expect(exported, `${file} job ${jobName}: the export comes AFTER the first global synth`).toBeLessThan(
                firstSynth,
            );
        }
    });

    it('turbo keeps all three for the synth task, so they are neither stripped nor missing from the cache key', () => {
        const source = readFileSync(path.join(repoRoot, 'turbo.json'), 'utf8').replace(/^\s*\/\/.*$/gmu, '');
        const turbo = JSON.parse(source) as { tasks: Record<string, { env?: readonly string[] }> };

        for (const variable of SELECTORS) {
            expect(turbo.tasks['synth']?.env, variable).toContain(variable);
        }
    });

    it('exportClerkAzp.sh reads the parameters the services read, through safeEnv.sh', () => {
        const script = readFileSync(path.join(repoRoot, '.github/scripts/exportClerkAzp.sh'), 'utf8');

        expect(script).toContain('/kitchensink/prod/clerk/authorized-parties');
        expect(script).toContain('/kitchensink/sandbox/clerk/azp-pattern');
        expect(script).toContain('/kitchensink/sandbox/clerk/azp-preview-mode');
        expect(script).not.toMatch(/>>\s*"?\$\{?GITHUB_ENV/u);
        expect(script).toContain('safeEnv.sh');
    });
});
