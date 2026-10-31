/**
 * GitHub Actions' way into this AWS account (ADR-0063): one OIDC identity provider and three roles, so CI
 * holds no long-lived access key.
 *
 * ACCOUNT-scoped, like `CostGuardrailsStack`: there is exactly one provider per issuer per account, it
 * has no stage, and `bin/account.ts` is the app that builds it (asserted by `accountScopedInfra.test.ts`).
 *
 * ## Why direct permissions are small, and what that does NOT bound
 *
 * Each role carries only what a job does itself, and everything that creates or changes infrastructure goes
 * through CDK's bootstrap roles (`sts:AssumeRole` on the KitchenSink-owned `cdk-ksnonprod-*`, `cdk-ksprod-*` and,
 * for the production role alone, `cdk-ksaccount-*`). Those qualifiers carry a scoped execution policy and a
 * permissions boundary (ADR-0065), so the deploy path is bounded by what that policy admits. The default qualifier's
 * roles are the other application's and administrator-backed, and every role here is explicitly denied them.
 *
 * ## Scoping is by NAME, never by the `Environment` tag alone
 *
 * The account also runs another application whose stacks carry `Environment=production`, so a tag condition on
 * its own would reach it. Every resource pattern here begins `kitchensink-` or sits under `/kitchensink/`; where a
 * tag condition appears, it narrows a name pattern and never replaces one.
 *
 * ## What the non-prod role may destroy is not decided here
 *
 * Its stack, service and task deletes are `teardownGrants` — the one definition the midnight reclaim Lambda's role
 * also attaches (ADR-0061) — so CI's teardown can never reach a stack the reclaim refuses: the database, the
 * network and the webhooks stay out of reach although their names end in `-sandbox`. The log-group and image
 * deletes this file adds are narrowed to the same per-PR name pattern.
 *
 * @pattern Registry — a `Record` over the tier union, so a tier with no role is a compile error
 * @see docs/architecture/decisions/0063-github-actions-aws-oidc-roles.md
 */
import {
    ASSUMABLE_ROLE_KINDS,
    BOOTSTRAP_TRUST,
    DEFAULT_QUALIFIER,
    QUALIFIERS,
    bootstrapRoleArn,
    type AssumableRoleKind,
    type CiTier,
} from '@kitchensink/cdk-bootstrap/qualifiers';
import { CfnOutput, Duration, Stack, type StackProps, aws_iam as iam } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import {
    PER_PR_NAME_PATTERN,
    PRODUCTION_ENVIRONMENT_TAG,
    teardownGrants,
} from '../sandbox-scheduler/teardownGrants.js';
import {
    GITHUB_OIDC_AUDIENCE,
    GITHUB_OIDC_ISSUER,
    githubTrustConditions,
    type GithubOidcTier,
} from './githubOidcTrust.js';

/** A CI session never needs longer than the longest job. */
const MAX_SESSION = Duration.hours(3);

/**
 * Where `perPrDatabaseDrop.sh` records a per-PR database drop it owes (its `OWED_PREFIX`), the only parameters CI
 * writes. Held equal to the script by the stack test.
 */
const OWED_DROP_LEDGER = '/kitchensink/sandbox/owed-per-pr-database-drops';

/** Read a stack: its description, events, resources and template. */
const STACK_READ_ACTIONS = [
    'cloudformation:DescribeStacks',
    'cloudformation:DescribeStackEvents',
    'cloudformation:DescribeStackResources',
    'cloudformation:ListStackResources',
    'cloudformation:GetTemplate',
    'cloudformation:GetTemplateSummary',
] as const;

/** Account-wide listings. They have no resource type, so `*` is their only scope. */
const ACCOUNT_LIST_ACTIONS = ['cloudformation:ListStacks', 'cloudformation:ListExports'] as const;

