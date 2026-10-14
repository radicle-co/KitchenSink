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
import { policyAdmits, type PolicyStatementJson } from './iamGlob.js';
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
