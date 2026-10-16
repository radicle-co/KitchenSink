/**
 * ADR-0063: one OIDC provider and three roles, judged on the synthesized template.
 *
 * Trust is compared as exact strings, and permissions are judged by what each role is NOT allowed: a role
 * that gained `iam:*` or a write on the production parameter tree must fail here even though every
 * "can do X" assertion still passes.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { GithubActionsAccessStack } from '../lib/platform/GithubActionsAccessStack.js';
import { SHARED_TIER_DELETE_ORDER } from '../lib/sandbox-scheduler/reclaim.js';
import { OBSERVE_SERVICE, OBSERVE_TIERS, TEARDOWN, observeCommands, type ObserveTier } from './ciAwsCommands.js';
import { policyAdmits, policyAdmitsTagged, type PolicyStatementJson } from './iamGlob.js';
import { repoRoot } from './serviceSources.js';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };
const ISSUER = 'token.actions.githubusercontent.com';

const template = (): Template =>
    Template.fromStack(new GithubActionsAccessStack(testApp(), 'GithubActionsAccess', { env }));

type Json = Record<string, unknown>;

const rolesByName = (t: Template): Record<string, Json> => {
    const out: Record<string, Json> = {};

    for (const resource of Object.values(t.findResources('AWS::IAM::Role'))) {
        const props = resource['Properties'] as Json;
        out[props['RoleName'] as string] = props;
    }

    return out;
};

const trustCondition = (role: Json): Json => {
    const statements = ((role['AssumeRolePolicyDocument'] as Json)['Statement'] as Json[]) ?? [];

    expect(statements).toHaveLength(1);

    return statements[0]?.['Condition'] as Json;
};

type Statement = PolicyStatementJson;

/** Every statement of every inline/managed policy attached to a role, found by the role's logical id. */
const statementsOf = (t: Template, roleName: string): readonly Statement[] => {
    const roles = t.findResources('AWS::IAM::Role', { Properties: { RoleName: roleName } });
    const logicalId = Object.keys(roles)[0];
    const policies = Object.values(t.findResources('AWS::IAM::Policy')).filter((policy) =>
        JSON.stringify((policy['Properties'] as Json)['Roles']).includes(`"${logicalId}"`),
    );

    return policies.flatMap(
        (policy) => (((policy['Properties'] as Json)['PolicyDocument'] as Json)['Statement'] as Statement[]) ?? [],
    );
};

const asList = (value: string | readonly string[] | undefined): readonly string[] =>
    value === undefined ? [] : typeof value === 'string' ? [value] : value;

/** The `Action` entries of every statement with this effect. A `NotAction` statement contributes none. */
const actionsOf = (statements: readonly Statement[], effect: string): readonly string[] =>
    statements.filter((s) => s.Effect === effect).flatMap((s) => asList(s.Action));

const CLASSIC = 'repo:radicle-co/KitchenSink';
const NEW_FORM = 'repo:radicle-co@69129769/KitchenSink@1203438406';

describe('GithubActionsAccessStack: the provider', () => {
    it('declares exactly one OIDC provider for GitHub, with the STS audience', () => {
        const t = template();

        t.resourceCountIs('AWS::IAM::OIDCProvider', 1);
        t.hasResourceProperties('AWS::IAM::OIDCProvider', {
            Url: `https://${ISSUER}`,
            ClientIdList: ['sts.amazonaws.com'],
        });
    });

    it('creates no custom-resource Lambda to do it', () => {
        const t = template();

        t.resourceCountIs('AWS::Lambda::Function', 0);
        t.resourceCountIs('Custom::AWSCDKOpenIdConnectProvider', 0);
    });

    it('creates exactly three roles, named by the tier registry', () => {
        expect(Object.keys(rolesByName(template())).sort()).toEqual([
            'kitchensink-gha-nonprod',
            'kitchensink-gha-prod',
            'kitchensink-gha-prod-read',
        ]);
    });

    it('gives every role a three-hour maximum session and exports its ARN', () => {
        const t = template();

        for (const role of Object.values(rolesByName(t))) {
            expect(role['MaxSessionDuration']).toBe(10800);
        }

        expect(Object.keys(t.toJSON()['Outputs'] as Json)).toHaveLength(3);
    });
});

describe('GithubActionsAccessStack: trust, as exact strings', () => {
    const k = (claim: string): string => `${ISSUER}:${claim}`;

    it('every role federates through the provider and pins aud, repository id and owner id', () => {
        const t = template();

        for (const role of Object.values(rolesByName(t))) {
            const statement = ((role['AssumeRolePolicyDocument'] as Json)['Statement'] as Json[])[0] as Json;
            const condition = trustCondition(role);
            const equals = condition['StringEquals'] as Json;

            expect(statement['Action']).toBe('sts:AssumeRoleWithWebIdentity');
            expect(JSON.stringify(statement['Principal'])).toContain('GithubOidcProvider');
            expect(equals[k('aud')]).toBe('sts.amazonaws.com');
            expect(equals[k('repository_id')]).toBe('1203438406');
            expect(equals[k('repository_owner_id')]).toBe('69129769');
        }
    });

    it('nonprod trusts any job of this repository, in both subject forms, and nothing else', () => {
        const condition = trustCondition(rolesByName(template())['kitchensink-gha-nonprod'] as Json);

        expect((condition['StringLike'] as Json)[k('sub')]).toEqual([`${CLASSIC}:*`, `${NEW_FORM}:*`]);
    });

    it('prod-read trusts main without an environment', () => {
        const condition = trustCondition(rolesByName(template())['kitchensink-gha-prod-read'] as Json);
        const equals = condition['StringEquals'] as Json;

        expect(equals[k('sub')]).toEqual([`${CLASSIC}:ref:refs/heads/main`, `${NEW_FORM}:ref:refs/heads/main`]);
        expect(equals[k('ref')]).toBe('refs/heads/main');
        expect(condition['StringLike']).toBeUndefined();
    });

    it('prod trusts only the Production environment on main', () => {
        const condition = trustCondition(rolesByName(template())['kitchensink-gha-prod'] as Json);
        const equals = condition['StringEquals'] as Json;

        expect(equals[k('sub')]).toEqual([`${CLASSIC}:environment:Production`, `${NEW_FORM}:environment:Production`]);
        expect(equals[k('environment')]).toBe('Production');
        expect(equals[k('ref')]).toBe('refs/heads/main');
        expect(condition['StringLike']).toBeUndefined();
    });
});

