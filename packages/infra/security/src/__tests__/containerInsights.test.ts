/**
 * The repository's ONE Container Insights tier decision — `containerInsightsForStage` (ADR-0007).
 *
 * | Invariant                                                          | Test                                                     |
 * | ------------------------------------------------------------------ | -------------------------------------------------------- |
 * | NO stage resolves to the ENHANCED tier any more                     | 'never returns the ENHANCED tier for any stage'           |
 * | prod runs STANDARD, not ENHANCED — the cost fix itself              | 'runs prod on the STANDARD tier'                          |
 * | An ephemeral `pr-{N}` stage runs no Container Insights at all       | 'disables Container Insights for an ephemeral pr-{N} …'   |
 * | A named non-prod stage keeps STANDARD                               | 'keeps STANDARD for named non-prod stages'                |
 * | `pr-` matching does not swallow a named stage that merely starts …  | 'does not treat a named stage beginning with "pr" as …'   |
 * | …and the proof is not vacuous: the value reaches ClusterSettings    | 'renders the resolved tier into AWS::ECS::Cluster'        |
 *
 * ## Why this exists at all, and why it is ONE function
 *
 * ADR-0007 dropped non-prod from ENHANCED to STANDARD Container Insights and deliberately left prod alone
 * ("unchanged → no prod diff"). The cost it was chasing then moved into the half it did not touch: by
 * 2026-08, `ECS/ContainerInsights` was 2,526 metric series and CloudWatch was $155/mo of a $484 bill, and
 * **2,048 of those series (81%) existed only because the three prod clusters were ENHANCED**.
 *
 * The ENHANCED tier adds `TaskId` and `ContainerName` dimensions. `TaskId` is UNBOUNDED cardinality: every
 * task launch mints ~23 brand-new billable custom metrics that never merge with the old ones. On
 * `food-service-prod` that is not theoretical — `FoodChangeRefresh` runs on `rate(6 hours)`, so 56 of the 70
 * task IDs observed in a two-week window came from one scheduled batch job whose per-task metrics nobody
 * reads. 1,812 of the 2,048 enhanced-only series were that one cluster.
 *
 * ## Why a shared resolver rather than a ternary in each stack
 *
 * "Which observability tier does stage X get" is ONE piece of knowledge with ONE reason to change (an
 * ADR-0007 cost ruling), and it was spelled out identically in three CDK stacks — the third occurrence, with
 * a proven shared reason to change, which is exactly the bar CLAUDE.md sets for extracting. Leaving it
 * triplicated while making it a THREE-way decision is how the ALB priority tables drifted (ADR-0003): a copy
 * of a rule cannot detect that the rule moved.
 *
 * ## Why ENHANCED is not reachable at all rather than left behind a flag
 *
 * A knob no caller sets is a presumptive feature (YAGNI). Nothing in this repo asks for per-container
 * metrics today, and re-enabling ENHANCED for a debugging session is a one-line edit. What is NOT cheap is
 * leaving a $100/mo default one typo away, so the tier simply is not offered.
 */
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Cluster, ContainerInsights } from 'aws-cdk-lib/aws-ecs';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { describe, expect, it } from 'vitest';

import { containerInsightsForStage } from '../containerInsights.js';

const EVERY_STAGE_SHAPE = ['prod', 'sandbox', 'dev', 'test', 'local', 'pr-1', 'pr-91', 'pr-15'];

describe('containerInsightsForStage (ADR-0007)', () => {
    it('never returns the ENHANCED tier for any stage', () => {
        for (const stage of EVERY_STAGE_SHAPE) {
            expect(containerInsightsForStage(stage)).not.toBe(ContainerInsights.ENHANCED);
        }
    });

    it('runs prod on the STANDARD tier', () => {
        expect(containerInsightsForStage('prod')).toBe(ContainerInsights.ENABLED);
    });

    it('disables Container Insights for an ephemeral pr-{N} stage', () => {
        expect(containerInsightsForStage('pr-91')).toBe(ContainerInsights.DISABLED);
        expect(containerInsightsForStage('pr-1')).toBe(ContainerInsights.DISABLED);
    });

    it('keeps STANDARD for named non-prod stages', () => {
        for (const stage of ['sandbox', 'dev', 'test', 'local']) {
            expect(containerInsightsForStage(stage)).toBe(ContainerInsights.ENABLED);
        }
    });

    it('does not treat a named stage beginning with "pr" as ephemeral', () => {
        expect(containerInsightsForStage('preview')).toBe(ContainerInsights.ENABLED);
        expect(containerInsightsForStage('production')).toBe(ContainerInsights.ENABLED);
    });

    it('renders the resolved tier into AWS::ECS::Cluster ClusterSettings', () => {
        const settingsFor = (stage: string): unknown => {
            const stack = new Stack(new App(), `S${stage.replace(/[^a-z0-9]/giu, '')}`, {
                env: { account: '123456789012', region: 'us-east-1' },
            });

            new Cluster(stack, 'C', {
                vpc: new Vpc(stack, 'V'),
                containerInsightsV2: containerInsightsForStage(stage),
            });

            return Object.values(Template.fromStack(stack).findResources('AWS::ECS::Cluster'))[0];
        };

        expect(settingsFor('prod')).toMatchObject({
            Properties: { ClusterSettings: [{ Name: 'containerInsights', Value: 'enabled' }] },
        });
        expect(settingsFor('pr-91')).toMatchObject({
            Properties: { ClusterSettings: [{ Name: 'containerInsights', Value: 'disabled' }] },
        });
    });
});
