/**
 * The non-prod scheduled-rule gate (ADR-0060), tested once here and held identical in every app that carries a copy
 * by `packages/tools/repoGuards/__tests__/mirroredModuleParity.test.ts`.
 *
 * What it must do, and what each test below would catch if it stopped:
 *
 * - at a non-prod stage, a rule with a `ScheduleExpression` synthesizes DISABLED and tagged with its stage — so a
 *   deploy never starts a job, and the scheduler's `sync` (the only writer of rule state) can find and own it;
 * - an EVENT-PATTERN rule is untouched, because it reacts to something that happened and cannot run on its own;
 * - at prod it changes NOTHING: the template is byte-identical to one built without the gate (ADR-0002, ADR-0008);
 * - and the tag really reaches the synthesized `AWS::Events::Rule` on this repository's aws-cdk-lib, which is the
 *   question the plan left open: `CfnRule` must be taggable here, or `sync` discovers nothing.
 */
import { App, Aspects, Duration, Stack, Tags, aws_events as events } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import {
    SCHEDULED_RULE_STAGE_TAG,
    ScheduledRulesStartDisabled,
    holdScheduledRulesForTheSandbox,
} from '../lib/scheduledRuleGate.js';

/** A stack holding one scheduled rule and one event-pattern rule, optionally gated at `stage`. */
function ruleStack(stage: string, gate: boolean): Stack {
    const stack = new Stack(new App(), `Rules-${stage}`);

    new events.Rule(stack, 'Sweep', { schedule: events.Schedule.rate(Duration.hours(1)) });
    new events.Rule(stack, 'OnTaskFailed', {
        eventPattern: { source: ['aws.ecs'], detailType: ['ECS Task State Change'] },
    });

    if (gate) {
        holdScheduledRulesForTheSandbox(stack, stage);
    }

    return stack;
}

/** Each rule's `State` and tags, keyed by whether it is scheduled. */
function rulesOf(stack: Stack): { scheduled: Record<string, unknown>; pattern: Record<string, unknown> } {
    const rules = Object.values(Template.fromStack(stack).findResources('AWS::Events::Rule')).map(
        (resource) => resource['Properties'] as Record<string, unknown>,
    );
    const scheduled = rules.find((rule) => rule['ScheduleExpression'] !== undefined);
    const pattern = rules.find((rule) => rule['EventPattern'] !== undefined);

    if (scheduled === undefined || pattern === undefined) {
        throw new Error('the fixture stack lost a rule — every assertion below would be vacuous');
    }

    return { scheduled, pattern };
}

describe('holdScheduledRulesForTheSandbox', () => {
    it.each(['sandbox', 'pr-7'])(
        'at %s: the scheduled rule synthesizes DISABLED and tagged with its stage',
        (stage) => {
            const { scheduled } = rulesOf(ruleStack(stage, true));

            expect(scheduled['State']).toBe('DISABLED');
            // (b) — the tag REACHES the synthesized rule: `CfnRule` is `ITaggableV2` on this aws-cdk-lib.
            expect(scheduled['Tags']).toEqual([{ Key: SCHEDULED_RULE_STAGE_TAG, Value: stage }]);
        },
    );

    it('leaves an event-pattern rule exactly as it was', () => {
        expect(rulesOf(ruleStack('pr-7', true)).pattern).toEqual(rulesOf(ruleStack('pr-7', false)).pattern);
    });

    it('⛔ at prod the template is byte-identical to one built without the gate', () => {
        const gated = JSON.stringify(Template.fromStack(ruleStack('prod', true)).toJSON());
        const ungated = JSON.stringify(Template.fromStack(ruleStack('prod', false)).toJSON());

        expect(gated).toBe(ungated);
    });

    it('…and that comparison CAN fail: the aspect itself, forced onto prod, moves the template', () => {
        // The negative control. Without it, "byte-identical" could be true because the comparison is blind.
        const forced = ruleStack('prod', false);
        Aspects.of(forced).add(new ScheduledRulesStartDisabled('prod'));

        expect(JSON.stringify(Template.fromStack(forced).toJSON())).not.toBe(
            JSON.stringify(Template.fromStack(ruleStack('prod', false)).toJSON()),
        );
    });

    it('adds no aspect at all at prod, so nothing can run there', () => {
        const stack = ruleStack('prod', true);

        expect(Aspects.of(stack).all.some((aspect) => aspect instanceof ScheduledRulesStartDisabled)).toBe(false);
    });

    it('keeps the App-level Environment tag beside its own — the one the IAM Deny on production reads', () => {
        // Every bin/app.ts tags with `Tags.of(app)`, itself an aspect. Both must reach the rule: the scheduler's grant
        // keys on the stage tag, and its explicit Deny keys on `Environment=production`.
        const app = new App();
        const stack = new Stack(app, 'Tagged');
        new events.Rule(stack, 'Sweep', { schedule: events.Schedule.rate(Duration.hours(1)) });
        Tags.of(app).add('Environment', 'pr-7-sandbox');
        holdScheduledRulesForTheSandbox(stack, 'pr-7');

        const [rule] = Object.values(Template.fromStack(stack).findResources('AWS::Events::Rule'));

        expect(rule?.['Properties']?.['Tags']).toEqual(
            expect.arrayContaining([
                { Key: 'Environment', Value: 'pr-7-sandbox' },
                { Key: SCHEDULED_RULE_STAGE_TAG, Value: 'pr-7' },
            ]),
        );
    });
});
