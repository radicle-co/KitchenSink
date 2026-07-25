/**
 * ADR-0008 account-wide cost guardrails: a standalone stack with an email-subscribed SNS topic, a
 * $300 MONTHLY COST budget (ACTUAL 80% + FORECASTED 100% notifications over SNS), and a per-SERVICE
 * cost anomaly monitor + IMMEDIATE subscription (~$20 absolute impact). The topic policy must let
 * both budgets.amazonaws.com and costalerts.amazonaws.com publish. Created ONCE (prod-only guard in
 * bin/app.ts), so this suite asserts the resources on the standalone stack directly.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect } from 'vitest';

import { CostGuardrailsStack } from '../lib/platform/cost-guardrails-stack.js';

const env = { account: '123456789012', region: 'us-east-1' };
const ALERT_EMAIL = 'alerts@example.com';

const guardrailsTemplate = (alertEmail?: string): Template =>
    Template.fromStack(new CostGuardrailsStack(new App(), 'CostGuardrails', { env, alertEmail }));

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
 * The "created ONCE" invariant lives in bin/app.ts, not in the stack: the stack is only instantiated
 * inside a `stage === 'prod'` guard, with a fixed (non-stage-suffixed) stack name, so the two persistent
 * stages (prod + sandbox) don't each register a duplicate account-scoped budget/anomaly monitor. Assert
 * on the app-entry source so removing the guard or stage-suffixing the name fails the suite.
 */
describe('CostGuardrailsStack is created once, prod-guarded (bin/app.ts)', () => {
    const appSource = readFileSync(fileURLToPath(new URL('../bin/app.ts', import.meta.url)), 'utf8');

    it('instantiates the stack exactly once', () => {
        expect(appSource.match(/new CostGuardrailsStack\(/g) ?? []).toHaveLength(1);
    });

    it('guards the instantiation behind stage === "prod"', () => {
        expect(appSource).toMatch(/if\s*\(\s*stage\s*===\s*'prod'\s*\)\s*\{[\s\S]*?new CostGuardrailsStack\(/);
    });

    it('uses a single fixed, non-stage-suffixed stack name (one per account, not per stage)', () => {
        expect(appSource).toContain("stackName: 'kitchensink-cost-guardrails'");
        // A `kitchensink-cost-guardrails-${stage}` / `-pr-…` name would create per-stage duplicates.
        expect(appSource).not.toMatch(/kitchensink-cost-guardrails-/);
        expect(appSource).not.toMatch(/kitchensink-cost-guardrails\$\{/);
    });
});
