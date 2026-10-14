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
 * through CDK's bootstrap roles (`sts:AssumeRole` on `cdk-hnb659fds-*`). ⚠️ That is a limit of this commit,
 * not a security boundary: the shared bootstrap's CloudFormation execution role is `AdministratorAccess`, so
 * any role that may assume the deploy role can do anything in the account through a template. The tier
 * differences below bound the blast radius of a mistake, and the trust policy bounds who may become a role;
 * neither stops a malicious workflow on a trusted ref. ADR-0063 records the follow-up.
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
import { CfnOutput, DefaultStackSynthesizer, Duration, Stack, type StackProps, aws_iam as iam } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { PER_PR_NAME_PATTERN, teardownGrants } from '../sandbox-scheduler/teardownGrants.js';
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

/** Read a parameter or a parameter tree. */
const PARAMETER_READ_ACTIONS = ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'] as const;

/** Read a secret. */
const SECRET_READ_ACTIONS = ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'] as const;

/** What a job reads to observe a deploy. */
const OBSERVE_ACTIONS = [
    'logs:Describe*',
    'logs:GetLogEvents',
    'logs:FilterLogEvents',
    'rds:Describe*',
    'ec2:Describe*',
    'states:Describe*',
    'states:List*',
    'sns:Get*',
    'sns:List*',
    'sqs:Get*',
    'sqs:List*',
    'ecs:Describe*',
    'ecs:List*',
    'lambda:List*',
    'tag:GetResources',
] as const;

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

const bootstrapRoleArn = (scope: Scope, kind: string): string =>
    `arn:aws:iam::${scope.account}:role/cdk-${DefaultStackSynthesizer.DEFAULT_QUALIFIER}-${kind}-role-${scope.account}-${scope.region}`;

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

/** The bootstrap roles a deploying job may assume. Prod-read assumes only the lookup role. */
const CDK_ROLE_KINDS = ['deploy', 'file-publishing', 'image-publishing', 'lookup'] as const;

const permissionsNonprod = (role: iam.Role, scope: Scope): void => {
    const { account, region } = scope;
    const stack = (pattern: string): string => `arn:aws:cloudformation:${region}:${account}:stack/${pattern}`;
    const lambdaArn = (pattern: string): string => `arn:aws:lambda:${region}:${account}:function:${pattern}`;
    const previewZones = 'arn:aws:route53:::hostedzone/*';

    allow(
        role,
        ['sts:AssumeRole'],
        CDK_ROLE_KINDS.map((kind) => bootstrapRoleArn(scope, kind)),
    );
    allow(role, STACK_READ_ACTIONS, [stack('kitchensink-*/*')]);
    allow(role, ACCOUNT_LIST_ACTIONS, ['*']);

    for (const statement of teardownGrants(scope, 'CiTeardown')) {
        role.addToPolicy(statement);
    }

    allow(role, ['ecr:GetAuthorizationToken'], ['*']);
    // The repositories production pulls from are written here too: every preview pushes into them, and
    // `ecrEnsureRepo.sh` (re)applies their retention policy on every run.
    allow(role, IMAGE_REPOSITORY_ACTIONS, [`arn:aws:ecr:${region}:${account}:repository/kitchensink-*`]);
    // `teardownSandboxPr.sh` deletes what a PR left behind, by the same per-PR names `teardownGrants` uses.
    allow(role, ['ecr:DeleteRepository'], [`arn:aws:ecr:${region}:${account}:repository/${PER_PR_NAME_PATTERN}`]);
    allow(role, ['logs:DeleteLogGroup'], [`arn:aws:logs:${region}:${account}:log-group:*${PER_PR_NAME_PATTERN}`]);
    deny(role, ['logs:DeleteLogGroup', 'ecr:DeleteRepository'], ['*'], {
        StringEquals: { 'aws:ResourceTag/Environment': 'production' },
    });

    allow(role, FUNCTION_INVOKE_ACTIONS, [lambdaArn('kitchensink-*')]);
    // Defence in depth, not the boundary: function names are not uniformly stage-suffixed, so this denies what
    // is named for production and cannot claim to cover everything that is.
    deny(role, ['lambda:InvokeFunction', 'lambda:GetFunctionUrlConfig'], [lambdaArn('kitchensink-*-prod*')]);
    allow(
        role,
        PARAMETER_READ_ACTIONS,
        ['sandbox', 'pr-*'].map((tier) => `arn:aws:ssm:${region}:${account}:parameter/kitchensink/${tier}/*`),
    );
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
    // The remote-search tier reads the function URL that its distribution must be the only way into.
    allow(role, ['lambda:GetFunctionUrlConfig'], [lambdaArn('kitchensink-remote-search-*')]);
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
    allow(
        role,
        [...OBSERVE_ACTIONS, 'iam:Get*', 'iam:List*', 'cloudwatch:Describe*', 'cloudwatch:Get*', 'cloudwatch:List*'],
        ['*'],
    );
};

const permissionsProdRead = (role: iam.Role, scope: Scope): void => {
    const { account, region } = scope;
    const grants: readonly Grant[] = [
        { actions: ['sts:AssumeRole'], resources: [bootstrapRoleArn(scope, 'lookup')] },
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

    allow(
        role,
        ['sts:AssumeRole'],
        CDK_ROLE_KINDS.map((kind) => bootstrapRoleArn(scope, kind)),
    );
    allow(role, STACK_READ_ACTIONS, [`arn:aws:cloudformation:${region}:${account}:stack/kitchensink-*/*`]);
    allow(role, ACCOUNT_LIST_ACTIONS, ['*']);
    allow(role, ['ecr:GetAuthorizationToken'], ['*']);
    allow(role, IMAGE_REPOSITORY_ACTIONS, [`arn:aws:ecr:${region}:${account}:repository/kitchensink-*`]);
    allow(role, FUNCTION_INVOKE_ACTIONS, [`arn:aws:lambda:${region}:${account}:function:kitchensink-*`]);
    allow(
        role,
        [...PARAMETER_READ_ACTIONS, 'ssm:PutParameter'],
        [`arn:aws:ssm:${region}:${account}:parameter/kitchensink/prod/*`],
    );
    allow(role, SECRET_READ_ACTIONS, [`arn:aws:secretsmanager:${region}:${account}:secret:kitchensink/prod/*`]);
    allow(role, OBSERVE_ACTIONS, ['*']);
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
