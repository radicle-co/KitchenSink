// ⚠️ DELIBERATE — see docs/architecture/decisions/0007-sandbox-cost-controls.md (amended 2026-08-27, and
// again 2026-08-30).
//
// THE Container Insights tier every ECS cluster in this repository runs. One value, one place.
//
// ## Why this is a constant and not a per-stage decision
//
// ADR-0007 dropped NON-PROD from ENHANCED to STANDARD and deliberately left prod untouched, to keep the
// prod template diff-free. The cost then concentrated in the half it did not touch, so the 2026-08-27
// amendment took prod to STANDARD as well and disabled `pr-{N}` outright.
//
// What survived that was ~136 billable series — **all of them prod**. Measured 2026-08-30: an idle sandbox
// cluster published ZERO datapoints in 24 hours and therefore cost nothing, while the three prod clusters
// published continuously at 4.6 metric-months/day, i.e. $40.80/month (136 × $0.30) of a $296 bill.
//
// ⛔ The reason it is now off in prod is NOT "prod is unobserved" — that would be a bad reason, and it is
// not the one. It is that **nothing anywhere consumes these metrics**:
//
//   - every ECS alarm and every target-tracking autoscaling policy reads the FREE `AWS/ECS` namespace
//     (`CPUUtilization`), not this one;
//   - the ALB 5xx and crash-loop alarms read `AWS/ApplicationELB`;
//   - the sole CloudWatch dashboard (`food-data`) references neither namespace;
//   - no code in this repository queries `ECS/ContainerInsights` — the only hits are ADR prose.
//
// That reason does not vary by stage, which is why the stage parameter is gone rather than defaulted. A
// function that ignores its argument still claims to be making a decision, and the next reader has to run
// the experiment to find out that it isn't.
//
// ## What this costs, stated plainly
//
// Lost: per-service network/storage/task-count series and the Container Insights console view. NOT lost:
// alarms, autoscaling, deploy health, or anything on the free namespaces. Re-enabling for a debugging
// session is a one-line edit here — which is the whole point of the value living in one place.
//
// ⚠️ `AwsSolutions-ECS4` ("cluster has Container Insights enabled") now reports on every cluster. That
// finding is ACCURATE and is deliberately left REPORTING, not suppressed: a cdk-nag suppression writes
// `Metadata.cdk_nag.rules_to_suppress` INTO the CloudFormation resource (ADR-0013), and prod template
// stability is what ADR-0002 and ADR-0008 stake data safety on. Same posture as ADR-0025's `L1`.
import { ContainerInsights } from 'aws-cdk-lib/aws-ecs';

/**
 * The Container Insights tier every ECS cluster in this repository is built with.
 *
 * Pass as `containerInsightsV2` on every `ecs.Cluster`. Deliberately not a function of stage — see the
 * module comment for the measurement and the reasoning.
 */
export const CONTAINER_INSIGHTS_TIER: ContainerInsights = ContainerInsights.DISABLED;