/** What an image push and `ecrEnsureRepo.sh` do to a repository. Never a delete, never its access policy. */
const IMAGE_REPOSITORY_ACTIONS = [
    'ecr:BatchCheckLayerAvailability',
    'ecr:CompleteLayerUpload',
    'ecr:InitiateLayerUpload',
    'ecr:PutImage',
    'ecr:UploadLayerPart',
    'ecr:BatchGetImage',
    'ecr:GetDownloadUrlForLayer',
    'ecr:DescribeRepositories',
    'ecr:DescribeImages',
    'ecr:ListImages',
    'ecr:CreateRepository',
    'ecr:TagResource',
    'ecr:PutLifecyclePolicy',
] as const;

/** Invoke a function (a migration runner, the scheduler, a reaper) and read its configuration. */
const FUNCTION_INVOKE_ACTIONS = ['lambda:InvokeFunction', 'lambda:GetFunctionConfiguration'] as const;

/**
 * Every Lambda read whose response includes `Environment.Variables`. `ListFunctions` returns them for EVERY function
 * in the account, the other application's included, and cannot be scoped to a resource, so no role is granted it.
 */
const FUNCTION_ENVIRONMENT_READ_ACTIONS = [
    'lambda:GetFunction',
    'lambda:GetFunctionConfiguration',
    'lambda:ListFunctions',
    'lambda:ListVersionsByFunction',
] as const;

/** What the non-prod role may do to a function, and only to one in a stack named by {@link NONPROD_STACK_NAME_PATTERNS}. */
const NONPROD_FUNCTION_ACTIONS = [
    'lambda:InvokeFunction',
    'lambda:GetFunctionConfiguration',
    'lambda:GetFunctionUrlConfig',
] as const;

/**
 * The CloudFormation stacks whose functions the non-prod role may reach: the shared sandbox tier and per-PR stacks.
 * Matched against the `aws:cloudformation:stack-name` tag CloudFormation stamps on every function it creates — the
 * full stack name, which a generated function name's truncation can never shorten. Production stacks end `-prod`.
 */
export const NONPROD_STACK_NAME_PATTERNS = ['kitchensink-*-sandbox', PER_PR_NAME_PATTERN] as const;

/** Read a parameter or a parameter tree. */
const PARAMETER_READ_ACTIONS = ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'] as const;

/** The account-scoped log-drain DSN `WebhooksStack` resolves (`ssmParamPath('global', 'sentry', 'log-drain-dsn')`). */
const GLOBAL_LOG_DRAIN_DSN_PARAMETER = '/kitchensink/global/sentry/log-drain-dsn';

/** Read a secret. */
const SECRET_READ_ACTIONS = ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'] as const;

/**
 * What a job reads to observe a deploy: one NAMED action per command a CI job runs (ADR-0063), never a `Describe*`
 * wildcard. `GithubActionsAccessStack.test.ts` enumerates the commands and holds each role's set of observe actions
 * equal to them. A reader that returns a document (log events, an execution's input, instance user data, an IAM
 * account dump) is granted to no role; the one document reader left is `ecs:DescribeTaskDefinition`, which takes no
 * resource and which a deploy check needs (ADR-0063 records the residual).
 *
 * Resource scopes are the narrowest the service supports:
 * - ECS services, tasks and clusters: `kitchensink-*` clusters. `DescribeTaskDefinition` and `ListClusters` take no
 *   resource type, so `*` is their only scope.
 * - SQS and SNS: `kitchensink-*` names (CDK names every queue and topic from its stack, which starts `kitchensink-`).
 * - RDS, log groups and state machines: the account and region, not a name. A list call (`describe-db-instances`
 *   without an identifier, `describe-log-groups`) authorizes against the wildcard ARN, which a name pattern would
 *   refuse, and a CloudFormation-generated state machine name carries no `kitchensink-` prefix. Their responses are
 *   metadata (endpoints, retention, a definition), never log content or execution data.
 * - EC2 `DescribeInstances` and `tag:GetResources` take no resource type.
 *
 * No CI job reads log events, an alarm or a queue's messages, so none is granted.
 */