describe('GithubActionsAccessStack: what no role may do', () => {
    const t = template();
    const names = ['kitchensink-gha-nonprod', 'kitchensink-gha-prod-read', 'kitchensink-gha-prod'] as const;

    it.each(names)('%s: has no iam:* or organizations:* and no Allow on every action', (name) => {
        const allowed = actionsOf(statementsOf(t, name), 'Allow');

        expect(allowed.length).toBeGreaterThan(0);

        for (const action of allowed) {
            expect(action).not.toMatch(/^(iam|organizations):\*$/u);
            expect(action).not.toBe('*');
            expect(action).not.toMatch(/^iam:(Create|Put|Attach|Update|Delete|PassRole)/u);
        }
    });

    it('nonprod: nothing it is granted names the production parameter or secret tree', () => {
        const resources = JSON.stringify(
            statementsOf(t, 'kitchensink-gha-nonprod')
                .filter((s) => s.Effect === 'Allow')
                .map((s) => s.Resource),
        );

        expect(resources).not.toContain('/kitchensink/prod');
        expect(resources).not.toContain('kitchensink/prod');
        expect(resources).toContain('/kitchensink/sandbox/');
    });

    // The record-name and record-type conditions are the boundary, so the zone is `hostedzone/*` and no zone id is
    // written into the template: a CNAME named `pr-*.sandbox.commise.app` is all this role may change, in any zone.
    it('nonprod: may change DNS records only for pr-*.sandbox.commise.app, as CNAME, by condition', () => {
        const change = statementsOf(t, 'kitchensink-gha-nonprod').filter((s) =>
            asList(s.Action).includes('route53:ChangeResourceRecordSets'),
        );

        expect(change).toHaveLength(1);
        expect(change[0]?.Effect).toBe('Allow');
        expect(change[0]?.Resource).toBe('arn:aws:route53:::hostedzone/*');
        expect(change[0]?.Condition).toEqual({
            'ForAllValues:StringLike': {
                'route53:ChangeResourceRecordSetsNormalizedRecordNames': 'pr-*.sandbox.commise.app',
            },
            'ForAllValues:StringEquals': { 'route53:ChangeResourceRecordSetsRecordTypes': 'CNAME' },
            // `ForAllValues` is TRUE when the key is absent, so without `Null` a request that carries no record names
            // would pass both conditions in every zone of the account, the other application's included.
            Null: {
                'route53:ChangeResourceRecordSetsNormalizedRecordNames': 'false',
                'route53:ChangeResourceRecordSetsRecordTypes': 'false',
            },
        });
    });

    it('prod-read: grants no write and assumes only the lookup role', () => {
        const statements = statementsOf(t, 'kitchensink-gha-prod-read');
        const allowed = actionsOf(statements, 'Allow');

        for (const action of allowed) {
            expect(action).not.toMatch(
                /:(Create|Put|Delete|Update|Stop|Start|Invoke|Tag|Untag|Attach|Detach|Run|Change|Modify|Set|Register|Deregister|Send|Publish)/u,
            );
        }

        const assume = statements.filter((s) => asList(s.Action).includes('sts:AssumeRole'));
        const resources = JSON.stringify(assume.map((s) => s.Resource));

        expect(assume).toHaveLength(1);
        expect(resources).toContain('cdk-hnb659fds-lookup-role-');
        expect(resources).not.toContain('deploy-role');
        expect(resources).not.toContain('publishing-role');
    });

    // The guarantee is "everything it is not granted is denied", so the Deny is a NotAction over exactly the granted
    // reads: a policy attached to this role later cannot add a write, and `kms:Decrypt` (which a SecureString read
    // needs) is denied because it is not one of the reads.
    it('prod-read: denies kms:Decrypt and every write, by denying everything but its own reads', () => {
        const statements = statementsOf(t, 'kitchensink-gha-prod-read');
        const denies = statements.filter((s) => s.Effect === 'Deny');
        const granted = new Set(actionsOf(statements, 'Allow'));

        expect(denies).toHaveLength(1);
        expect(denies[0]?.Action).toBeUndefined();
        expect(denies[0]?.Resource).toBe('*');
        expect(denies[0]?.Condition).toBeUndefined();
        expect(new Set(asList(denies[0]?.NotAction))).toEqual(granted);
        expect(granted.has('kms:Decrypt')).toBe(false);
        expect(granted.has('sts:AssumeRole')).toBe(true);

        for (const write of ['kms:Decrypt', 'ssm:PutParameter', 'cloudformation:DeleteStack', 'iam:PassRole']) {
            expect(policyAdmits(statements, write, '*')).toBe(false);
        }
    });

    it('prod: has no teardown action', () => {
        const allowed = actionsOf(statementsOf(t, 'kitchensink-gha-prod'), 'Allow');

        expect(allowed).not.toContain('cloudformation:DeleteStack');
        expect(allowed).not.toContain('ecs:DeleteService');
        expect(allowed).not.toContain('ecr:DeleteRepository');
        expect(allowed).toContain('sts:AssumeRole');
    });

    it('prod: its parameters and secrets are the prod trees', () => {
        const resources = JSON.stringify(
            statementsOf(t, 'kitchensink-gha-prod')
                .filter((s) => s.Effect === 'Allow')
                .map((s) => s.Resource),
        );

        expect(resources).toContain('/kitchensink/prod/');
        expect(resources).not.toContain('/kitchensink/sandbox/');
    });
});

/**
 * SCQ-1: the non-prod role's DESTRUCTIVE grants, evaluated with IAM wildcard semantics against the real names the
 * repository's own teardown rules forbid (`sandboxSharedTier.sh`'s "What is NOT in the list", ADR-0004's lesson
 * of deleted production log groups, the image repositories production pulls from) and against the names CI must
 * keep reaching. Each row is (action, resource, admitted); conditions are ignored, so a refusal here always comes
 * from a resource pattern, never from a tag.
 */
