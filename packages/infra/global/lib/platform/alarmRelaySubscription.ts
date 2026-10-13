// ⚠️ DELIBERATE — see docs/architecture/decisions/0062-stage-scoped-metrics-and-alarm-relay.md.
//
// A MIRRORED MODULE: every CDK app that owns an alarm topic carries an identical copy, held identical by
// `packages/infra/global/__tests__/mirroredModuleParity.test.ts`. Its natural home, `@radicle-co/infra-shared`, is
// consumed at a pinned PUBLISHED version that only a commit may move (owner ruling), so a new export there cannot reach
// the apps in the change that introduces it. `scheduledRuleGate.ts` is the precedent.
//
// Every alarm topic is owned by the stack that raises the alarms (ADR-0062 keeps that), and every one of them delivers to
// ONE relay Lambda per base stage, which turns a transition into a Sentry issue. The relay lives in the global app and
// every consumer is downstream of it, so its ARN reaches a consumer as an export it imports, not as a CI-resolved input
// (ADR-0042's log forwarder needed that because it sits upstream of what it serves).
import {
    Aspects,
    CfnResource,
    Fn,
    aws_lambda as lambda,
    aws_sns_subscriptions as subscriptions,
    type IAspect,
    type Stack,
    type aws_cloudwatch as cloudwatch,
    type aws_sns as sns,
} from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';

/** The output the relay's stack exports its function ARN under, beside the stack name. */
export const ALARM_RELAY_EXPORT = 'AlarmRelayFunctionArn';

/**
 * The relay's function ARN for a stage, as a CloudFormation import.
 *
 * ⛔ ONE RELAY PER BASE STAGE, not per stage: every `pr-{N}` preview alarms through the sandbox relay, exactly as it
 * imports the sandbox platform (ADR-0006). The global app only ever deploys base stages.
 *
 * ⚠️ Once a consumer imports this, the relay function cannot be REPLACED without detaching every subscriber first;
 * an in-place update is fine.
 *
 * @param stage - The deploy stage of the importing stack.
 * @returns A token that resolves to the relay function's ARN. Pure.
 */
export function importAlarmRelayArn(stage: string): string {
    return Fn.importValue(`kitchensink-alarm-relay-${stage === 'prod' ? 'prod' : 'sandbox'}:${ALARM_RELAY_EXPORT}`);
}

/**
 * Makes every alarm's OK transition go where its ALARM transition goes.
 *
 * An OK that nobody receives leaves the relay unable to say an incident ended, and an `OKActions` that differs from
 * `AlarmActions` is a second, unreviewed route. An alarm with no action has no ALARM route to mirror and is left alone.
 *
 * ⚠️ The list is copied as the same token, so an alarm whose actions resolve to nothing keeps `OKActions` absent too.
 *
 * @pattern Visitor — a CDK Aspect over the construct tree
 */
export class AlarmTransitionsRelayed implements IAspect {
    /**
     * Mirror one construct's alarm actions, if it is an alarm.
     *
     * @param node - The construct being visited.
     * @sideEffect Mutates the alarm's synthesized `OKActions`.
     */
    public visit(node: IConstruct): void {
        if (!CfnResource.isCfnResource(node) || node.cfnResourceType !== 'AWS::CloudWatch::Alarm') {
            return;
        }

        const alarm = node as cloudwatch.CfnAlarm;

        if (alarm.alarmActions !== undefined) {
            alarm.okActions = alarm.alarmActions;
        }
    }
}

/**
 * Deliver an alarm topic's transitions to the relay, and forward the OK transitions too.
 *
 * Subscribes the relay to `topic` with ONE invoke permission scoped to THAT topic (a permission with no `SourceArn`
 * would let any topic in the account invoke it), and makes every alarm in `stack` send its OK where it sends its ALARM.
 *
 * @param stack - The stack that owns the topic and its alarms.
 * @param topic - The alarm topic.
 * @param relayArn - The relay function's ARN: an import from {@link importAlarmRelayArn}, or the relay's own token.
 * @sideEffect Adds a subscription, a permission and (once per stack) an aspect to `stack`.
 */
export function relayAlarmTransitions(stack: Stack, topic: sns.ITopic, relayArn: string): void {
    const relay = lambda.Function.fromFunctionAttributes(stack, `AlarmRelay${topic.node.id}`, {
        functionArn: relayArn,
        sameEnvironment: true,
    });

    topic.addSubscription(new subscriptions.LambdaSubscription(relay));

    if (!Aspects.of(stack).all.some((aspect) => aspect instanceof AlarmTransitionsRelayed)) {
        Aspects.of(stack).add(new AlarmTransitionsRelayed());
    }
}
