/**
 * Non-TLS access to every SQS queue and SNS topic is DENIED by resource policy
 * (`AwsSolutions-SQS4` / `AwsSolutions-SNS3`, issue #143).
 *
 * | Invariant                                                                       | Test                                                          |
 * | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
 * | Every queue in the prod platform app denies `aws:SecureTransport: false`          | 'denies non-TLS access to every SQS queue'                    |
 * | Every topic likewise                                                             | 'denies non-TLS publishing to every SNS topic'                |
 * | The suite is not vacuous -- it sees the real resources                           | 'covers the queues and topics the platform actually defines'  |
 * | The cost-alert topic KEEPS its budgets/anomaly publish grants                     | 'keeps the budgets and cost-anomaly publish grants'           |
 * | ...in ONE policy, because two TopicPolicies on one topic clobber each other       | 'attaches exactly one TopicPolicy to the cost-alert topic'    |
 * | cdk-nag agrees: neither rule reports against the platform app                     | 'reports no AwsSolutions-SQS4 or -SNS3 finding'               |
 *
 * ## Why this is a fix and not a suppression
 *
 * The triage note was that "aws-sdk always uses TLS", which is true of the callers that exist TODAY and is
 * the wrong question. The rules ask for an explicit DENY, which is a property of the resource rather than of
 * its current clients: it holds for the next caller too -- a console action, an operator script, a
 * third-party integration, an SDK pointed at a custom endpoint. A resource policy costs nothing, so paying
 * zero for a control that survives a new caller is strictly better than documenting that today's callers
 * happen to behave.
 *
 * ## ⛔ The trap this suite exists to hold down
 *
 * `sns.Topic({ enforceSSL: true })` makes CDK lazily create a `Topic/Policy` construct. `CostAlertTopic`
 * ALREADY has a separately-constructed `sns.TopicPolicy` (ADR-0008: AWS Budgets and Cost Anomaly Detection
 * publish as service principals, so they need an explicit resource-policy grant). CDK does not know about
 * that hand-built policy, so setting `enforceSSL` there emits a SECOND `AWS::SNS::TopicPolicy` for the same
 * topic -- and `AWS::SNS::TopicPolicy` maps onto `SetTopicAttributes(Policy=...)`, which replaces the whole
 * document. Two of them means last-writer-wins, so the deploy could silently drop the budgets grant and the
 * only symptom would be cost alerts that never arrive -- exactly the alerting ADR-0008 added to catch
 * spend. So the deny statement is added to the EXISTING document there, and the last two tests below pin
 * both halves: the grants survive, and there is only ever one policy.
 *
 * SQS is the opposite case and needs no special handling: `Queue.addToResourcePolicy` (which both
 * `enforceSSL` and `SqsSubscription`'s SNS grant go through) reuses one singleton `Queue/Policy`.
 */