describe('GithubActionsAccessStack: the auto-named sandbox secrets', () => {
    // CloudFormation names these secrets without a stage (prod's copies share the prefix), so the stack tag is the
    // only thing that keeps each grant off production. The glob matcher ignores conditions, so the tag is asserted here.
    const tag = 'secretsmanager:ResourceTag/aws:cloudformation:stack-name';
    const grantOn = (pattern: RegExp): Statement[] =>
        statementsOf(template(), 'kitchensink-gha-nonprod').filter((s) =>
            asList(s.Resource).some((r) => pattern.test(String(r))),
        );

    // ⛔ The database secret is the RDS MASTER credential: ADR-0039 lets exactly two functions read its value. CI only
    // describes it (`verifyDeployment.sh` probes that the ARN a Lambda names exists).
    it('nonprod may only describe the sandbox database master secret, never read its value', () => {
        const grants = grantOn(/secret:DatabaseCredentialsSecret/);

        expect(grants).toHaveLength(1);
        expect(grants[0]?.Effect).toBe('Allow');
        expect(asList(grants[0]?.Action)).toEqual(['secretsmanager:DescribeSecret']);
        expect(grants[0]?.Condition).toEqual({ StringEquals: { [tag]: 'kitchensink-data-sandbox' } });
    });

    it('nonprod reads the remote-search signing key only of the sandbox remote-search stack', () => {
        const grants = grantOn(/secret:SigningKey/);

        expect(grants).toHaveLength(1);
        expect([...asList(grants[0]?.Action)].sort()).toEqual([
            'secretsmanager:DescribeSecret',
            'secretsmanager:GetSecretValue',
        ]);
        expect(grants[0]?.Condition).toEqual({ StringEquals: { [tag]: 'kitchensink-remote-search-shared-sandbox' } });
    });
});

/**
 * What the production jobs read besides a deploy, each from a named caller: `verifyDeployment.sh` probes every bucket
 * and secret a deployed Lambda names, the remote-search smoke and its deployed tier read the signing key and the
 * function URL, the queue-guarantee tier reads the backstop role's policies, and `food-loadtest.yml`'s collector reads
 * metrics. Each row is (action, resource, admitted) under IAM wildcard semantics; conditions are asserted separately.
 */
