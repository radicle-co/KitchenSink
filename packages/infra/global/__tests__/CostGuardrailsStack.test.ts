/**
 * ADR-0008 account-wide cost guardrails: a standalone stack with an email-subscribed SNS topic, a
 * $300 MONTHLY COST budget (ACTUAL 80% + FORECASTED 100% notifications over SNS), and a per-SERVICE
 * cost anomaly monitor + IMMEDIATE subscription (~$20 absolute impact). The topic policy must let
 * both budgets.amazonaws.com and costalerts.amazonaws.com publish. Created ONCE (prod-only guard in
 * bin/app.ts), so this suite asserts the resources on the standalone stack directly.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect } from 'vitest';

import { CostGuardrailsStack } from '../lib/platform/CostGuardrailsStack.js';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };
const ALERT_EMAIL = 'alerts@example.com';

const guardrailsTemplate = (alertEmail?: string): Template =>
    Template.fromStack(new CostGuardrailsStack(testApp(), 'CostGuardrails', { env, alertEmail }));

describe('CostGuardrailsStack (ADR-0008)', () => {
    it('creates an SNS topic with the configured cost-alert email subscription', () => {
        const template = guardrailsTemplate(ALERT_EMAIL);

        template.resourceCountIs('AWS::SNS::Topic', 1);
        template.hasResourceProperties('AWS::SNS::Subscription', {
            Protocol: 'email',
            Endpoint: ALERT_EMAIL,
        });
    });

    it('omits the email subscription entirely when no alert email is configured', () => {
        const template = guardrailsTemplate(undefined);

        template.resourceCountIs('AWS::SNS::Topic', 1);
        template.resourceCountIs('AWS::SNS::Subscription', 0);
    });

    it('lets both budgets and cost-anomaly-detection publish to the topic', () => {
        guardrailsTemplate().hasResourceProperties('AWS::SNS::TopicPolicy', {
            PolicyDocument: {
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: 'sns:Publish',
                        Effect: 'Allow',
                        Principal: { Service: 'budgets.amazonaws.com' },
                    }),
                    Match.objectLike({
                        Action: 'sns:Publish',
                        Effect: 'Allow',
                        Principal: { Service: 'costalerts.amazonaws.com' },
                    }),
                ]),
            },
        });
    });

    it('provisions exactly ONE $300 monthly cost budget', () => {
        const template = guardrailsTemplate();

        // "Created ONCE": a single budget resource on this account-scoped stack (bin/app.ts prod-guard
        // asserted separately below prevents a second copy per stage).
        template.resourceCountIs('AWS::Budgets::Budget', 1);
        template.hasResourceProperties('AWS::Budgets::Budget', {
            Budget: Match.objectLike({
                BudgetType: 'COST',
                TimeUnit: 'MONTHLY',
                BudgetLimit: { Amount: 300, Unit: 'USD' },
            }),
        });
    });

    it('tags the alert topic Environment=global so per-PR cleanup (ADR-0005) never deletes it', () => {
        guardrailsTemplate().hasResourceProperties('AWS::SNS::Topic', {
            Tags: Match.arrayWith([Match.objectLike({ Key: 'Environment', Value: 'global' })]),
        });
    });

    it('notifies at 80% ACTUAL and 100% FORECASTED via SNS', () => {
        const budget = Object.values(guardrailsTemplate().findResources('AWS::Budgets::Budget'))[0] as any;
        const notifications = budget.Properties.Budget ? budget.Properties.NotificationsWithSubscribers : undefined;

        // Exactly the two notifications wired in the stack (ACTUAL 80% + FORECASTED 100%) — no more, no fewer.
        expect(notifications).toHaveLength(2);

        const shapes = (notifications as any[]).map((entry) => ({
            type: entry.Notification.NotificationType,
            operator: entry.Notification.ComparisonOperator,
            threshold: entry.Notification.Threshold,
            thresholdType: entry.Notification.ThresholdType,
            subscriberType: entry.Subscribers[0].SubscriptionType,
        }));

        expect(shapes).toContainEqual({
            type: 'ACTUAL',
            operator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
            subscriberType: 'SNS',
        });
        expect(shapes).toContainEqual({
            type: 'FORECASTED',
            operator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
            subscriberType: 'SNS',
        });
    });

    it('creates a per-SERVICE dimensional anomaly monitor', () => {
        guardrailsTemplate().hasResourceProperties('AWS::CE::AnomalyMonitor', {
            MonitorType: 'DIMENSIONAL',
            MonitorDimension: 'SERVICE',
        });
    });

    it('creates an IMMEDIATE anomaly subscription over SNS with a ~$20 absolute-impact threshold', () => {
        const template = guardrailsTemplate();

        template.hasResourceProperties('AWS::CE::AnomalySubscription', {
            Frequency: 'IMMEDIATE',
            Subscribers: Match.arrayWith([Match.objectLike({ Type: 'SNS' })]),
        });

        const subscription = Object.values(template.findResources('AWS::CE::AnomalySubscription'))[0] as any;
        const threshold = JSON.parse(subscription.Properties.ThresholdExpression);

        expect(threshold.Dimensions.Key).toBe('ANOMALY_TOTAL_IMPACT_ABSOLUTE');
        expect(threshold.Dimensions.Values).toEqual(['20']);
        expect(threshold.Dimensions.MatchOptions).toEqual(['GREATER_THAN_OR_EQUAL']);
    });
});

/**
 * The "created ONCE" invariant lives in the APP, not in the stack — but which app changed, and so did the
 * mechanism.
 *
 * It used to be `bin/app.ts` behind `if (stage === 'prod')`: an account-scoped stack reachable only by
 * deploying a STAGE, which produced the right number of copies (one) by the wrong means. Two things followed
 * from that — the account's cost monitoring could not be touched without a production deploy, and the stack
 * inherited the per-stage app's `Environment` tag, labelling an account-wide resource `production`.
 *
 * It now lives in `bin/account.ts`, which HAS NO STAGE AT ALL. That makes "one per account, never per
 * stage" structural instead of conditional: an app with no stage cannot be deployed per stage, so the
 * sandbox case is not refused, it is unrepresentable. Asserted on the app source, so reintroducing a stage
 * — or stage-suffixing the name — fails here.
 */