const observeGrants = ({ account, region }: Scope): readonly Grant[] => {
    const arn = (service: string, resource: string): string => `arn:aws:${service}:${region}:${account}:${resource}`;

    return [
        // `ListServices` is authorized against the service form `service/<cluster>/*`, not the cluster ARN.
        { actions: ['ecs:DescribeServices', 'ecs:ListServices'], resources: [arn('ecs', 'service/kitchensink-*/*')] },
        { actions: ['ecs:DescribeTasks'], resources: [arn('ecs', 'task/kitchensink-*/*')] },
        { actions: ['ecs:ListTasks'], resources: [arn('ecs', 'cluster/kitchensink-*')] },
        { actions: ['ecs:DescribeTaskDefinition', 'ecs:ListClusters'], resources: ['*'] },
        {
            actions: ['logs:DescribeLogGroups', 'logs:DescribeSubscriptionFilters'],
            resources: [arn('logs', 'log-group:*')],
        },
        { actions: ['rds:DescribeDBInstances'], resources: [arn('rds', 'db:*')] },
        { actions: ['rds:DescribeDBClusters'], resources: [arn('rds', 'cluster:*')] },
        { actions: ['ec2:DescribeInstances'], resources: ['*'] },
        { actions: ['sqs:GetQueueAttributes', 'sqs:GetQueueUrl'], resources: [arn('sqs', 'kitchensink-*')] },
        { actions: ['sns:GetTopicAttributes'], resources: [arn('sns', 'kitchensink-*')] },
        {
            actions: ['states:DescribeStateMachine', 'states:ListExecutions'],
            resources: [arn('states', 'stateMachine:*')],
        },
        { actions: ['tag:GetResources'], resources: ['*'] },
        // `food-loadtest.yml`'s collector samples the food queue gauges on every tier. The action takes no resource.
        { actions: ['cloudwatch:GetMetricStatistics'], resources: ['*'] },
        // The queue-guarantee tier reads the backstop role's policies (ADR-0041) at whatever stage it targets, so
        // both roles hold it. CloudFormation truncates a generated role name, which can drop the stage, so the role
        // is named by its logical id.
        {
            actions: ['iam:ListRolePolicies', 'iam:ListAttachedRolePolicies', 'iam:GetRolePolicy'],
            resources: [`arn:aws:iam::${account}:role/kitchensink-*QueueCheckRole*`],
        },
        { actions: ['iam:GetPolicy', 'iam:GetPolicyVersion'], resources: ['arn:aws:iam::aws:policy/*'] },
    ];
};

/** Where a role's statements are written: the stack's account and region, resolved once. */
interface Scope {
    readonly account: string;
    readonly region: string;
}

/**
 * Each tier's fixed role name. Exported because the CI side names the same roles: `.github/actions/awsAuth` maps a
 * tier to one of these, and `awsAuthPredicate.test.ts` holds that map equal to this one.
 */
export const GITHUB_ACTIONS_ROLE_NAMES: Readonly<Record<GithubOidcTier, string>> = {
    nonprod: 'kitchensink-gha-nonprod',
    'prod-read': 'kitchensink-gha-prod-read',
    prod: 'kitchensink-gha-prod',
};

/** One tier's role: why it exists, and the permissions it carries. Its name is {@link GITHUB_ACTIONS_ROLE_NAMES}. */
interface TierSpec {
    readonly description: string;
    readonly permissions: (role: iam.Role, scope: Scope) => void;
}

/** One Allow: the actions and the resources they act on. */
interface Grant {
    readonly actions: readonly string[];
    readonly resources: readonly string[];
}

/**
 * No docker asset exists in this repository (images are built and pushed by CI into `kitchensink-*` repositories and
 * referenced by name), so no CI role may assume an image-publishing role in any qualifier.
 * `cdkQualifierCoverage.test.ts` holds the asset side of that claim.
 */
const ASSUMED_KINDS: readonly AssumableRoleKind[] = ASSUMABLE_ROLE_KINDS.filter((kind) => kind !== 'image-publishing');