describe('GithubActionsAccessStack: the prod role reads what its jobs verify, and only by name', () => {
    const t = template();
    const prod = statementsOf(t, 'kitchensink-gha-prod');
    const { account, region } = env;
    const secret = (name: string): string => `arn:aws:secretsmanager:${region}:${account}:secret:${name}`;
    const fn = (name: string): string => `arn:aws:lambda:${region}:${account}:function:${name}`;
    const role = (name: string): string => `arn:aws:iam::${account}:role/${name}`;
    // CloudFormation truncates a generated role name, so the stage can be gone from it: these are the real names.
    const QUEUE_CHECK_ROLES = [
        'kitchensink-identity-webhook-QueueCheckRole90B692FA-2DBSgcLuW1AJ',
        'kitchensink-recipe-workers-p-QueueCheckRole90B692FA-blEhaaA5OyQT',
    ];

    const rows: readonly (readonly [string, string, boolean])[] = [
        ['s3:ListBucket', 'arn:aws:s3:::kitchensink-data-prod-mediabucketbcbb02ba-0000000000aa', true],
        ['s3:ListBucket', 'arn:aws:s3:::kitchensink-data-prod-archivebucket9decbf5d-0000000000aa', true],
        ['s3:ListBucket', 'arn:aws:s3:::kitchensink-data-sandbox-mediabucketbcbb02ba-h6ybojnuslif', false],
        ['s3:ListBucket', 'arn:aws:s3:::armoury-production-assets', false],
        ['s3:GetObject', 'arn:aws:s3:::kitchensink-data-prod-mediabucketbcbb02ba-0000000000aa/a.jpg', false],

        // ⛔ The RDS master credential: described, never read (ADR-0039).
        ['secretsmanager:DescribeSecret', secret('DatabaseCredentialsSecret74-JXzjVhUdYcPm'), true],
        ['secretsmanager:GetSecretValue', secret('DatabaseCredentialsSecret74-JXzjVhUdYcPm'), false],
        ['secretsmanager:GetSecretValue', secret('SigningKeyASecretB1C2D3E4-AbCdEf'), true],
        ['secretsmanager:GetSecretValue', secret('armoury/production/api-key-AbCdEf'), false],
        ['secretsmanager:PutSecretValue', secret('SigningKeyASecretB1C2D3E4-AbCdEf'), false],

        ['lambda:GetFunctionUrlConfig', fn('kitchensink-remote-search-prod'), true],
        ['lambda:GetFunctionUrlConfig', fn('kitchensink-remote-search-pr-91'), false],
        ['lambda:GetFunctionUrlConfig', fn('armoury-production-api'), false],

        ...QUEUE_CHECK_ROLES.flatMap((name) => [
            ['iam:ListRolePolicies', role(name), true] as const,
            ['iam:ListAttachedRolePolicies', role(name), true] as const,
            ['iam:GetRolePolicy', role(name), true] as const,
            ['iam:PutRolePolicy', role(name), false] as const,
            ['iam:AttachRolePolicy', role(name), false] as const,
        ]),
        ['iam:GetRolePolicy', role('kitchensink-gha-prod'), false],
        ['iam:GetRolePolicy', role('armoury-production-api-role'), false],
        ['iam:GetPolicy', 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole', true],
        ['iam:GetPolicyVersion', 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole', true],
        ['iam:GetPolicyVersion', `arn:aws:iam::${account}:policy/armoury-production-policy`, false],

        ['cloudwatch:GetMetricStatistics', '*', true],
        ['cloudwatch:PutMetricData', '*', false],
        ['cloudwatch:DeleteAlarms', '*', false],
    ];

    it.each(rows)('%s on %s -> admitted=%s', (action, resource, expected) => {
        expect(policyAdmits(prod, action, resource)).toBe(expected);
    });

    // CloudFormation names these secrets without a stage, so the stack tag is what keeps each grant off sandbox and
    // off the other application. The glob matcher ignores conditions, so the tag is asserted here.
    const tag = 'secretsmanager:ResourceTag/aws:cloudformation:stack-name';
    const grantOn = (pattern: RegExp): Statement[] =>
        prod.filter((s) => s.Effect === 'Allow' && asList(s.Resource).some((r) => pattern.test(String(r))));

    it('describes the database master secret only of kitchensink-data-prod', () => {
        const grants = grantOn(/secret:DatabaseCredentialsSecret/);

        expect(grants).toHaveLength(1);
        expect(asList(grants[0]?.Action)).toEqual(['secretsmanager:DescribeSecret']);
        expect(grants[0]?.Condition).toEqual({ StringEquals: { [tag]: 'kitchensink-data-prod' } });
    });

    it('reads the remote-search signing key only of kitchensink-remote-search-shared-prod', () => {
        const grants = grantOn(/secret:SigningKey/);

        expect(grants).toHaveLength(1);
        expect([...asList(grants[0]?.Action)].sort()).toEqual([
            'secretsmanager:DescribeSecret',
            'secretsmanager:GetSecretValue',
        ]);
        expect(grants[0]?.Condition).toEqual({ StringEquals: { [tag]: 'kitchensink-remote-search-shared-prod' } });
    });
});

describe('GithubActionsAccessStack: the non-prod role reaches only what CI tears down', () => {
    const t = template();
    const nonprod = statementsOf(t, 'kitchensink-gha-nonprod');
    const { account, region } = env;
    const stack = (name: string): string =>
        `arn:aws:cloudformation:${region}:${account}:stack/${name}/0f1e2d3c-aaaa-bbbb-cccc-0123456789ab`;
    const logGroup = (name: string): string => `arn:aws:logs:${region}:${account}:log-group:${name}`;
    const repository = (name: string): string => `arn:aws:ecr:${region}:${account}:repository/${name}`;
    const parameter = (name: string): string => `arn:aws:ssm:${region}:${account}:parameter${name}`;
    const ecs = (kind: 'service' | 'task', cluster: string): string =>
        `arn:aws:ecs:${region}:${account}:${kind}/${cluster}/leaf`;

    const SHARED_REPOSITORIES = ['kitchensink-identity', 'kitchensink-food', 'kitchensink-recipes'] as const;
    const PER_PR_CLUSTER = 'kitchensink-food-service-pr-91-FoodServiceCluster442EDB29-QR9FHWWoNVeo';
    const SANDBOX_CLUSTER = 'kitchensink-identity-service-sandbox-IdentityServiceCluster3A4949E2-jZ';

    const refusedLogGroups = [
        '/kitchensink/identity-service/prod',
        '/aws/lambda/kitchensink-recipe-workers-prod',
        '/kitchensink/identity-service/sandbox',
        '/aws/ecs/containerinsights/kitchensink-food-service-prod-FoodServiceCluster442EDB29-xRt2eYoDUrGB/performance',
        'kitchensink-food-service-prod-FoodApiLogGroup317D8769-Ab12Cd34Ef56',
        'kitchensink-identity-webhooks-sandbox-WebhooksLogGroupA05F4FC6-Ab12Cd34Ef56',
        'kitchensink-data-sandbox-DbBootstrapLogGroupAF64F8C3-Ab12Cd34Ef56',
    ];
    const admittedLogGroups = [
        '/aws/lambda/kitchensink-recipe-workers-pr-91',
        '/aws/ecs/containerinsights/kitchensink-food-service-pr-91-FoodServiceCluster442EDB29-QR9FHWWoNVeo/performance',
        'kitchensink-food-service-pr-91-FoodApiLogGroup317D8769-Ab12Cd34Ef56',
    ];

    const rows: readonly (readonly [string, string, boolean])[] = [
        ['cloudformation:DeleteStack', stack('kitchensink-data-sandbox'), false],
        ['cloudformation:DeleteStack', stack('kitchensink-network-sandbox'), false],
        ['cloudformation:DeleteStack', stack('kitchensink-identity-webhooks-sandbox'), false],
        ['cloudformation:DeleteStack', stack('kitchensink-food-service-prod'), false],
        ['cloudformation:DeleteStack', stack('kitchensink-food-pr-91'), true],
        ...SHARED_TIER_DELETE_ORDER.map((name) => ['cloudformation:DeleteStack', stack(name), true] as const),

        // A log group is authorized both as `NAME` and as `NAME:*`, so each name is judged in both forms.
        ...refusedLogGroups.flatMap((name) => [
            ['logs:DeleteLogGroup', logGroup(name), false] as const,
            ['logs:DeleteLogGroup', logGroup(`${name}:*`), false] as const,
            ['logs:PutRetentionPolicy', logGroup(name), false] as const,
        ]),
        ...admittedLogGroups.flatMap((name) => [
            ['logs:DeleteLogGroup', logGroup(name), true] as const,
            ['logs:DeleteLogGroup', logGroup(`${name}:*`), true] as const,
        ]),

        // The repositories production pulls from: CI pushes to them and `ecrEnsureRepo.sh` creates them and applies
        // the retention policy, but nothing a pull request runs may delete one or rewrite who may read it.
        ...SHARED_REPOSITORIES.flatMap((name) => [
            ['ecr:DeleteRepository', repository(name), false] as const,
            ['ecr:SetRepositoryPolicy', repository(name), false] as const,
            ['ecr:PutImage', repository(name), true] as const,
            ['ecr:CreateRepository', repository(name), true] as const,
            ['ecr:PutLifecyclePolicy', repository(name), true] as const,
        ]),
        [
            'ecr:DeleteRepository',
            repository('kitchensink-identity-service-prod-identityservicerepositoryc5b5f5df-71vakhetrsdm'),
            false,
        ],
        ['ecr:DeleteRepository', repository('kitchensink-food-pr-91'), true],

        ['ecs:DeleteService', ecs('service', PER_PR_CLUSTER), true],
        ['ecs:StopTask', ecs('task', PER_PR_CLUSTER), true],
        ['ecs:DeleteService', ecs('service', SANDBOX_CLUSTER), false],
        ['ecs:StopTask', ecs('task', SANDBOX_CLUSTER), false],
        ['ecs:UpdateService', ecs('service', SANDBOX_CLUSTER), false],
        ['ecs:DeleteCluster', `arn:aws:ecs:${region}:${account}:cluster/${PER_PR_CLUSTER}`, false],

        // `verifyDeployment.sh` probes every bucket a deployed Lambda names, and the remote-search tier reads its
        // function URL. Each is a read, and each stays off production by name.
        [
            'secretsmanager:GetSecretValue',
            `arn:aws:secretsmanager:${region}:${account}:secret:DatabaseCredentialsSecret74-JXzjVhUdYcPm`,
            false,
        ],
        ['s3:ListBucket', 'arn:aws:s3:::kitchensink-data-sandbox-mediabucketbcbb02ba-h6ybojnuslif', true],
        ['s3:ListBucket', 'arn:aws:s3:::kitchensink-data-sandbox-archivebucket9decbf5d-xiovfhbzw8eh', true],
        ['s3:ListBucket', 'arn:aws:s3:::kitchensink-data-prod-mediabucketbcbb02ba-0000000000aa', false],
        ['s3:DeleteBucket', 'arn:aws:s3:::kitchensink-data-sandbox-mediabucketbcbb02ba-h6ybojnuslif', false],
        [
            'lambda:GetFunctionUrlConfig',
            `arn:aws:lambda:${region}:${account}:function:kitchensink-remote-search-pr-91`,
            true,
        ],

        // SSM: reads stay broad; the only writes CI makes are the owed-drop ledger's (`perPrDatabaseDrop.sh`).
        ['ssm:PutParameter', parameter('/kitchensink/sandbox/owed-per-pr-database-drops/pr-91'), true],
        ['ssm:DeleteParameter', parameter('/kitchensink/sandbox/owed-per-pr-database-drops/pr-91'), true],
        ['ssm:GetParametersByPath', parameter('/kitchensink/sandbox/owed-per-pr-database-drops'), true],
        ['ssm:GetParameter', parameter('/kitchensink/sandbox/clerk/publishable-key'), true],
        ['ssm:GetParameter', parameter('/kitchensink/pr-91/anything'), true],
        ['ssm:PutParameter', parameter('/kitchensink/sandbox/clerk/publishable-key'), false],
        ['ssm:DeleteParameter', parameter('/kitchensink/sandbox/azp-preview-mode'), false],
        ['ssm:PutParameter', parameter('/kitchensink/pr-91/anything'), false],
        ['ssm:PutParameter', parameter('/kitchensink/prod/anything'), false],
    ];

    it.each(rows)('%s on %s -> admitted=%s', (action, resource, expected) => {
        expect(policyAdmits(nonprod, action, resource)).toBe(expected);
    });

    // Parameter writes are per tier (the prod role writes the prod tree by design), so only the TEARDOWN verbs are
    // carried across: no role but the non-prod one may delete, stop or re-point anything, and that one only per PR.
    const TEARDOWN_VERB = /:(Delete|Stop|Update|Set|PutRetention)/u;

    it.each(['kitchensink-gha-prod', 'kitchensink-gha-prod-read'])(
        '%s: refuses every teardown row the non-prod role refuses',
        (name) => {
            const statements = statementsOf(t, name);
            const refused = rows.filter(([action, , admitted]) => !admitted && TEARDOWN_VERB.test(action));

            expect(refused.length).toBeGreaterThan(20);

            for (const [action, resource] of refused) {
                expect(policyAdmits(statements, action, resource), `${action} on ${resource}`).toBe(false);
            }
        },
    );

    it('names the shared tier by EXACT stack names, and that set is SHARED_TIER_DELETE_ORDER', () => {
        const base = `arn:aws:cloudformation:${region}:${account}:stack/`;
        const exact = nonprod
            .filter((s) => s.Effect === 'Allow' && asList(s.Action).includes('cloudformation:DeleteStack'))
            .flatMap((s) => asList(s.Resource))
            .map((arn) => arn.slice(base.length).replace(/\/\*$/u, ''))
            .filter((name) => !name.includes('*') && !name.includes('?'));

        expect(new Set(exact)).toEqual(new Set(SHARED_TIER_DELETE_ORDER));
    });

    it('writes SSM only under the ledger perPrDatabaseDrop.sh records owed drops in', () => {
        const script = readFileSync(path.join(repoRoot, '.github/scripts/perPrDatabaseDrop.sh'), 'utf8');
        const prefix = /^OWED_PREFIX='([^']+)'$/mu.exec(script)?.[1];
        const writes = nonprod.filter(
            (s) =>
                s.Effect === 'Allow' &&
                asList(s.Action).some((a) => a === 'ssm:PutParameter' || a === 'ssm:DeleteParameter'),
        );

        expect(prefix).toBeDefined();
        expect(writes.flatMap((s) => asList(s.Resource))).toEqual([parameter(`${prefix}/*`)]);
    });
});

