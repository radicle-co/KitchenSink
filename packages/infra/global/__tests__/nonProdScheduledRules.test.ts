// @vitest-environment node
/**
 * Repo-wide guard (ADR-0060): every stack that constructs a SCHEDULED EventBridge rule holds it for the sandbox
 * scheduler — outside prod it synthesizes DISABLED and tagged with its stage, and the scheduler's `sync` is the only
 * thing that switches it on.
 *
 * ## Why a source guard, and where the synthesized proof lives
 *
 * The behaviour is proven by SYNTHESIS in the package that owns each stack, on that package's own `aws-cdk-lib`:
 * `scheduledRuleGate.test.ts` (the gate itself: DISABLED + tagged at `sandbox`/`pr-7`, event-pattern rules untouched,
 * prod byte-identical to an ungated build with a negative control, and the tag reaching the synthesized
 * `AWS::Events::Rule`), plus a rules-discovered block in each owning stack's suite. Synthesizing every app from HERE
 * would put two `aws-cdk-lib` instances in one tree — the split `@radicle-co/infra-shared` peers on CDK to avoid.
 *
 * What only a repo-wide view can answer is COVERAGE: does every stack that owns a scheduled rule apply the gate, and
 * do all the copies of the gate agree with the scheduler? Both sides are discovered, never listed.
 *
 * DESIGN PATTERN: Specification module over a derived set (`scheduledRuleOwners.ts`).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SCHEDULED_RULE_STAGE_TAG } from '../lib/sandbox-scheduler/scheduler.js';
import { productionSources, readSource, REPO_ROOT } from '@kitchensink/repo-guards/roleSplitSources';
import { withoutTsComments } from '@kitchensink/repo-guards/sourceComments';
import {
    constructsScheduledRule,
    SHARED_CONSTRUCTS,
    scheduledRuleOwners,
} from '@kitchensink/repo-guards/scheduledRuleOwners';

/** The gate's call, as each owning stack makes it: on itself, with its stage. */
const GATE_CALL = /\bholdScheduledRulesForTheSandbox\s*\(\s*this\s*,\s*props\.stage\s*\)/u;

/** The gate's import, from the app's own mirrored copy. */
const GATE_IMPORT = /from\s+'\.\/scheduledRuleGate\.js'/u;

/** The tag key a copy of the gate declares. */
const DECLARED_TAG = /export const SCHEDULED_RULE_STAGE_TAG = '([^']+)'/u;

describe('the scheduled-rule detector', () => {
    // The guard is only as good as this predicate, so it is fired at shapes the tree has never held as well as the
    // ones it does.
    it.each([
        ['an L2 rate', "new events.Rule(this, 'X', { schedule: events.Schedule.rate(Duration.hours(1)) });"],
        ['an L2 cron', "new events.Rule(this, 'X', { schedule: events.Schedule.cron({ minute: '0' }) });"],
        ['an L2 expression', "schedule: Schedule.expression('rate(5 minutes)'),"],
        ['an L1 rule', "new events.CfnRule(this, 'X', { scheduleExpression: 'rate(1 day)' });"],
    ])('sees %s', (_shape, source) => {
        expect(constructsScheduledRule(source)).toBe(true);
    });

    it.each([
        [
            'EventBridge SCHEDULER (the sandbox stop itself)',
            'schedule: scheduler.ScheduleExpression.cron({ hour: "0" }),',
        ],
        ['an event-pattern rule', "new events.Rule(this, 'X', { eventPattern: { source: ['aws.ecs'] } });"],
        ['a comment', '// events.Schedule.rate(Duration.hours(1)) used to live here'],
    ])('does not see %s', (_shape, source) => {
        expect(constructsScheduledRule(source)).toBe(false);
    });
});

describe('every stack owning a scheduled rule holds it for the sandbox scheduler (ADR-0060)', () => {
    const owners = scheduledRuleOwners();

    it('is not vacuous — the owners are discovered from the tree', () => {
        expect(owners.length).toBeGreaterThan(0);
    });

    it('⛔ each owning stack applies the gate to itself, with its own stage', () => {
        const ungated = owners
            .filter(({ file }) => {
                const code = withoutTsComments(readSource(file), file);

                return !(GATE_CALL.test(code) && GATE_IMPORT.test(code));
            })
            .map(({ file }) => file);

        expect(
            ungated,
            'these stacks build a scheduled rule that would deploy ENABLED at every sandbox and preview stage, running ' +
                "whether or not the stage is up. Call `holdScheduledRulesForTheSandbox(this, props.stage)` from the app's " +
                'own `lib/scheduledRuleGate.ts`.',
        ).toEqual([]);
    });

    it('each owning app carries the gate, declaring the SAME tag key the scheduler grants and reads', () => {
        for (const appRoot of new Set(owners.map((owner) => owner.appRoot))) {
            const gate = `${appRoot}/lib/scheduledRuleGate.ts`;

            expect(existsSync(join(REPO_ROOT, gate)), gate).toBe(true);
            expect(DECLARED_TAG.exec(readSource(gate))?.[1], gate).toBe(SCHEDULED_RULE_STAGE_TAG);
        }
    });

    it('⛔ no shared construct builds a scheduled rule — the stack instantiating it could not be found to gate', () => {
        const shared = productionSources().filter(
            (file) => SHARED_CONSTRUCTS.test(file) && constructsScheduledRule(readSource(file)),
        );

        expect(shared).toEqual([]);
    });
});