/**
 * The KitchenSink-owned bootstrap roles a tier may assume, read from the trust registry that also writes the
 * bootstrap templates' trust (`BOOTSTRAP_TRUST`), so the two sides of "who may assume which role" cannot disagree.
 * The account qualifier appears only under `prod`, whose role GitHub issues solely to a job bound to the
 * `Production` environment on `main`.
 */
const ownedBootstrapRoles = (scope: Scope, tier: CiTier): readonly string[] =>
    Object.values(QUALIFIERS).flatMap((qualifier) =>
        ASSUMED_KINDS.filter((kind) => BOOTSTRAP_TRUST[qualifier][kind].includes(tier)).map((kind) =>
            bootstrapRoleArn({ account: scope.account, region: scope.region, qualifier, kind }),
        ),
    );

/**
 * Every role of the default qualifier. They belong to the other application in this account and their execution role is
 * `AdministratorAccess`, so each CI role is explicitly denied them (the Deny wins over any Allow added later).
 */
const defaultQualifierRoles = (scope: Scope): string => `arn:aws:iam::${scope.account}:role/cdk-${DEFAULT_QUALIFIER}-*`;

const allow = (
    role: iam.Role,
    actions: readonly string[],
    resources: readonly string[],
    conditions?: Record<string, Record<string, string | readonly string[]>>,
): void => {
    role.addToPolicy(
        new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [...actions],
            resources: [...resources],
            conditions,
        }),
    );
};

const denyDefaultQualifier = (role: iam.Role, scope: Scope): void => {
    deny(role, ['sts:AssumeRole'], [defaultQualifierRoles(scope)]);
};

const deny = (
    role: iam.Role,
    actions: readonly string[],
    resources: readonly string[],
    conditions?: Record<string, Record<string, string>>,
): void => {
    role.addToPolicy(
        new iam.PolicyStatement({
            effect: iam.Effect.DENY,
            actions: [...actions],
            resources: [...resources],
            conditions,
        }),
    );
};