/**
 * P1 #4: a Lambda's configuration carries its environment variables, so reading or invoking a function is reading
 * what it holds. The non-prod role may touch only a function whose own CloudFormation stack name is a sandbox or
 * per-PR stack, judged on the `aws:cloudformation:stack-name` tag CloudFormation stamps on it — the one name that
 * is neither truncated nor dependent on our own app's tags. A function without that tag is refused, so a missing
 * tag breaks a deploy check loudly instead of silently widening the grant.
 *
 * Each row is (action, function, tags the function carries, admitted), evaluated WITH the tags.
 */
describe('the non-prod role reaches only sandbox and per-PR functions (P1 #4)', () => {
    const t = template();
    const nonprod = statementsOf(t, 'kitchensink-gha-nonprod');
    const prod = statementsOf(t, 'kitchensink-gha-prod');
    const prodRead = statementsOf(t, 'kitchensink-gha-prod-read');
    const { account, region } = env;
    const fn = (name: string): string => `arn:aws:lambda:${region}:${account}:function:${name}`;
    const stackTag = 'aws:cloudformation:stack-name';
    // CloudFormation truncates a generated name, so the stage can be gone from it: this is the real shape.
    const PROD_WEBHOOK = fn('kitchensink-identity-webhook-WebhookFunction8F2D-Ab12');
    const SANDBOX_WEBHOOK = fn('kitchensink-identity-webhook-WebhookFunction8F2D-Cd34');
    const prodTags = { [stackTag]: 'kitchensink-identity-webhooks-prod', Environment: 'global' };
    const sandboxTags = { [stackTag]: 'kitchensink-identity-webhooks-sandbox', Environment: 'sandbox' };

    const rows: readonly (readonly [string, string, Readonly<Record<string, string>>, boolean])[] = [
        ['lambda:GetFunctionConfiguration', PROD_WEBHOOK, prodTags, false],
        ['lambda:InvokeFunction', PROD_WEBHOOK, prodTags, false],
        ['lambda:GetFunctionUrlConfig', PROD_WEBHOOK, prodTags, false],
        ['lambda:GetFunctionConfiguration', PROD_WEBHOOK, { ...prodTags, Environment: 'production' }, false],
        ['lambda:GetFunctionConfiguration', SANDBOX_WEBHOOK, sandboxTags, true],
        [
            'lambda:InvokeFunction',
            fn('kitchensink-food-schema-pr-91-MigrationRunner0A1B-Zz9'),
            { [stackTag]: 'kitchensink-food-schema-pr-91', Environment: 'pr-91-sandbox' },
            true,
        ],
        // A CDK provider function carries the stack tag but none of the app's tags.
        [
            'lambda:GetFunctionConfiguration',
            fn('kitchensink-data-sandbox-LogRetention8aB-Qq1'),
            { [stackTag]: 'kitchensink-data-sandbox' },
            true,
        ],
        // No tag at all: the Allow cannot be met, so it fails closed.
        ['lambda:GetFunctionConfiguration', SANDBOX_WEBHOOK, {}, false],
        ['lambda:InvokeFunction', SANDBOX_WEBHOOK, {}, false],
        ['lambda:InvokeFunction', fn('armoury-production-api'), { Environment: 'production' }, false],
        ['lambda:GetFunctionConfiguration', fn('armoury-production-api'), { Environment: 'production' }, false],
        // The name deny holds even if a prod function somehow carried a sandbox stack tag.
        [
            'lambda:GetFunctionConfiguration',
            fn('kitchensink-remote-search-prod'),
            { [stackTag]: 'kitchensink-remote-search-sandbox' },
            false,
        ],
        // The other readers that return Environment.Variables are not granted at all.
        ['lambda:GetFunction', SANDBOX_WEBHOOK, sandboxTags, false],
        ['lambda:ListVersionsByFunction', SANDBOX_WEBHOOK, sandboxTags, false],
        ['lambda:ListFunctions', '*', {}, false],
    ];

    it.each(rows)('non-prod: %s on %s %j -> admitted=%s', (action, resource, tags, expected) => {
        expect(policyAdmitsTagged(nonprod, action, resource, tags)).toBe(expected);
    });

    it.each([
        ['prod', prod],
        ['prod-read', prodRead],
        ['non-prod', nonprod],
    ] as const)('%s role cannot call ListFunctions, which returns every function environment', (_name, statements) => {
        expect(policyAdmitsTagged(statements, 'lambda:ListFunctions', '*', {})).toBe(false);
    });

    it('the prod role still reads its own functions', () => {
        expect(policyAdmitsTagged(prod, 'lambda:GetFunctionConfiguration', PROD_WEBHOOK, prodTags)).toBe(true);
        expect(policyAdmitsTagged(prod, 'lambda:InvokeFunction', PROD_WEBHOOK, prodTags)).toBe(true);
    });

    it('no role is granted a lambda List* wildcard', () => {
        for (const statements of [nonprod, prod, prodRead]) {
            const listed = statements
                .filter((s) => s.Effect === 'Allow')
                .flatMap((s) => asList(s.Action))
                .filter((action) => /^lambda:list/iu.test(action));

            expect(listed).toEqual([]);
        }
    });

    it('the non-prod Lambda Allows are exactly invoke, configuration and function-URL reads', () => {
        const actions = nonprod
            .filter((s) => s.Effect === 'Allow')
            .flatMap((s) => asList(s.Action))
            .filter((action) => /^lambda:/iu.test(action));

        expect(new Set(actions)).toEqual(
            new Set(['lambda:InvokeFunction', 'lambda:GetFunctionConfiguration', 'lambda:GetFunctionUrlConfig']),
        );
    });

    it('the one non-prod Lambda Allow is conditioned on the stack-name tag, sandbox and per-PR stacks only', () => {
        const allows = nonprod.filter(
            (s) => s.Effect === 'Allow' && asList(s.Action).some((action) => /^lambda:/iu.test(action)),
        );

        expect(allows).toHaveLength(1);
        expect(allows[0]?.Condition).toEqual({
            StringLike: {
                'aws:ResourceTag/aws:cloudformation:stack-name': ['kitchensink-*-sandbox', 'kitchensink-*-pr-*'],
            },
        });
    });
});

