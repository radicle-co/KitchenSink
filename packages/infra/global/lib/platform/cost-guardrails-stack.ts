/**
 * Account-wide cost guardrails (ADR-0008).
 *
 * A single, standalone, account-scoped stack — NOT a child of `GlobalStack` and NOT service- or
 * stage-scoped. It is created exactly ONCE (only for `stage === 'prod'` in `bin/app.ts`) so the
 * account never ends up with duplicate budgets/anomaly monitors across stages. It provisions:
 *
 * - an SNS topic (email-subscribed) that both AWS Budgets and Cost Anomaly Detection publish to;
 * - a MONTHLY COST budget with `ACTUAL 80%` and `FORECASTED 100%` notifications;
 * - a DIMENSIONAL (per-SERVICE) cost anomaly monitor + an IMMEDIATE subscription with a ~$20
 *   absolute-impact threshold.
 *
 * It is tagged `Environment=global` and named `kitchensink-cost-guardrails` so the per-PR cleanup
 * sweep (ADR-0005) never touches it.
 *
 * The alert recipient is NOT hardcoded — it comes from {@link CostGuardrailsStackProps.alertEmail}
 * (wired from the `costAlertEmail` CDK context / `COST_ALERT_EMAIL` env in `bin/app.ts`), so each
 * account configures its own address. When unset, the SNS topic (and its budget/anomaly publishers)
 * is still provisioned but carries no email subscription — a recipient can be added later without
 * touching the budget.
 */