const permissionsNonprod = (role: iam.Role, scope: Scope): void => {
    const { account, region } = scope;
    const stack = (pattern: string): string => `arn:aws:cloudformation:${region}:${account}:stack/${pattern}`;
    const lambdaArn = (pattern: string): string => `arn:aws:lambda:${region}:${account}:function:${pattern}`;
    const previewZones = 'arn:aws:route53:::hostedzone/*';

    allow(role, ['sts:AssumeRole'], ownedBootstrapRoles(scope, 'nonprod'));
    denyDefaultQualifier(role, scope);
    allow(role, STACK_READ_ACTIONS, [stack('kitchensink-*/*')]);
    allow(role, ACCOUNT_LIST_ACTIONS, ['*']);

    for (const statement of teardownGrants(scope, 'CiTeardown')) {
        role.addToPolicy(statement);
    }

    allow(role, ['ecr:GetAuthorizationToken'], ['*']);
    // The repositories production pulls from are written here too: every preview pushes into them, and
    // `ecrEnsureRepo.sh` (re)applies their retention policy on every run. Their release tags are immutable, which
    // stops this role OVERWRITING a release tag but NOT writing a NEW one (ECR has no IAM condition on the tag). So a
    // tag's existence proves nothing to production: it skips a build only for a digest in its own release ledger
    // under `/kitchensink/prod/`, which this role cannot write (`ecrPushVerdict.sh`, `ecrRecordRelease.sh`). This role
    // cannot change the immutability setting either (the prod role can).
    allow(role, IMAGE_REPOSITORY_ACTIONS, [`arn:aws:ecr:${region}:${account}:repository/kitchensink-*`]);
    // `teardownSandboxPr.sh` deletes what a PR left behind, by the same per-PR names `teardownGrants` uses.
    allow(role, ['ecr:DeleteRepository'], [`arn:aws:ecr:${region}:${account}:repository/${PER_PR_NAME_PATTERN}`]);
    allow(role, ['logs:DeleteLogGroup'], [`arn:aws:logs:${region}:${account}:log-group:*${PER_PR_NAME_PATTERN}`]);
    deny(role, ['logs:DeleteLogGroup', 'ecr:DeleteRepository'], ['*'], {
        StringEquals: { 'aws:ResourceTag/Environment': 'production' },
    });

    // ⛔ A function's configuration holds its environment variables, and production's webhook functions carry secrets
    // there. The Allow therefore FAILS CLOSED on the stack-name tag (ADR-0063): a function with no such tag, or one
    // from a production stack or the other application, matches nothing. If Lambda ever stops supplying the tag, the
    // sandbox's deploy checks break loudly — a Deny on the same tag would silently stop applying instead.
    allow(role, NONPROD_FUNCTION_ACTIONS, [lambdaArn('kitchensink-*')], {
        StringLike: { 'aws:ResourceTag/aws:cloudformation:stack-name': NONPROD_STACK_NAME_PATTERNS },
    });
    // Extra layers over the Allow, neither the boundary: function names are not uniformly stage-suffixed, and the
    // production tier tag is absent from provider functions.
    deny(role, [...NONPROD_FUNCTION_ACTIONS, ...FUNCTION_ENVIRONMENT_READ_ACTIONS], [lambdaArn('kitchensink-*-prod*')]);
    deny(role, NONPROD_FUNCTION_ACTIONS, ['*'], {
        StringEquals: { 'aws:ResourceTag/Environment': PRODUCTION_ENVIRONMENT_TAG },
    });
    // The readers the Allow above does not name are refused outright, so a policy attached later cannot reopen them.
    deny(
        role,
        FUNCTION_ENVIRONMENT_READ_ACTIONS.filter(
            (action) => !(NONPROD_FUNCTION_ACTIONS as readonly string[]).includes(action),
        ),
        ['*'],
    );
    allow(
        role,
        PARAMETER_READ_ACTIONS,
        ['sandbox', 'pr-*'].map((tier) => `arn:aws:ssm:${region}:${account}:parameter/kitchensink/${tier}/*`),
    );
    // The one account-scoped value a sandbox stack resolves: `WebhooksStack`'s log-drain DSN. The per-stack deploy gate
    // reads every value a stack resolved to judge it current (`stackCurrency.sh`, ADR-0067), and without this read the
    // webhooks stack is judged stale and updated on every run. Exactly this name, and only `ssm:GetParameter`.
    allow(role, ['ssm:GetParameter'], [`arn:aws:ssm:${region}:${account}:parameter${GLOBAL_LOG_DRAIN_DSN_PARAMETER}`]);
    allow(
        role,
        ['ssm:PutParameter', 'ssm:DeleteParameter'],
        [`arn:aws:ssm:${region}:${account}:parameter${OWED_DROP_LEDGER}/*`],
    );
    allow(role, SECRET_READ_ACTIONS, [`arn:aws:secretsmanager:${region}:${account}:secret:kitchensink/sandbox/*`]);
    // CloudFormation names these two secrets without a stage, and prod's copies share the prefix, so a stack tag keeps
    // each grant on its sandbox stack.
    // ⛔ The database secret is the RDS MASTER credential, whose value only two functions may read (ADR-0039). CI only
    // describes it: `verifyDeployment.sh` checks that the ARN a deployed Lambda names exists.
    allow(
        role,
        ['secretsmanager:DescribeSecret'],
        [`arn:aws:secretsmanager:${region}:${account}:secret:DatabaseCredentialsSecret*`],
        { StringEquals: { 'secretsmanager:ResourceTag/aws:cloudformation:stack-name': 'kitchensink-data-sandbox' } },
    );
    // The remote-search deployed tier signs its probes with the sandbox key (`deployedSmoke.ts`).
    allow(role, SECRET_READ_ACTIONS, [`arn:aws:secretsmanager:${region}:${account}:secret:SigningKey*`], {
        StringEquals: {
            'secretsmanager:ResourceTag/aws:cloudformation:stack-name': 'kitchensink-remote-search-shared-sandbox',
        },
    });
    // `verifyDeployment.sh` runs `head-bucket` on every bucket a deployed Lambda names.
    allow(role, ['s3:ListBucket'], ['arn:aws:s3:::kitchensink-*-sandbox-*', 'arn:aws:s3:::kitchensink-*-pr-*']);
    // A preview owns exactly its own CNAME. The record name and type are the boundary, not the zone: the apex, the
    // `*.sandbox` wildcard and the shared identity host share the preview zone and fail both conditions.
    allow(role, ['route53:ChangeResourceRecordSets'], [previewZones], {
        'ForAllValues:StringLike': {
            'route53:ChangeResourceRecordSetsNormalizedRecordNames': 'pr-*.sandbox.commise.app',
        },
        'ForAllValues:StringEquals': { 'route53:ChangeResourceRecordSetsRecordTypes': 'CNAME' },
        // `ForAllValues` is true when its key is absent, so both keys must be present.
        Null: {
            'route53:ChangeResourceRecordSetsNormalizedRecordNames': 'false',
            'route53:ChangeResourceRecordSetsRecordTypes': 'false',
        },
    });
    allow(role, ['route53:ListResourceRecordSets', 'route53:GetHostedZone'], [previewZones]);
    allow(role, ['route53:ListHostedZones', 'route53:ListHostedZonesByName', 'route53:GetChange'], ['*']);
    allow(
        role,
        [
            'cloudfront-keyvaluestore:DescribeKeyValueStore',
            'cloudfront-keyvaluestore:GetKey',
            'cloudfront-keyvaluestore:ListKeys',
            'cloudfront-keyvaluestore:PutKey',
            'cloudfront-keyvaluestore:DeleteKey',
        ],
        // The store is addressed by an id CloudFormation generates, which a role cannot name before it exists.
        [`arn:aws:cloudfront::${account}:key-value-store/*`],
    );

    for (const grant of observeGrants(scope)) {
        allow(role, grant.actions, grant.resources);
    }
};

