// @vitest-environment node
/**
 * Repo-wide guard: every workflow job that DEPLOYS the identity CDK app resolves the paid-features gate first
 * (plan `docs/plans/2026-10-14-009-feat-roles-and-paid-gate-plan.md` D9).
 *
 * Identity's app reads `process.env['PAID_FEATURES_GATE'] === 'true'` at synth. A deploy path that skips
 * `.github/scripts/resolvePaidFeaturesGate.sh` therefore deploys `false` and silently undoes the owner's flip on that
 * stage. The failure is safe in direction (no upsell shown; no entitled user loses anything) but it is still the owner's
 * decision reverted by a pipeline, so every path is held to it.
 *
 * ## Derived, never enumerated
 *
 * A job deploys the identity app when one of its steps runs `cdk deploy` naming `packages/services/identity/infra/bin/
 * app.ts`, or uses the `infra-package` action on `packages/services/identity/infra` without `schema-only` (a schema-only
 * deploy publishes the schema stack, which carries no task definition). Both workflow files and the variables they
 * pass are read from disk.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { repoRoot } from './serviceSources.js';

const RESOLVE_SCRIPT = '.github/scripts/resolvePaidFeaturesGate.sh';
const IDENTITY_APP = 'packages/services/identity/infra/bin/app.ts';
const IDENTITY_INFRA_DIR = 'packages/services/identity/infra';
const VARIABLES = ['PAID_FEATURES_GATE_SANDBOX', 'PAID_FEATURES_GATE_PROD'] as const;

/** A workflow step, as far as this guard reads it. */
interface WorkflowStep {
    readonly uses?: string;
    readonly run?: string;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly env?: Readonly<Record<string, unknown>>;
}

/** Whether a step deploys the identity app's service stack. Pure. */
function deploysIdentity(step: WorkflowStep): boolean {
    const run = step.run ?? '';

    if (run.includes('cdk deploy') && run.includes(IDENTITY_APP)) {
        return true;
    }

    return (
        (step.uses ?? '').endsWith('/actions/infra-package') &&
        step.with?.['directory'] === IDENTITY_INFRA_DIR &&
        step.with['schema-only'] !== 'true'
    );
}

/** Whether a step resolves the gate, passing both owner variables through `env:`. Pure. */
function resolvesGate(step: WorkflowStep): boolean {
    return (
        (step.run ?? '').includes(RESOLVE_SCRIPT) &&
        VARIABLES.every((name) => step.env?.[name] === `\${{ vars.${name} }}`)
    );
}

/**
 * The deploy steps in one job that run before the gate is resolved. Pure.
 *
 * @param steps - The job's steps, in order.
 * @returns The offending steps' first lines, or the action's directory.
 */
function deploysBeforeTheGate(steps: readonly WorkflowStep[]): readonly string[] {
    const offending: string[] = [];
    let resolved = false;

    for (const step of steps) {
        if (resolvesGate(step)) {
            resolved = true;
        }

        if (!resolved && deploysIdentity(step)) {
            offending.push((step.run ?? `uses ${step.uses ?? ''}`).trim().split('\n')[0] ?? '');
        }
    }

    return offending;
}

/** Every job in every workflow, with its steps. */
function jobs(): readonly { readonly label: string; readonly steps: readonly WorkflowStep[] }[] {
    const workflowDir = path.join(repoRoot, '.github/workflows');

    return readdirSync(workflowDir)
        .filter((name) => name.endsWith('.yml'))
        .flatMap((file) => {
            const doc = parseYaml(readFileSync(path.join(workflowDir, file), 'utf8')) as {
                jobs?: Record<string, { steps?: WorkflowStep[] }>;
            };

            return Object.entries(doc.jobs ?? {}).map(([job, { steps }]) => ({
                label: `${file} ${job}`,
                steps: steps ?? [],
            }));
        });
}

const RESOLVER_STEP: WorkflowStep = {
    run: `bash ${RESOLVE_SCRIPT} "\${STAGE}"`,
    env: {
        PAID_FEATURES_GATE_SANDBOX: '${{ vars.PAID_FEATURES_GATE_SANDBOX }}',
        PAID_FEATURES_GATE_PROD: '${{ vars.PAID_FEATURES_GATE_PROD }}',
    },
};

describe('the paid-features gate is resolved before identity deploys', () => {
    it.each([
        ['a cdk deploy with no resolution', [{ run: `cdk deploy --app "tsx ${IDENTITY_APP}" --all` }], 1],
        ['a cdk deploy after the resolver', [RESOLVER_STEP, { run: `cdk deploy --app "tsx ${IDENTITY_APP}"` }], 0],
        [
            'a resolver that inlines nothing from vars (no env passed)',
            [{ run: `bash ${RESOLVE_SCRIPT} prod` }, { run: `cdk deploy ${IDENTITY_APP}` }],
            1,
        ],
        [
            'the action on the identity dir with no resolution',
            [{ uses: './.github/actions/infra-package', with: { directory: IDENTITY_INFRA_DIR } }],
            1,
        ],
        [
            'a schema-only use of the action',
            [
                {
                    uses: './.github/actions/infra-package',
                    with: { directory: IDENTITY_INFRA_DIR, 'schema-only': 'true' },
                },
            ],
            0,
        ],
        [
            'a deploy of another app',
            [{ run: 'cdk deploy --app "tsx packages/services/food-service/infra/bin/app.ts"' }],
            0,
        ],
    ] as const)('reads %s', (_label, steps, count) => {
        expect(deploysBeforeTheGate(steps)).toHaveLength(count);
    });

    it('⛔ every job that deploys identity resolves PAID_FEATURES_GATE first', () => {
        const all = jobs();
        const deploying = all.filter(({ steps }) => steps.some(deploysIdentity));
        const offending = all.flatMap(({ label, steps }) =>
            deploysBeforeTheGate(steps).map((line) => `${label}: ${line}`),
        );

        // Non-vacuity: the three known paths (sandbox-identity-deploy, prod-deploy, deployInfra's identity job).
        expect(deploying.length).toBeGreaterThanOrEqual(3);
        expect(offending, offending.join('\n')).toStrictEqual([]);
    });

    it('the identity app reads the gate at synth as the exact string "true"', () => {
        const source = readFileSync(path.join(repoRoot, IDENTITY_APP), 'utf8');

        expect(source).toContain("process.env['PAID_FEATURES_GATE'] === 'true'");
        expect(source).toMatch(/paidFeaturesGate,/u);
    });
});
