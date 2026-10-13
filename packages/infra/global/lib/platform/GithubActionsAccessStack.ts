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
 * ## Scoping is by NAME, never by the `Environment` tag
 *
 * The account also runs another application whose stacks carry `Environment=production`, so a tag condition
 * would reach it. Every resource pattern here begins `kitchensink-` or sits under `/kitchensink/`.
 *
 * @pattern Registry — a `Record` over the tier union, so a tier with no role is a compile error
 * @pattern Abstract Factory — trust conditions come from `githubTrustConditions`, never written here
 * @see docs/architecture/decisions/0063-github-actions-aws-oidc-roles.md
 */
import { CfnOutput, Duration, Stack, type StackProps, aws_iam as iam } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import {
    GITHUB_OIDC_AUDIENCE,
    GITHUB_OIDC_ISSUER,
    githubTrustConditions,
    type GithubOidcTier,
} from './githubOidcTrust.js';

/** The hosted zone that holds `pr-{N}.sandbox.commise.app`. */
const PREVIEW_ZONE_ID = 'Z0474040RGDAGYCWHZ7M';
/** CDK bootstrap qualifier shared by every app in this account. */
const BOOTSTRAP_QUALIFIER = 'hnb659fds';
/** A CI session never needs longer than the longest job. */
const MAX_SESSION = Duration.hours(3);

/** Where a role's statements are written: the stack's account and region, resolved once. */
interface Scope {
    readonly account: string;
    readonly region: string;
}

/** One tier's role: its fixed name, why it exists, and the permissions it carries. */
interface TierSpec {
    readonly roleName: string;
    readonly description: string;
    readonly permissions: (role: iam.Role, scope: Scope) => void;
}

const bootstrapRoleArn = (scope: Scope, kind: string): string =>
    `arn:aws:iam::${scope.account}:role/cdk-${BOOTSTRAP_QUALIFIER}-${kind}-role-${scope.account}-${scope.region}`;

const allow = (
    role: iam.Role,
    actions: readonly string[],
    resources: readonly string[],
    conditions?: Record<string, Record<string, string[]>>,
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

const deny = (role: iam.Role, actions: readonly string[], resources: readonly string[]): void => {
    role.addToPolicy(
        new iam.PolicyStatement({ effect: iam.Effect.DENY, actions: [...actions], resources: [...resources] }),
    );
};

/** The bootstrap roles a deploying job may assume. Prod-read assumes only the lookup role. */
const CDK_ROLE_KINDS = ['deploy', 'file-publishing', 'image-publishing', 'lookup'] as const;

const permissionsNonprod = (role: iam.Role, scope: Scope): void => {
    const { account, region } = scope;
    const stack = (pattern: string): string => `arn:aws:cloudformation:${region}:${account}:stack/${pattern}`;
    const lambdaArn = (pattern: string): string => `arn:aws:lambda:${region}:${account}:function:${pattern}`;
    const ephemeral = ['sandbox', 'pr-*'];

    allow(
        role,
        ['sts:AssumeRole'],
        CDK_ROLE_KINDS.map((kind) => bootstrapRoleArn(scope, kind)),
    );
    allow(
        role,
        [
            'cloudformation:DescribeStacks',
            'cloudformation:DescribeStackEvents',
            'cloudformation:DescribeStackResources',
            'cloudformation:ListStackResources',
            'cloudformation:GetTemplate',
            'cloudformation:GetTemplateSummary',
        ],
        [stack('kitchensink-*/*')],
    );
    allow(role, ['cloudformation:ListStacks', 'cloudformation:ListExports'], ['*']);
    allow(
        role,
        ['cloudformation:DeleteStack'],
        ephemeral.map((tier) => stack(`kitchensink-*-${tier}/*`)),
    );
    allow(role, ['ecr:GetAuthorizationToken'], ['*']);
    allow(
        role,
        [
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
            'ecr:DeleteRepository',
            'ecr:TagResource',
            'ecr:PutLifecyclePolicy',
            'ecr:SetRepositoryPolicy',
        ],
        [`arn:aws:ecr:${region}:${account}:repository/kitchensink-*`],
    );
    allow(
        role,
        ['ecs:StopTask', 'ecs:DeleteService', 'ecs:UpdateService', 'ecs:DeleteCluster'],
        ephemeral.flatMap((tier) => [
            `arn:aws:ecs:${region}:${account}:cluster/kitchensink-*-${tier}`,
            `arn:aws:ecs:${region}:${account}:service/kitchensink-*-${tier}/*`,
            `arn:aws:ecs:${region}:${account}:task/kitchensink-*-${tier}/*`,
        ]),
    );
    allow(role, ['lambda:InvokeFunction', 'lambda:GetFunctionConfiguration'], [lambdaArn('kitchensink-*')]);
    // Defence in depth, not the boundary: function names are not uniformly stage-suffixed, so this denies what
    // is named for production and cannot claim to cover everything that is.
    deny(role, ['lambda:InvokeFunction'], [lambdaArn('kitchensink-*-prod*')]);
    allow(
        role,
        ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath', 'ssm:PutParameter', 'ssm:DeleteParameter'],
        ['sandbox', 'pr-*'].map((tier) => `arn:aws:ssm:${region}:${account}:parameter/kitchensink/${tier}/*`),
    );
    allow(
        role,
        ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
        [`arn:aws:secretsmanager:${region}:${account}:secret:kitchensink/sandbox/*`],
    );
    // A preview owns exactly its own CNAME: the apex, the `*.sandbox` wildcard and the shared identity host live
    // in the same zone and must stay unreachable from a pull request.
    allow(role, ['route53:ChangeResourceRecordSets'], [`arn:aws:route53:::hostedzone/${PREVIEW_ZONE_ID}`], {
        'ForAllValues:StringLike': {
            'route53:ChangeResourceRecordSetsNormalizedRecordNames': ['pr-*.sandbox.commise.app'],
        },
        'ForAllValues:StringEquals': { 'route53:ChangeResourceRecordSetsRecordTypes': ['CNAME'] },
    });
    allow(
        role,
        ['route53:ListResourceRecordSets', 'route53:GetHostedZone'],
        [`arn:aws:route53:::hostedzone/${PREVIEW_ZONE_ID}`],
    );
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
        ['logs:CreateLogGroup', 'logs:DeleteLogGroup', 'logs:PutRetentionPolicy', 'logs:TagResource'],
        [`arn:aws:logs:${region}:${account}:log-group:*kitchensink*`],
    );
    allow(
        role,
        [
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
            'iam:Get*',
            'iam:List*',
            'tag:GetResources',
            'cloudwatch:Describe*',
            'cloudwatch:Get*',
            'cloudwatch:List*',
        ],
        ['*'],
    );
};