const permissionsProdRead = (role: iam.Role, scope: Scope): void => {
    const { account, region } = scope;
    const grants: readonly Grant[] = [
        {
            actions: ['sts:AssumeRole'],
            resources: ownedBootstrapRoles(scope, 'prod-read'),
        },
        {
            actions: [
                'cloudformation:DescribeStacks',
                'cloudformation:ListStackResources',
                'cloudformation:GetTemplate',
            ],
            resources: [`arn:aws:cloudformation:${region}:${account}:stack/kitchensink-*/*`],
        },
        { actions: ACCOUNT_LIST_ACTIONS, resources: ['*'] },
        {
            actions: PARAMETER_READ_ACTIONS,
            resources: [`arn:aws:ssm:${region}:${account}:parameter/kitchensink/prod/*`],
        },
    ];

    for (const grant of grants) {
        allow(role, grant.actions, grant.resources);
    }

    denyDefaultQualifier(role, scope);

    // Everything this role is not granted is denied, so a policy attached to it later cannot make it a writer, and
    // it cannot read a SecureString: `kms:Decrypt` is not one of its reads.
    role.addToPolicy(
        new iam.PolicyStatement({
            effect: iam.Effect.DENY,
            notActions: [...new Set(grants.flatMap((grant) => grant.actions))],
            resources: ['*'],
        }),
    );
};