import {
    Stack,
    Tags,
    type StackProps,
    aws_budgets as budgets,
    aws_ce as ce,
    aws_iam as iam,
    aws_sns as sns,
    aws_sns_subscriptions as subscriptions,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

// ── Tunable guardrail constants (edit here to retune the account budget / alerts) ────────────────
/** Monthly cost budget ceiling in USD. Tunable. */
const MONTHLY_BUDGET_USD = 300;
/** Notify when ACTUAL month-to-date spend exceeds this percent of the budget. Tunable. */
const BUDGET_ACTUAL_THRESHOLD_PCT = 80;
/** Notify when FORECASTED month-end spend exceeds this percent of the budget. Tunable. */
const BUDGET_FORECAST_THRESHOLD_PCT = 100;
/** Cost Anomaly Detection alerts on an anomaly whose absolute impact is at least this many USD. Tunable. */
const ANOMALY_IMPACT_THRESHOLD_USD = 20;

/** Props for {@link CostGuardrailsStack}. */
export interface CostGuardrailsStackProps extends StackProps {
    /**
     * Email address that receives all cost alerts (budget + anomaly). Supplied per-account from the
     * `costAlertEmail` CDK context / `COST_ALERT_EMAIL` env in `bin/app.ts`; when omitted, the topic is
     * created without an email subscription so no address is baked into the template.
     */
    readonly alertEmail?: string;
}

/**
 * Account-wide cost guardrails: SNS alerting, a monthly budget, and cost anomaly detection.
 *
 * @implements ADR-0008
 */
export class CostGuardrailsStack extends Stack {
    /** The SNS topic that budget + anomaly notifications publish to. */
    public readonly alertTopic: sns.Topic;

    public constructor(scope: Construct, id: string, props?: CostGuardrailsStackProps) {
        super(scope, id, props);

        // This stack outlives per-PR cleanup — it is global, never `pr-{N}` (ADR-0005).
        Tags.of(this).add('Environment', 'global');

        this.alertTopic = new sns.Topic(this, 'CostAlertTopic', {
            displayName: 'KitchenSink cost alerts',
        });

        // Configured per-account (never hardcoded); a topic with no email still fans out to any SNS
        // subscriber added later, so an unset address degrades gracefully rather than failing synth.
        if (props?.alertEmail) {
            this.alertTopic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
        }

        // AWS Budgets and Cost Anomaly Detection are AWS services that publish to the topic on the
        // account's behalf, so the topic resource policy must explicitly allow each service principal
        // to `sns:Publish`. Without this the budget/anomaly subscription creation fails validation.
        const topicPolicy = new sns.TopicPolicy(this, 'CostAlertTopicPolicy', {
            topics: [this.alertTopic],
        });
        topicPolicy.document.addStatements(
            new iam.PolicyStatement({
                sid: 'AllowBudgetsPublish',
                effect: iam.Effect.ALLOW,
                principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
                actions: ['sns:Publish'],
                resources: [this.alertTopic.topicArn],
                // Confused-deputy guard: only budgets acting for THIS account may publish, so another
                // account's budgets service can't be tricked into targeting our alert topic.
                conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
            }),
            new iam.PolicyStatement({
                sid: 'AllowCostAnomalyDetectionPublish',
                effect: iam.Effect.ALLOW,
                principals: [new iam.ServicePrincipal('costalerts.amazonaws.com')],
                actions: ['sns:Publish'],
                resources: [this.alertTopic.topicArn],
                // Same confused-deputy guard for the cost-anomaly-detection service principal.
                conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
            }),
            // AwsSolutions-SNS3: deny non-TLS publishing.
            //
            // ⛔ It goes in THIS document rather than via `new sns.Topic({ enforceSSL: true })`, and that is
            // load-bearing. `enforceSSL` makes CDK lazily create its own `Topic/Policy` construct; CDK knows
            // nothing about the hand-built `CostAlertTopicPolicy` above, so setting it would emit a SECOND
            // `AWS::SNS::TopicPolicy` for the same topic. That resource maps onto
            // `SetTopicAttributes(Policy=...)`, which REPLACES the whole document — so two of them is
            // last-writer-wins, and a deploy could silently drop the two grants above. The only symptom
            // would be cost alerts that never arrive, i.e. the alerting this stack exists to provide
            // (ADR-0008) failing silently. `transport-security.test.ts` pins both halves: exactly one
            // TopicPolicy here, and the grants still present.
            new iam.PolicyStatement({
                sid: 'DenyInsecureTransport',
                effect: iam.Effect.DENY,
                principals: [new iam.AnyPrincipal()],
                actions: ['sns:Publish'],
                resources: [this.alertTopic.topicArn],
                conditions: { Bool: { 'aws:SecureTransport': 'false' } },
            }),
        );

        // ── Monthly cost budget ($300) ───────────────────────────────────────────────────────────
        // SNS subscriber (topic ARN) is the cleanest fan-out: one topic drives the email today and can
        // add Slack/Chatbot later without touching the budget. Threshold percentages are of the limit.
        const budget = new budgets.CfnBudget(this, 'MonthlyCostBudget', {
            budget: {
                budgetName: 'kitchensink-monthly-cost',
                budgetType: 'COST',
                timeUnit: 'MONTHLY',
                budgetLimit: {
                    amount: MONTHLY_BUDGET_USD,
                    unit: 'USD',
                },
            },
            notificationsWithSubscribers: [
                {
                    notification: {
                        notificationType: 'ACTUAL',
                        comparisonOperator: 'GREATER_THAN',
                        threshold: BUDGET_ACTUAL_THRESHOLD_PCT,
                        thresholdType: 'PERCENTAGE',
                    },
                    subscribers: [{ subscriptionType: 'SNS', address: this.alertTopic.topicArn }],
                },
                {
                    notification: {
                        notificationType: 'FORECASTED',
                        comparisonOperator: 'GREATER_THAN',
                        threshold: BUDGET_FORECAST_THRESHOLD_PCT,
                        thresholdType: 'PERCENTAGE',
                    },
                    subscribers: [{ subscriptionType: 'SNS', address: this.alertTopic.topicArn }],
                },
            ],
        });
        budget.node.addDependency(topicPolicy);

        // ── Cost anomaly detection (per-service, immediate ≥ $20 impact) ──────────────────────────
        const anomalyMonitor = new ce.CfnAnomalyMonitor(this, 'ServiceAnomalyMonitor', {
            monitorName: 'kitchensink-service-anomalies',
            monitorType: 'DIMENSIONAL',
            monitorDimension: 'SERVICE',
        });

        // IMMEDIATE frequency delivers over SNS only (email is DAILY/WEEKLY), hence the SNS subscriber
        // and the `costalerts.amazonaws.com` topic-policy grant above. The threshold expression fires
        // when an anomaly's total absolute impact is at least $20.
        const anomalySubscription = new ce.CfnAnomalySubscription(this, 'ServiceAnomalySubscription', {
            subscriptionName: 'kitchensink-service-anomaly-alerts',
            frequency: 'IMMEDIATE',
            monitorArnList: [anomalyMonitor.attrMonitorArn],
            subscribers: [{ type: 'SNS', address: this.alertTopic.topicArn }],
            thresholdExpression: JSON.stringify({
                Dimensions: {
                    Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
                    Values: [String(ANOMALY_IMPACT_THRESHOLD_USD)],
                    MatchOptions: ['GREATER_THAN_OR_EQUAL'],
                },
            }),
        });
        anomalySubscription.node.addDependency(topicPolicy);
    }
}
