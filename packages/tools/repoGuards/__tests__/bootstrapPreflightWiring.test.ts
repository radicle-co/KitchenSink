/**
 * Repo-wide guard: EVERY CI step that runs `cdk deploy` (or the `npm run deploy` that wraps it) is preceded, in the
 * same job, by `bootstrapPreflight.sh check` (ADR-0065).
 *
 * Until the owner bootstraps the KitchenSink qualifiers, an un-checked deploy dies at AssumeRole on a role that
 * does not exist, with an error that names neither the qualifier nor the runbook. The subject set is DISCOVERED
 * (every workflow job and every composite action), not listed, so a new deploy step is covered the day it lands.
 *
 * Parsed with a real YAML parser, so a mention in a comment is not a deploy and a preflight in a comment is not a
 * preflight.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

interface Step {
    readonly name?: string;
    readonly run?: string;
}

interface StepList {
    readonly where: string;
    readonly steps: readonly Step[];
}

const DEPLOY = /\bcdk deploy\b|\bnpm run deploy\b/u;

/** A step's executable lines: shell comment lines are prose, and a comment that says `cdk deploy` is not one. */
const code = (run: string | undefined): string =>
    (run ?? '')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
const PREFLIGHT = /bootstrapPreflight\.sh check\b/u;

/**
 * Deploy steps with no preceding preflight in their own step list.
 *
 * @param lists - Every job's steps and every composite action's steps.
 * @returns One finding per unguarded deploy step. Pure.
 */
function unguardedDeploys(lists: readonly StepList[]): readonly string[] {
    return lists.flatMap(({ where, steps }) =>
        steps.flatMap((step, index) => {
            if (!DEPLOY.test(code(step.run))) {
                return [];
            }

            const guarded = steps.slice(0, index).some((earlier) => PREFLIGHT.test(code(earlier.run)));

            return guarded
                ? []
                : [
                      `${where}: step "${step.name ?? `#${index}`}" deploys with no bootstrapPreflight.sh check before it`,
                  ];
        }),
    );
}

function stepLists(): readonly StepList[] {
    const workflows = join(repoRoot, '.github/workflows');
    const actions = join(repoRoot, '.github/actions');
    const lists: StepList[] = [];

    for (const file of readdirSync(workflows).filter((name) => name.endsWith('.yml'))) {
        const doc = parse(readFileSync(join(workflows, file), 'utf8')) as { jobs?: Record<string, { steps?: Step[] }> };

        for (const [job, body] of Object.entries(doc.jobs ?? {})) {
            lists.push({ where: `workflows/${file} job ${job}`, steps: body.steps ?? [] });
        }
    }

    for (const dir of readdirSync(actions)) {
        const doc = parse(readFileSync(join(actions, dir, 'action.yml'), 'utf8')) as { runs?: { steps?: Step[] } };

        lists.push({ where: `actions/${dir}`, steps: doc.runs?.steps ?? [] });
    }

    return lists;
}

describe('unguardedDeploys: the guard fails when it should', () => {
    const deploy: Step = { name: 'Deploy', run: 'packages/x/node_modules/.bin/cdk deploy --all' };
    const check: Step = {
        name: 'Preflight',
        run: 'bash .github/scripts/bootstrapPreflight.sh check "$STAGE" "$REGION"',
    };

    it('is quiet when a preflight precedes the deploy', () => {
        expect(unguardedDeploys([{ where: 'j', steps: [check, deploy] }])).toEqual([]);
    });

    it('names a deploy with no preflight, and one whose preflight comes AFTER it', () => {
        expect(unguardedDeploys([{ where: 'j', steps: [deploy] }])).toEqual([expect.stringContaining('"Deploy"')]);
        expect(unguardedDeploys([{ where: 'j', steps: [deploy, check] }])).toHaveLength(1);
    });

    it('treats the npm wrapper as a deploy', () => {
        expect(
            unguardedDeploys([{ where: 'j', steps: [{ name: 'W', run: 'npm run deploy --prefix x' }] }]),
        ).toHaveLength(1);
    });

    it('does not accept the qualifier-only subcommand as a check', () => {
        const only: Step = { run: 'bash .github/scripts/bootstrapPreflight.sh qualifier prod' };

        expect(unguardedDeploys([{ where: 'j', steps: [only, deploy] }])).toHaveLength(1);
    });

    it('ignores shell comments on both sides', () => {
        const prose: Step = { name: 'P', run: '# its cdk deploy follows\necho hi' };
        const commented: Step = { name: 'C', run: '# bash .github/scripts/bootstrapPreflight.sh check x y' };

        expect(unguardedDeploys([{ where: 'j', steps: [prose] }])).toEqual([]);
        expect(unguardedDeploys([{ where: 'j', steps: [commented, deploy] }])).toHaveLength(1);
    });

    it('does not let another job’s preflight cover this job', () => {
        const lists = [
            { where: 'a', steps: [check] },
            { where: 'b', steps: [deploy] },
        ];

        expect(unguardedDeploys(lists)).toEqual([expect.stringContaining('b:')]);
    });
});

describe('the real tree', () => {
    it('finds deploy steps at all (a vacuous pass is the failure this guards against)', () => {
        const deploys = stepLists().flatMap(({ steps }) => steps.filter((step) => DEPLOY.test(code(step.run))));

        expect(deploys.length).toBeGreaterThanOrEqual(10);
    });

    it('has a bootstrap preflight before every cdk deploy', () => {
        expect(unguardedDeploys(stepLists())).toEqual([]);
    });
});