const permissionsProdRead = (role: iam.Role, scope: Scope): void => {
    const { account, region } = scope;

    allow(role, ['sts:AssumeRole'], [bootstrapRoleArn(scope, 'lookup')]);
    allow(
        role,
        ['cloudformation:DescribeStacks', 'cloudformation:ListStackResources', 'cloudformation:GetTemplate'],
        [`arn:aws:cloudformation:${region}:${account}:stack/kitchensink-*/*`],
    );
    allow(role, ['cloudformation:ListStacks', 'cloudformation:ListExports'], ['*']);
    allow(
        role,
        ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
        [`arn:aws:ssm:${region}:${account}:parameter/kitchensink/prod/*`],
    );
    // A read-only role must not be able to read a SecureString, so it holds no key use at all, and every
    // write verb is denied outright rather than merely not granted.
    deny(
        role,
        [
            'kms:Decrypt',
            'ssm:PutParameter',
            'ssm:DeleteParameter',
            'secretsmanager:*',
            'cloudformation:CreateStack',
            'cloudformation:UpdateStack',
            'cloudformation:DeleteStack',
            'cloudformation:ExecuteChangeSet',
            'ecr:PutImage',
            'lambda:InvokeFunction',
            'lambda:UpdateFunctionCode',
            'ecs:UpdateService',
            'ecs:DeleteService',
            's3:PutObject',
            'iam:*',
        ],
        ['*'],
    );
};

const permissionsProd = (role: iam.Role, scope: Scope): void => {
    const { account, region } = scope;

    allow(
        role,
        ['sts:AssumeRole'],
        CDK_ROLE_KINDS.map((kind) => bootstrapRoleArn(scope, kind)),
    );
    allow(
        role,
        [
            'cloudformation:DescribeStacks',
            'cloudformation:DescribeStackEvents',
            'cloudformation:DescribeStackResources',
            'cloudformation:ListStackResources',
            'cloudformation:GetTemplate',
            'cloudformation:GetTemplateSummary',
        ],
        [`arn:aws:cloudformation:${region}:${account}:stack/kitchensink-*/*`],
    );
    allow(role, ['cloudformation:ListStacks', 'cloudformation:ListExports'], ['*']);
    allow(role, ['ecr:GetAuthorizationToken'], ['*']);
    allow(
        role,
        [
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
        ],
        [`arn:aws:ecr:${region}:${account}:repository/kitchensink-*`],
    );
    allow(
        role,
        ['lambda:InvokeFunction', 'lambda:GetFunctionConfiguration'],
        [`arn:aws:lambda:${region}:${account}:function:kitchensink-*`],
    );
    allow(
        role,
        ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath', 'ssm:PutParameter'],
        [`arn:aws:ssm:${region}:${account}:parameter/kitchensink/prod/*`],
    );
    allow(
        role,
        ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
        [`arn:aws:secretsmanager:${region}:${account}:secret:kitchensink/prod/*`],
    );
    allow(
        role,
        [
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
        ],
        ['*'],
    );
};

/** One entry per tier. A tier added to the union and not here is a compile error. */
const TIERS: Readonly<Record<GithubOidcTier, TierSpec>> = {
    nonprod: {
        roleName: 'kitchensink-gha-nonprod',
        description: 'GitHub Actions: pull-request checks, previews, the sandbox and its teardown',
        permissions: permissionsNonprod,
    },
    'prod-read': {
        roleName: 'kitchensink-gha-prod-read',
        description: 'GitHub Actions: read-only checks against production, run from main with no environment',
        permissions: permissionsProdRead,
    },
    prod: {
        roleName: 'kitchensink-gha-prod',
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
                roleName: spec.roleName,
                description: spec.description,
                maxSessionDuration: MAX_SESSION,
                assumedBy: new iam.WebIdentityPrincipal(
                    provider.oidcProviderArn,
                    githubTrustConditions(tier) as unknown as Record<string, Record<string, string | string[]>>,
                ),
            });

            spec.permissions(role, where);
            new CfnOutput(this, `RoleArn-${tier}`, { value: role.roleArn, description: spec.description });

            return role;
        };

        this.roles = { nonprod: build('nonprod'), 'prod-read': build('prod-read'), prod: build('prod') };
    }
}