const permissionsProd = (role: iam.Role, scope: Scope): void => {
    const { account, region } = scope;

    allow(role, ['sts:AssumeRole'], ownedBootstrapRoles(scope, 'prod'));
    denyDefaultQualifier(role, scope);
    allow(role, STACK_READ_ACTIONS, [`arn:aws:cloudformation:${region}:${account}:stack/kitchensink-*/*`]);
    allow(role, ACCOUNT_LIST_ACTIONS, ['*']);
    allow(role, ['ecr:GetAuthorizationToken'], ['*']);
    allow(role, IMAGE_REPOSITORY_ACTIONS, [`arn:aws:ecr:${region}:${account}:repository/kitchensink-*`]);
    // Release tags are immutable (`ecrEnsureRepo.sh`). Only this role may change a repository's mutability: the
    // non-prod role, which any branch's workflow can assume, could otherwise switch the protection off first.
    allow(role, ['ecr:PutImageTagMutability'], [`arn:aws:ecr:${region}:${account}:repository/kitchensink-*`]);
    allow(role, FUNCTION_INVOKE_ACTIONS, [`arn:aws:lambda:${region}:${account}:function:kitchensink-*`]);
    allow(
        role,
        [...PARAMETER_READ_ACTIONS, 'ssm:PutParameter'],
        [`arn:aws:ssm:${region}:${account}:parameter/kitchensink/prod/*`],
    );
    allow(role, SECRET_READ_ACTIONS, [`arn:aws:secretsmanager:${region}:${account}:secret:kitchensink/prod/*`]);
    // The same two auto-named secrets the non-prod role reaches, each kept on its prod stack by the stack tag.
    // ⛔ The database secret is the RDS MASTER credential (ADR-0039): `verifyDeployment.sh` only describes it.
    allow(
        role,
        ['secretsmanager:DescribeSecret'],
        [`arn:aws:secretsmanager:${region}:${account}:secret:DatabaseCredentialsSecret*`],
        { StringEquals: { 'secretsmanager:ResourceTag/aws:cloudformation:stack-name': 'kitchensink-data-prod' } },
    );
    // The remote-search smoke and its deployed tier sign their probes with the prod key (`deployedSmoke.ts`).
    allow(role, SECRET_READ_ACTIONS, [`arn:aws:secretsmanager:${region}:${account}:secret:SigningKey*`], {
        StringEquals: {
            'secretsmanager:ResourceTag/aws:cloudformation:stack-name': 'kitchensink-remote-search-shared-prod',
        },
    });
    // `verifyDeployment.sh` runs `head-bucket` on every bucket a deployed Lambda names.
    allow(role, ['s3:ListBucket'], ['arn:aws:s3:::kitchensink-*-prod-*']);
    // The remote-search smoke reads the function URL that its distribution must be the only way into.
    allow(
        role,
        ['lambda:GetFunctionUrlConfig'],
        [`arn:aws:lambda:${region}:${account}:function:kitchensink-remote-search-prod`],
    );

    for (const grant of observeGrants(scope)) {
        allow(role, grant.actions, grant.resources);
    }
};

/** One entry per tier. A tier added to the union and not here is a compile error. */
const TIERS: Readonly<Record<GithubOidcTier, TierSpec>> = {
    nonprod: {
        description: 'GitHub Actions: pull-request checks, previews, the sandbox and its teardown',
        permissions: permissionsNonprod,
    },
    'prod-read': {
        description: 'GitHub Actions: read-only checks against production, run from main with no environment',
        permissions: permissionsProdRead,
    },
    prod: {
        description: 'GitHub Actions: production deploys, only from main under the Production environment',
        permissions: permissionsProd,
    },
};

/** The GitHub OIDC provider and the three CI roles. */
export class GithubActionsAccessStack extends Stack {
    /** The role for each tier, keyed by tier. */
    public readonly roles: Readonly<Record<GithubOidcTier, iam.Role>>;

    public constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const provider = new iam.OidcProviderNative(this, 'GithubOidcProvider', {
            url: `https://${GITHUB_OIDC_ISSUER}`,
            clientIds: [GITHUB_OIDC_AUDIENCE],
        });
        const where: Scope = { account: this.account, region: this.region };

        const build = (tier: GithubOidcTier): iam.Role => {
            const spec = TIERS[tier];
            const role = new iam.Role(this, `Role-${tier}`, {
                roleName: GITHUB_ACTIONS_ROLE_NAMES[tier],
                description: spec.description,
                maxSessionDuration: MAX_SESSION,
                assumedBy: new iam.WebIdentityPrincipal(provider.oidcProviderArn, githubTrustConditions(tier)),
            });

            spec.permissions(role, where);
            new CfnOutput(this, `RoleArn-${tier}`, { value: role.roleArn, description: spec.description });

            return role;
        };

        this.roles = { nonprod: build('nonprod'), 'prod-read': build('prod-read'), prod: build('prod') };
    }
}