/**
 * MEDIUM-2 (CI roles security review): the "observe" grants used to be `Describe*`/`List*`/`Get*` wildcards on `*`, which
 * let any CI job read other stacks' (and the other application's) task-definition environment, step-function
 * input, instance user data and log events. Each grant is now a NAMED action, and this table is its only source of
 * truth: one row per command a CI job runs, with the IAM action it needs and a real resource shape it targets.
 *
 * Three claims, each of which fails on its own mutation:
 *   1. every row is admitted by the tier(s) that run it (no workflow is broken by the narrowing);
 *   2. the observe actions each role holds are EXACTLY the rows' actions (a wildcard or an extra reader fails);
 *   3. the refusal rows (the readers that leak a secret, and the other application's names) stay refused.
 */
describe('GithubActionsAccessStack: the observe grants are the enumerated CI commands and nothing more', () => {
    const t = template();
    const { account, region } = env;
    const arn = (service: string, rest: string): string => `arn:aws:${service}:${region}:${account}:${rest}`;
    const ALL = OBSERVE_TIERS;
    type Tier = ObserveTier;
    const ROLE: Record<Tier, string> = { nonprod: 'kitchensink-gha-nonprod', prod: 'kitchensink-gha-prod' };

    /** `*` is the only scope these actions have: the Service Authorization Reference lists no resource type for them. */
    const UNSCOPABLE = ['ecs:DescribeTaskDefinition', 'ecs:ListClusters', 'ec2:DescribeInstances', 'tag:GetResources'];

    const commands = observeCommands(env);

    it.each(
        commands.flatMap(([caller, action, resource, tiers]) =>
            tiers.map((tier) => [tier, caller, action, resource] as const),
        ),
    )('%s: %s needs %s on %s and is admitted', (tier, _caller, action, resource) => {
        expect(policyAdmits(statementsOf(t, ROLE[tier]), action, resource)).toBe(true);
    });

    it.each(ALL)('%s: the observe actions it holds are exactly the enumerated commands', (tier) => {
        const held = new Set(
            actionsOf(statementsOf(t, ROLE[tier]), 'Allow').filter(
                (action) => OBSERVE_SERVICE.test(action) && !TEARDOWN.has(action),
            ),
        );
        const wanted = new Set(commands.filter((row) => row[3].includes(tier)).map((row) => row[1]));

        expect(held).toEqual(wanted);
    });

    it.each(ALL)('%s: grants no wildcard action on an observe service', (tier) => {
        const wild = actionsOf(statementsOf(t, ROLE[tier]), 'Allow').filter(
            (action) => OBSERVE_SERVICE.test(action) && action.includes('*'),
        );

        expect(wild).toEqual([]);
    });

    it.each(ALL)('%s: only the actions with no resource type are granted on `*`', (tier) => {
        const onStar = statementsOf(t, ROLE[tier])
            .filter((s) => s.Effect === 'Allow' && asList(s.Resource).includes('*'))
            .flatMap((s) => asList(s.Action))
            .filter((action) => OBSERVE_SERVICE.test(action));

        // cloudwatch:GetMetricStatistics takes no resource either.
        expect(new Set(onStar)).toEqual(new Set([...UNSCOPABLE, 'cloudwatch:GetMetricStatistics']));
    });

    const refusals: readonly (readonly [string, string])[] = [
        // Log CONTENT: no CI job reads it, and production's and the other application's groups hold it.
        ['logs:GetLogEvents', arn('logs', 'log-group:/kitchensink/identity-service/prod:log-stream:x')],
        ['logs:FilterLogEvents', arn('logs', 'log-group:/aws/lambda/armoury-production-api')],
        ['logs:StartQuery', '*'],
        // Readers that return a secret-bearing document.
        ['ec2:DescribeInstanceAttribute', arn('ec2', 'instance/i-0123456789abcdef0')],
        ['states:DescribeExecution', arn('states', 'execution:ReclaimStateMachineAB12-xYz:run1')],
        ['states:GetExecutionHistory', arn('states', 'execution:ReclaimStateMachineAB12-xYz:run1')],
        ['iam:GetAccountAuthorizationDetails', '*'],
        ['iam:ListUsers', '*'],
        ['iam:GetRole', `arn:aws:iam::${account}:role/armoury-production-api-role`],
        ['sqs:ReceiveMessage', arn('sqs', 'kitchensink-recipe-parse-pr-91')],
        ['sqs:ListQueues', '*'],
        ['sns:ListTopics', '*'],
        ['rds:DescribeDBSnapshots', arn('rds', 'snapshot:x')],
        // The other application's names.
        ['ecs:DescribeServices', arn('ecs', 'service/armoury-production/api')],
        ['ecs:DescribeTasks', arn('ecs', 'task/armoury-production/abc')],
        ['ecs:ListServices', arn('ecs', 'cluster/armoury-production')],
        ['sqs:GetQueueAttributes', arn('sqs', 'armoury-production-jobs')],
        ['sns:GetTopicAttributes', arn('sns', 'armoury-production-alarms')],
        ['cloudwatch:DescribeAlarms', '*'],
    ];

    it.each(ALL.flatMap((tier) => refusals.map(([action, resource]) => [tier, action, resource] as const)))(
        '%s refuses %s on %s',
        (tier, action, resource) => {
            expect(policyAdmits(statementsOf(t, ROLE[tier]), action, resource)).toBe(false);
        },
    );

    // The preview load test's collector reads metrics as `nonprod`; nothing else it runs touches CloudWatch.
    it('non-prod reads metrics and does nothing else in CloudWatch: no alarm, no metric written', () => {
        const held = actionsOf(statementsOf(t, ROLE.nonprod), 'Allow').filter((action) => /^cloudwatch:/u.test(action));

        expect(held).toEqual(['cloudwatch:GetMetricStatistics']);
    });
});

