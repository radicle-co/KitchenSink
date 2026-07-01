/**
 * ADR-0008 account-wide cost guardrails: a standalone stack with an email-subscribed SNS topic, a
 * $300 MONTHLY COST budget (ACTUAL 80% + FORECASTED 100% notifications over SNS), and a per-SERVICE
 * cost anomaly monitor + IMMEDIATE subscription (~$20 absolute impact). The topic policy must let
 * both budgets.amazonaws.com and costalerts.amazonaws.com publish. Created ONCE (prod-only guard in
 * bin/app.ts), so this suite asserts the resources on the standalone stack directly.
 */
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect } from 'vitest';

import { CostGuardrailsStack } from '../lib/platform/cost-guardrails-stack.js';

const env = { account: '123456789012', region: 'us-east-1' };

const guardrailsTemplate = (): Template =>
    Template.fromStack(new CostGuardrailsStack(new App(), 'CostGuardrails', { env }));

describe('CostGuardrailsStack (ADR-0008)', () => {
    it('creates an SNS topic with the cost-alert email subscription', () => {
        const template = guardrailsTemplate();

        template.resourceCountIs('AWS::SNS::Topic', 1);
        template.hasResourceProperties('AWS::SNS::Subscription', {
            Protocol: 'email',
            Endpoint: 'webb.c.brandon@gmail.com',
        });
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

    it('provisions a $300 monthly cost budget', () => {
        guardrailsTemplate().hasResourceProperties('AWS::Budgets::Budget', {
            Budget: Match.objectLike({
                BudgetType: 'COST',
                TimeUnit: 'MONTHLY',
                BudgetLimit: { Amount: 300, Unit: 'USD' },
            }),
        });
    });

    it('notifies at 80% ACTUAL and 100% FORECASTED via SNS', () => {
        const budget = Object.values(guardrailsTemplate().findResources('AWS::Budgets::Budget'))[0] as any;
        const notifications = budget.Properties.Budget ? budget.Properties.NotificationsWithSubscribers : undefined;

        expect(notifications).toBeDefined();

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
