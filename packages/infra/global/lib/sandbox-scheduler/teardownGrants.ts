/**
 * The teardown boundary (ADR-0061, ADR-0063): the stacks, ECS services and ECS tasks a role that tears the sandbox
 * down may delete, as IAM statements. Two roles hold it — the midnight reclaim Lambda's (`SandboxSchedulerStack`)
 * and CI's `kitchensink-gha-nonprod` (`GithubActionsAccessStack`, which runs `teardownSandboxPr.sh` and
 * `sandboxSharedTier.sh`) — and both are built from this one function, so the boundary has one owner.
 *
 * - **Per-PR stacks**: `kitchensink-*-pr-*` by NAME and `Environment=pr-*` by TAG, both required. The name pattern
 *   also matches names the planner refuses (`…-pr-91-old`); `reclaim.ts`'s anchored regex is the narrower rule,
 *   IAM the outer wall.
 * - **The shared tier**: EXACT stack names from {@link SHARED_TIER_DELETE_ORDER}, tagged `sandbox`. Nothing else
 *   ending in `-sandbox` — the database, the network, the webhooks — is reachable.
 * - **ECS**: services and tasks under a `kitchensink-…-pr-N-…` cluster; a service must also carry `Environment=pr-*`.
 *   The `kitchensink-` prefix is load-bearing: the account hosts another application with `-pr-` clusters, and
 *   `ecs:DeleteService` is irreversible.
 *   ⚠️ NOT on StopTask: a task carries no tag of its own, so the condition would deny every call, and the
 *   cluster-name pattern is the only wall there.
 * - **Two explicit Denies**: anything tagged `Environment=production`, and any `DeleteStack` that names a role.
 *
 * ⛔ A `DeleteStack` with no `RoleARN` runs as the stack's OWN saved role, so neither holder needs `iam:PassRole`,
 * and WHICH STACKS IT MAY NAME is the whole boundary.
 *
 * @pattern Factory — one function builds the boundary each holder attaches; the caller chooses only the Sid prefix
 * @see docs/architecture/decisions/0061-midnight-stop-reclaims-what-nothing-uses.md
 * @see docs/architecture/decisions/0063-github-actions-aws-oidc-roles.md
 */
import { aws_iam as iam } from 'aws-cdk-lib';

import { SHARED_TIER_DELETE_ORDER } from './reclaim.js';

/** A per-PR resource name: `kitchensink-<app>-pr-<N>…`, as an IAM pattern. */
export const PER_PR_NAME_PATTERN = 'kitchensink-*-pr-*';

/**
 * The `Environment` tag value every production stack carries. The CI role's denies key on it (here, and for Lambda
 * reads in `GithubActionsAccessStack`), so the string is written once.
 */
export const PRODUCTION_ENVIRONMENT_TAG = 'production';

/** Where the statements are written: an account and region, literal or a stack's tokens. */
export interface TeardownScope {
    readonly account: string;
    readonly region: string;
}

/**
 * The teardown boundary's statements, in a fixed order, each with a Sid of `sidPrefix` + a fixed suffix.
 *
 * @param scope - The account and region the ARNs name.
 * @param sidPrefix - Prepended to every Sid, so each holder's statements say whose they are.
 * @returns Four Allows and two Denies.
 */
export function teardownGrants(scope: TeardownScope, sidPrefix: string): readonly iam.PolicyStatement[] {
    const { account, region } = scope;
    const stackArn = (name: string): string => `arn:aws:cloudformation:${region}:${account}:stack/${name}/*`;

    return [
        new iam.PolicyStatement({
            sid: `${sidPrefix}DeletePerPrStacks`,
            actions: ['cloudformation:DeleteStack'],
            resources: [stackArn(PER_PR_NAME_PATTERN)],
            conditions: { StringLike: { 'aws:ResourceTag/Environment': 'pr-*' } },
        }),
        new iam.PolicyStatement({
            sid: `${sidPrefix}DeleteSharedTier`,
            actions: ['cloudformation:DeleteStack'],
            resources: SHARED_TIER_DELETE_ORDER.map(stackArn),
            conditions: { StringEquals: { 'aws:ResourceTag/Environment': 'sandbox' } },
        }),
        new iam.PolicyStatement({
            sid: `${sidPrefix}DeleteService`,
            actions: ['ecs:DeleteService'],
            resources: [`arn:aws:ecs:${region}:${account}:service/${PER_PR_NAME_PATTERN}/*`],
            conditions: { StringLike: { 'aws:ResourceTag/Environment': 'pr-*' } },
        }),
        new iam.PolicyStatement({
            sid: `${sidPrefix}StopTask`,
            actions: ['ecs:StopTask'],
            resources: [`arn:aws:ecs:${region}:${account}:task/${PER_PR_NAME_PATTERN}/*`],
        }),
        new iam.PolicyStatement({
            sid: `${sidPrefix}NeverProduction`,
            effect: iam.Effect.DENY,
            actions: ['cloudformation:DeleteStack', 'ecs:DeleteService', 'ecs:StopTask'],
            resources: ['*'],
            conditions: { StringEquals: { 'aws:ResourceTag/Environment': PRODUCTION_ENVIRONMENT_TAG } },
        }),
        new iam.PolicyStatement({
            sid: `${sidPrefix}NeverNamesARole`,
            effect: iam.Effect.DENY,
            actions: ['cloudformation:DeleteStack'],
            resources: ['*'],
            conditions: { Null: { 'cloudformation:RoleArn': 'false' } },
        }),
    ];
}