/**
 * HIGH-1 cannot be closed here (the CDK deploy role is account administrator: ADR-0063, owner decision), so what this
 * pins is that it cannot GET WIDER: the roles each tier may assume are exactly the bootstrap roles it needs today, and
 * no other statement in any role names an `sts:` action.
 */
describe('GithubActionsAccessStack: the roles a CI role may assume are an enumerated set', () => {
    const t = template();
    const { account, region } = env;
    const boot = (kind: string): string =>
        `arn:aws:iam::${account}:role/cdk-hnb659fds-${kind}-role-${account}-${region}`;
    const ALL_KINDS = ['deploy', 'file-publishing', 'image-publishing', 'lookup'].map(boot);

    const stsGrants = (statements: readonly Statement[]): readonly Statement[] =>
        statements.filter(
            (s) => s.Effect === 'Allow' && asList(s.Action).some((action) => /^sts:/iu.test(action) || action === '*'),
        );

    /** Whether the assume grants are exactly `targets`, as one unconditioned `sts:AssumeRole`. The unit under test. */
    const pinned = (statements: readonly Statement[], targets: readonly string[]): boolean => {
        const sts = stsGrants(statements);

        return (
            new Set(sts.flatMap((s) => asList(s.Action))).size === 1 &&
            asList(sts[0]?.Action)[0] === 'sts:AssumeRole' &&
            sts.every((s) => s.Condition === undefined) &&
            JSON.stringify([...new Set(sts.flatMap((s) => asList(s.Resource)))].sort()) ===
                JSON.stringify([...targets].sort())
        );
    };

    it.each([
        ['kitchensink-gha-nonprod', ALL_KINDS],
        ['kitchensink-gha-prod', ALL_KINDS],
        ['kitchensink-gha-prod-read', [boot('lookup')]],
    ])('%s may assume exactly the bootstrap roles %j', (name, targets) => {
        expect(pinned(statementsOf(t, name), targets)).toBe(true);
    });

    // The shapes the pin must tell apart, so it is not green by accident: each is a way the grant could widen.
    const base: Statement = { Effect: 'Allow', Action: 'sts:AssumeRole', Resource: ALL_KINDS };

    it.each<[string, readonly Statement[]]>([
        ['a wildcard resource added', [base, { ...base, Resource: '*' }]],
        ['an account-wide role arn added', [base, { ...base, Resource: `arn:aws:iam::${account}:role/*` }]],
        [
            'a role outside the bootstrap set',
            [{ ...base, Resource: [...ALL_KINDS, `arn:aws:iam::${account}:role/admin`] }],
        ],
        ['a wildcard sts action', [base, { ...base, Action: 'sts:*' }]],
        ['a bare star action', [base, { ...base, Action: '*', Resource: boot('lookup') }]],
        [
            'a condition that is not asserted',
            [{ ...base, Condition: { StringEquals: { 'aws:RequestedRegion': region } } }],
        ],
        ['a role dropped', [{ ...base, Resource: ALL_KINDS.slice(1) }]],
    ])('the pin rejects %s', (_label, statements) => {
        expect(pinned(statements, ALL_KINDS)).toBe(false);
    });
});

/**
 * The old "nothing names the production tree" check was a substring match on Allow resources: blind to a `*`
 * resource, and to an action whose resource is a wildcard that happens to cover production. This one asks the
 * policy: for every concrete action the non-prod role holds and every production resource shape, is the pair
 * admitted? The answer must be EXACTLY the reviewed set below, so a new reach into production (a widened resource,
 * a new action on `*`) appears as a diff. Conditions are ignored (`policyAdmits`), so a condition-protected Allow is
 * listed and its protection is asserted by its own table.
 */