describe('CostGuardrailsStack is created once, by an app with no stage (bin/account.ts)', () => {
    const appSource = readFileSync(fileURLToPath(new URL('../bin/account.ts', import.meta.url)), 'utf8');

    it('instantiates the stack exactly once', () => {
        expect(appSource.match(/new CostGuardrailsStack\(/g) ?? []).toHaveLength(1);
    });

    it('needs no stage guard, because the app cannot express a stage', () => {
        // ⛔ The replacement for `if (stage === 'prod')`, and a stronger claim than it made: not "we only
        // build it at prod" but "this app has no notion of a stage to build it at". A `stage` reappearing
        // in the CODE is the coupling coming back.
        //
        // ⚠️ Comments are stripped first. This file's header exists to explain the stage-shared vs
        // account-scoped distinction, so it says the word "stage" repeatedly and legitimately — an
        // assertion that counted those would be unsatisfiable, and an unsatisfiable guard gets deleted
        // rather than obeyed.
        const code = appSource.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');

        expect(code).not.toMatch(/\bstage\b/u);
        expect(code).not.toMatch(/STAGE/u);
    });

    it('uses a single fixed, non-stage-suffixed stack name (one per account, not per stage)', () => {
        expect(appSource).toContain("stackName: 'kitchensink-cost-guardrails'");
        // A `kitchensink-cost-guardrails-${stage}` / `-pr-…` name would create per-stage duplicates.
        expect(appSource).not.toMatch(/kitchensink-cost-guardrails-/);
        expect(appSource).not.toMatch(/kitchensink-cost-guardrails\$\{/);
    });

    it('is NOT reachable from the per-stage app', () => {
        // The other half: removing it from `bin/account.ts` would fail above, but leaving a second
        // instantiation in the stage app would not — and that is the exact shape the split undoes.
        const stageApp = readFileSync(fileURLToPath(new URL('../bin/app.ts', import.meta.url)), 'utf8');

        expect(stageApp).not.toMatch(/new CostGuardrailsStack\(/u);
        expect(stageApp).not.toMatch(/CostGuardrailsStack/u);
    });
});