import { App, Aspects, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { attachSecurityChecks } from '@kitchensink/infra-security';
import { describe, expect, it } from 'vitest';

import { CostGuardrailsStack } from '../lib/platform/cost-guardrails-stack.js';
import { GlobalStack } from '../lib/platform/global-stack.js';

const env = { account: '123456789012', region: 'us-east-1' };

interface PolicyStatement {
    readonly Effect?: string;
    readonly Action?: string | string[];
    readonly Condition?: { Bool?: Record<string, unknown> };
    readonly Sid?: string;
    readonly Principal?: unknown;
}

/** Synthesizes the prod platform app plus the account-scoped cost-guardrails stack. */
function synthesizePlatform(): { templates: Record<string, Template>; warnings: string[] } {
    const app = new App();

    attachSecurityChecks(app);

    new GlobalStack(app, 'Global-prod', {
        env,
        stackName: 'kitchensink-global-prod',
        stage: 'prod',
        domainName: 'commise.app',
    });
    new CostGuardrailsStack(app, 'CostGuardrails', {
        env,
        stackName: 'kitchensink-cost-guardrails',
        alertEmail: 'alerts@example.com',
    });

    const assembly = app.synth();
    const templates = Object.fromEntries(
        assembly.stacks.map((stack) => [stack.stackName, Template.fromJSON(stack.template)]),
    );
    const warnings = assembly.stacks.flatMap((stack) =>
        stack.messages.filter((message) => message.level === 'warning').map((message) => message.entry.data as string),
    );

    return { templates, warnings };
}

const { templates, warnings } = synthesizePlatform();

/** Every resource of `type` across every synthesized stack, as `[stackName, logicalId, properties]`. */
const resourcesOfType = (type: string): Array<[string, string, Record<string, unknown>]> =>
    Object.entries(templates).flatMap(([stackName, template]) =>
        Object.entries(template.findResources(type)).map(
            ([logicalId, resource]) =>
                [stackName, logicalId, (resource as { Properties?: Record<string, unknown> }).Properties ?? {}] as [
                    string,
                    string,
                    Record<string, unknown>,
                ],
        ),
    );

/** Does this policy document carry a Deny on `aws:SecureTransport: false`? */
const deniesInsecureTransport = (document: unknown): boolean => {
    const statements = (document as { Statement?: PolicyStatement[] } | undefined)?.Statement ?? [];

    return statements.some(
        (statement) =>
            statement.Effect === 'Deny' &&
            statement.Condition?.Bool?.['aws:SecureTransport'] !== undefined &&
            String(statement.Condition.Bool['aws:SecureTransport']) === 'false',
    );
};

/** Logical ids of the queues/topics that a policy of `policyType` protects with a TLS deny. */
const tlsProtectedTargets = (policyType: string, targetKey: 'Queues' | 'Topics'): Set<string> => {
    const protectedTargets = new Set<string>();

    for (const [, , properties] of resourcesOfType(policyType)) {
        if (!deniesInsecureTransport(properties['PolicyDocument'])) {
            continue;
        }

        for (const target of (properties[targetKey] as unknown[]) ?? []) {
            // Both are `{ Ref: <logicalId> }` for an in-stack resource.
            const ref = (target as { Ref?: string }).Ref;

            if (ref) {
                protectedTargets.add(ref);
            }
        }
    }

    return protectedTargets;
};

describe('transport security on the platform message bus', () => {
    it('covers the queues and topics the platform actually defines', () => {
        // Guards every assertion below from passing because nothing was found.
        expect(resourcesOfType('AWS::SQS::Queue').map(([, id]) => id).length).toBeGreaterThanOrEqual(2);
        expect(resourcesOfType('AWS::SNS::Topic').map(([, id]) => id).length).toBeGreaterThanOrEqual(2);
    });

    it('denies non-TLS access to every SQS queue', () => {
        const guarded = tlsProtectedTargets('AWS::SQS::QueuePolicy', 'Queues');
        const unguarded = resourcesOfType('AWS::SQS::Queue')
            .filter(([, logicalId]) => !guarded.has(logicalId))
            .map(([stackName, logicalId]) => `${stackName}/${logicalId}`);

        expect(unguarded).toEqual([]);
    });

    it('denies non-TLS publishing to every SNS topic', () => {
        const guarded = tlsProtectedTargets('AWS::SNS::TopicPolicy', 'Topics');
        const unguarded = resourcesOfType('AWS::SNS::Topic')
            .filter(([, logicalId]) => !guarded.has(logicalId))
            .map(([stackName, logicalId]) => `${stackName}/${logicalId}`);

        expect(unguarded).toEqual([]);
    });

    it('attaches exactly one TopicPolicy to the cost-alert topic', () => {
        // See the header: a second AWS::SNS::TopicPolicy would REPLACE the document, so `enforceSSL` on
        // this topic would race the budgets grant. One policy, carrying both concerns.
        const policies = resourcesOfType('AWS::SNS::TopicPolicy').filter(
            ([stackName]) => stackName === 'kitchensink-cost-guardrails',
        );

        expect(policies).toHaveLength(1);
    });

    it('keeps the budgets and cost-anomaly publish grants', () => {
        // ADR-0008: without these the budget/anomaly subscription fails validation, and cost alerting -- the
        // thing that catches runaway spend -- silently stops.
        const [policy] = resourcesOfType('AWS::SNS::TopicPolicy').filter(
            ([stackName]) => stackName === 'kitchensink-cost-guardrails',
        );
        const statements =
            (policy?.[2]['PolicyDocument'] as { Statement?: PolicyStatement[] } | undefined)?.Statement ?? [];

        // A closed set, so the TLS deny is proven to COEXIST with the grants rather than replace them, and
        // so a future statement cannot be added to this topic without a reviewer seeing it here.
        expect(
            statements
                .map((statement) => statement.Sid)
                .filter(Boolean)
                .sort(),
        ).toEqual(['AllowBudgetsPublish', 'AllowCostAnomalyDetectionPublish', 'DenyInsecureTransport']);
        expect(deniesInsecureTransport(policy?.[2]['PolicyDocument'])).toBe(true);
    });

    it('reports no AwsSolutions-SQS4 or -SNS3 finding', () => {
        // The end-to-end check: cdk-nag's own rules agree, so the shape above is the shape the pack looks
        // for rather than merely a shape this suite likes.
        expect(warnings.filter((message) => message.includes('AwsSolutions-SQS4'))).toEqual([]);
        expect(warnings.filter((message) => message.includes('AwsSolutions-SNS3'))).toEqual([]);
    });
});
