/**
 * The repository's ONE Container Insights decision — `CONTAINER_INSIGHTS_TIER` (ADR-0007, amended twice).
 *
 * | Invariant                                                        | Test                                              |
 * | ---------------------------------------------------------------- | ------------------------------------------------- |
 * | Container Insights is OFF, on every cluster, in every stage       | 'is disabled, with no stage exempt'                |
 * | The ENHANCED tier remains unreachable                             | 'is never the ENHANCED tier'                       |
 * | …and the proof is not vacuous: the value reaches ClusterSettings  | 'renders as disabled in AWS::ECS::Cluster'         |
 *
 * ## Why this collapsed from a function to a constant (2026-08-30)
 *
 * ADR-0007 dropped non-prod from ENHANCED to STANDARD and left prod alone; the 2026-08-27 amendment took
 * prod to STANDARD too and disabled `pr-{N}` outright. What remained was ~136 billable series, all three of
 * them prod clusters — measured on 2026-08-30, an idle sandbox cluster published **zero** datapoints in 24h
 * and cost nothing, so the entire residual $40.80/month (136 × $0.30) was prod.
 *
 * The reason it is now off in prod is NOT "prod is unobserved". It is that **nothing consumes these metrics
 * anywhere**: every ECS alarm and every target-tracking autoscaling policy reads the free `AWS/ECS`
 * namespace (`CPUUtilization`), the ALB alarms read `AWS/ApplicationELB`, the sole CloudWatch dashboard
 * (`food-data`) references neither namespace, and no code in the repository queries
 * `ECS/ContainerInsights`. That reason is stage-independent, which is exactly why the stage parameter had
 * to go: a function that ignores its argument claims a decision it is no longer making.
 *
 * ⚠️ What is actually lost, so nobody rediscovers it as a bug: the per-service network, storage and task-
 * count series, and the Container Insights console view. Alarms, autoscaling and deploy health are
 * untouched — they never read this namespace. Re-enabling for a debugging session is a one-line edit here,
 * and `AwsSolutions-ECS4` will now report on every cluster: that finding is ACCURATE and is deliberately
 * left REPORTING rather than suppressed, because a cdk-nag suppression writes metadata into the
 * CloudFormation resource (ADR-0013) and prod template stability is load-bearing.
 */
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Cluster, ContainerInsights } from 'aws-cdk-lib/aws-ecs';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { describe, expect, it } from 'vitest';

import { CONTAINER_INSIGHTS_TIER } from '../containerInsights.js';

/** Every stage shape this repository deploys, named and ephemeral alike. */
const EVERY_STAGE_SHAPE = ['prod', 'sandbox', 'dev', 'test', 'local', 'preview', 'production', 'pr-1', 'pr-91'];

describe('CONTAINER_INSIGHTS_TIER (ADR-0007, amended 2026-08-30)', () => {
    it('is disabled, with no stage exempt', () => {
        expect(CONTAINER_INSIGHTS_TIER).toBe(ContainerInsights.DISABLED);
    });

    it('is never the ENHANCED tier', () => {
        expect(CONTAINER_INSIGHTS_TIER).not.toBe(ContainerInsights.ENHANCED);
    });

    it('renders as disabled in AWS::ECS::Cluster ClusterSettings, for every stage a cluster is built for', () => {
        const settingsFor = (stage: string): unknown => {
            const stack = new Stack(new App(), `S${stage.replace(/[^a-z0-9]/giu, '')}`, {
                env: { account: '123456789012', region: 'us-east-1' },
            });

            new Cluster(stack, 'C', { vpc: new Vpc(stack, 'V'), containerInsightsV2: CONTAINER_INSIGHTS_TIER });

            return Object.values(Template.fromStack(stack).findResources('AWS::ECS::Cluster'))[0];
        };

        for (const stage of EVERY_STAGE_SHAPE) {
            expect(settingsFor(stage)).toMatchObject({
                Properties: { ClusterSettings: [{ Name: 'containerInsights', Value: 'disabled' }] },
            });
        }
    });
});
