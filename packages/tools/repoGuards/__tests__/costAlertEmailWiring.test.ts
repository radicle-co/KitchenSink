// @vitest-environment node
/**
 * Repo-wide guard: every workflow that deploys the global infra app passes the owner's alert address to it.
 *
 * `packages/infra/global/bin/app.ts` reads `process.env['COST_ALERT_EMAIL']` at synth to subscribe an address to the
 * alarm topics (the alarm relay's email fallback, and the cost topics). Only `accountDeploy.yml` ever passed it, so
 * the per-stage app synthesized with no address and the fallback never deployed — behind green deploys, because an
 * absent address is a legal input. The owner now keeps the address in the repository variable `COST_ALERT_EMAIL`.
 *
 * ## Derived, never enumerated
 *
 * A workflow deploys the global app when one of its steps runs `cdk deploy` on `infra/global/bin/app.ts`, or uses the
 * `infra-package` action on `packages/infra/global`. Both are read from disk, so a deployer added tomorrow is held to
 * the rule the day it lands. The variable is workflow-level `env:` (beside `DOMAIN_NAME`) so every step of the job,
 * `cdk synth`, `cdk deploy` and the verification that re-synthesizes included, sees the same value.
 *
 * `turbo.json`'s `synth` task also names it: turbo strips undeclared variables and keys its cache on declared ones.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { repoRoot } from './serviceSources.js';

const VARIABLE = 'COST_ALERT_EMAIL';
const GLOBAL_APP = /infra\/global\/bin\/app\.ts/u;
const GLOBAL_DIRECTORY = 'packages/infra/global';

interface WorkflowStep {
    readonly uses?: string;
    readonly run?: string;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface Workflow {
    readonly env?: Readonly<Record<string, unknown>>;
    readonly jobs?: Readonly<Record<string, { readonly steps?: readonly WorkflowStep[] }>>;
}

const WORKFLOWS = path.join(repoRoot, '.github/workflows');

const load = (file: string): Workflow => parseYaml(readFileSync(path.join(WORKFLOWS, file), 'utf8')) as Workflow;

/** Whether a step synthesizes or deploys the global app. Comments are not in the parsed `run`, so prose cannot count. */
function deploysGlobalApp(step: WorkflowStep): boolean {
    const run = step.run ?? '';

    if (/cdk (deploy|synth)/u.test(run) && GLOBAL_APP.test(run)) {
        return true;
    }

    return (step.uses ?? '').endsWith('/actions/infra-package') && step.with?.['directory'] === GLOBAL_DIRECTORY;
}

const deployers = readdirSync(WORKFLOWS)
    .filter((file) => /\.ya?ml$/u.test(file))
    .filter((file) => Object.values(load(file).jobs ?? {}).some((job) => (job.steps ?? []).some(deploysGlobalApp)))
    .toSorted();

describe('every workflow that deploys the global app passes COST_ALERT_EMAIL', () => {
    it('finds the known deployers (a vacuous pass here would hide every rule below)', () => {
        expect(deployers).toEqual(
            expect.arrayContaining(['deployInfra.yml', 'prod-deploy.yml', 'sandbox-identity-deploy.yml']),
        );
    });

    it.each(deployers)('%s sets it from the repository variable', (file) => {
        expect(load(file).env?.[VARIABLE]).toBe(`\${{ vars.${VARIABLE} }}`);
    });

    it('turbo keeps it for the synth task, so it is neither stripped nor missing from the cache key', () => {
        const source = readFileSync(path.join(repoRoot, 'turbo.json'), 'utf8').replace(/^\s*\/\/.*$/gmu, '');
        const turbo = JSON.parse(source) as { tasks: Record<string, { env?: readonly string[] }> };

        expect(turbo.tasks['synth']?.env).toContain(VARIABLE);
    });
});
