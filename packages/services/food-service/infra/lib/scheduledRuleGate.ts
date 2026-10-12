// ⚠️ DELIBERATE — see docs/architecture/decisions/0060-sandbox-starts-only-by-hand.md.
//
// A MIRRORED MODULE: every CDK app that owns a scheduled EventBridge rule carries an identical copy, held identical
// by `packages/infra/global/__tests__/mirroredModuleParity.test.ts`. Its natural home, `@radicle-co/infra-shared`, is
// consumed at a pinned PUBLISHED version that only a commit may move (owner ruling), so a new export there cannot
// reach the apps in the change that introduces it.
//
// A non-prod scheduled rule does not run because it was deployed. It runs while its stage is UP, and the sandbox
// scheduler's `sync` is the ONLY writer of that state. So every scheduled rule synthesizes DISABLED — CloudFormation
// re-applies `State` on every update, so a redeploy can only ever switch a job OFF — and carries the stage it serves,
// which is how `sync` finds it and what the scheduler's IAM grant is scoped by.
import { Aspects, CfnResource, type IAspect } from 'aws-cdk-lib';
import type { CfnRule } from 'aws-cdk-lib/aws-events';
import type { IConstruct } from 'constructs';

/**
 * The tag naming the stage a scheduled rule serves.
 *
 * ⛔ The value is fixed by `SCHEDULED_RULE_STAGE_TAG` in `packages/infra/global/lib/sandbox-scheduler/scheduler.ts`,
 * which the scheduler's IAM condition and its rule discovery both read; `nonProdScheduledRules.test.ts` fails if a
 * copy here disagrees.
 */
export const SCHEDULED_RULE_STAGE_TAG = 'SandboxStage';

/**
 * Sets every scheduled `AWS::Events::Rule` under a construct to DISABLED and tags it with its stage. An event-pattern
 * rule is left alone: it reacts to something that already happened and cannot run on its own.
 *
 * ⚠️ The tag goes through the resource's own tag manager, not `Tags.of()`: adding an aspect from inside an aspect is
 * not guaranteed to run.
 *
 * @pattern Visitor — a CDK Aspect over the construct tree
 */
export class ScheduledRulesStartDisabled implements IAspect {
    public constructor(private readonly stage: string) {}

    /**
     * Gate one construct, if it is a scheduled rule.
     *
     * @param node - The construct being visited.
     * @sideEffect Mutates the rule's synthesized `State` and tags.
     */
    public visit(node: IConstruct): void {
        if (!CfnResource.isCfnResource(node) || node.cfnResourceType !== 'AWS::Events::Rule') {
            return;
        }

        const rule = node as CfnRule;

        if (rule.scheduleExpression === undefined) {
            return;
        }

        rule.state = 'DISABLED';
        rule.cdkTagManager.setTag(SCHEDULED_RULE_STAGE_TAG, this.stage);
    }
}

/**
 * Hold every scheduled rule under `scope` for the sandbox scheduler — at every stage except `prod`.
 *
 * ⛔ At `prod` this adds NOTHING, so the production template is byte-identical to one built without it (ADR-0002,
 * ADR-0008). Production jobs run on their schedule, as they always have.
 *
 * @param scope - The stack whose scheduled rules are held.
 * @param stage - The deploy stage.
 * @sideEffect Attaches a CDK Aspect to `scope` outside prod.
 */
export function holdScheduledRulesForTheSandbox(scope: IConstruct, stage: string): void {
    if (stage === 'prod') {
        return;
    }

    Aspects.of(scope).add(new ScheduledRulesStartDisabled(stage));
}