describe('GithubActionsAccessStack: what the non-prod role reaches in the production tree is a reviewed set', () => {
    const t = template();
    const nonprod = statementsOf(t, 'kitchensink-gha-nonprod');
    const { account, region } = env;
    const arn = (service: string, rest: string): string => `arn:aws:${service}:${region}:${account}:${rest}`;
    const PROD_CLUSTER = 'kitchensink-identity-service-prod-IdentityServiceCluster3A4949E2-aB';

    const PRODUCTION: Readonly<Record<string, string>> = {
        'prod parameter': arn('ssm', 'parameter/kitchensink/prod/clerk/secret-key'),
        'prod secret': arn('secretsmanager', 'secret:kitchensink/prod/identity/keys-AbCdEf'),
        'prod stack': arn('cloudformation', 'stack/kitchensink-data-prod/0f1e2d3c-aaaa-bbbb-cccc-0123456789ab'),
        'prod function': arn('lambda', 'function:kitchensink-identity-webhooks-prod-WebhookFn-Ab12'),
        'prod ecs service': arn('ecs', `service/${PROD_CLUSTER}/api`),
        'prod ecs task': arn('ecs', `task/${PROD_CLUSTER}/abc`),
        'prod bucket': 'arn:aws:s3:::kitchensink-data-prod-mediabucketbcbb02ba-0000000000aa',
        'prod log group': arn('logs', 'log-group:/kitchensink/identity-service/prod'),
        'prod queue': arn('sqs', 'kitchensink-recipe-parse-prod'),
        'prod topic': arn('sns', 'kitchensink-handle-sync-prod'),
        'other application parameter': arn('ssm', 'parameter/armoury/production/key'),
        'other application secret': arn('secretsmanager', 'secret:armoury/production/key-AbCdEf'),
        'other application function': arn('lambda', 'function:armoury-production-api'),
        'other application service': arn('ecs', 'service/armoury-production/api'),
        'other application log group': arn('logs', 'log-group:/aws/lambda/armoury-production-api'),
    };

    const everyAction = [...new Set(actionsOf(nonprod, 'Allow').filter((action) => !action.includes('*')))].sort();
    // An action granted on `*` reaches every resource by definition, so it is judged as a SET of its own: the shape of
    // the per-resource answer below would otherwise repeat each of them once per production label.
    const onStar = everyAction.filter((action) => policyAdmits(nonprod, action, '*'));
    const concrete = everyAction.filter((action) => !onStar.includes(action) && !/^(sts|ecr):/u.test(action));

    const reached = (): string[] =>
        concrete
            .flatMap((action) =>
                Object.entries(PRODUCTION)
                    .filter(([, resource]) => policyAdmits(nonprod, action, resource))
                    .map(([label]) => `${action} -> ${label}`),
            )
            .sort();

    // Each line is a reach that is deliberate. A stack's description and template hold no secret (parameters and
    // secrets are by reference); no Lambda row appears because the unconditional name Deny on `kitchensink-*-prod*`
    // refuses a prod function whatever its tags (the P1 #4 table evaluates the tag side); the ECS, queue, topic and
    // log-group rows are metadata-only observe grants that cannot be narrowed to a stage (a service or queue name
    // carries it only sometimes).
    const REVIEWED = [
        'cloudformation:DescribeStackEvents -> prod stack',
        'cloudformation:DescribeStackResources -> prod stack',
        'cloudformation:DescribeStacks -> prod stack',
        'cloudformation:GetTemplate -> prod stack',
        'cloudformation:GetTemplateSummary -> prod stack',
        'cloudformation:ListStackResources -> prod stack',
        'ecs:DescribeServices -> prod ecs service',
        'ecs:DescribeTasks -> prod ecs task',
        'logs:DescribeLogGroups -> other application log group',
        'logs:DescribeLogGroups -> prod log group',
        'logs:DescribeSubscriptionFilters -> other application log group',
        'logs:DescribeSubscriptionFilters -> prod log group',
        'sns:GetTopicAttributes -> prod topic',
        'sqs:GetQueueAttributes -> prod queue',
        'sqs:GetQueueUrl -> prod queue',
    ].sort();

    it('is exactly the reviewed set', () => {
        expect(reached()).toEqual(REVIEWED);
    });

    // Every one of these takes no resource type (or is an account-wide listing) and returns names and statuses, never
    // a document that carries a secret; adding to this list is a security decision, so it is a literal.
    it('the actions granted on `*` are exactly the reviewed account-wide listings', () => {
        expect(onStar).toEqual(
            [
                'cloudformation:ListExports',
                'cloudformation:ListStacks',
                'cloudwatch:GetMetricStatistics',
                'ec2:DescribeInstances',
                'ecr:GetAuthorizationToken',
                'ecs:DescribeTaskDefinition',
                'ecs:ListClusters',
                'route53:GetChange',
                'route53:ListHostedZones',
                'route53:ListHostedZonesByName',
                'tag:GetResources',
            ].sort(),
        );
    });

    it('reaches no production parameter, secret or bucket, and nothing secret-bearing of the other application', () => {
        const forbidden = reached().filter((line) =>
            /-> (prod parameter|prod secret|prod bucket|other application (parameter|secret|function|service))$/u.test(
                line,
            ),
        );

        expect(forbidden).toEqual([]);
    });

    it('the guard sees a `*` resource, which the old substring check did not', () => {
        const widened: readonly Statement[] = [
            ...nonprod,
            { Effect: 'Allow', Action: 'ssm:GetParameter', Resource: '*' },
        ];
        const parameter = PRODUCTION['prod parameter'] ?? '';

        expect(policyAdmits(widened, 'ssm:GetParameter', parameter)).toBe(true);
        expect(policyAdmits(nonprod, 'ssm:GetParameter', parameter)).toBe(false);
    });
});

/**
 * MEDIUM-1: release tags are immutable (`ecrEnsureRepo.sh`), which holds only while the role any branch can assume
 * cannot switch that off or remove an image. Only the production role may change a repository's tag mutability.
 */
describe('GithubActionsAccessStack: only the production role may change image tag mutability', () => {
    const t = template();
    const repo = (name: string): string => `arn:aws:ecr:${env.region}:${env.account}:repository/${name}`;
    const rows: readonly (readonly [string, string, string, boolean])[] = [
        ['kitchensink-gha-prod', 'ecr:PutImageTagMutability', repo('kitchensink-food'), true],
        ['kitchensink-gha-nonprod', 'ecr:PutImageTagMutability', repo('kitchensink-food'), false],
        ['kitchensink-gha-nonprod', 'ecr:PutImageTagMutability', repo('kitchensink-food-pr-91'), false],
        ['kitchensink-gha-prod-read', 'ecr:PutImageTagMutability', repo('kitchensink-food'), false],
        ['kitchensink-gha-prod', 'ecr:PutImageTagMutability', repo('armoury-api'), false],
        ['kitchensink-gha-nonprod', 'ecr:BatchDeleteImage', repo('kitchensink-food'), false],
        ['kitchensink-gha-prod', 'ecr:BatchDeleteImage', repo('kitchensink-food'), false],
        // What a preview push needs stays: the push and the repository's creation (born immutable).
        ['kitchensink-gha-nonprod', 'ecr:PutImage', repo('kitchensink-food'), true],
        ['kitchensink-gha-nonprod', 'ecr:CreateRepository', repo('kitchensink-food'), true],
    ];

    it.each(rows)('%s: %s on %s -> admitted=%s', (name, action, resource, expected) => {
        expect(policyAdmits(statementsOf(t, name), action, resource)).toBe(expected);
    });
});
