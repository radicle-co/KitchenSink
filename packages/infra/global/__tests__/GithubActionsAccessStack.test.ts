/**
 * ADR-0063: one OIDC provider and three roles, judged on the synthesized template.
 *
 * Trust is compared as exact strings, and permissions are judged by what each role is NOT allowed: a role
 * that gained `iam:*` or a write on the production parameter tree must fail here even though every
 * "can do X" assertion still passes.
 */
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { GithubActionsAccessStack } from '../lib/platform/GithubActionsAccessStack.js';
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

interface Statement {
    readonly Effect: string;
    readonly Condition?: unknown;
    readonly Action: string | readonly string[];
    readonly Resource: unknown;
}

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

const actionsOf = (statements: readonly Statement[], effect: string): readonly string[] =>
    statements
        .filter((s) => s.Effect === effect)
        .flatMap((s) => (typeof s.Action === 'string' ? [s.Action] : [...s.Action]));

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

    it('nonprod: may change DNS records only for pr-*.sandbox.commise.app, as CNAME', () => {
        const change = statementsOf(t, 'kitchensink-gha-nonprod').filter((s) =>
            JSON.stringify(s.Action).includes('route53:ChangeResourceRecordSets'),
        );
        const condition = JSON.stringify(change[0]?.Condition);

        expect(change).toHaveLength(1);
        expect(JSON.stringify(change[0]?.Resource)).toContain('Z0474040RGDAGYCWHZ7M');
        expect(condition).toContain('pr-*.sandbox.commise.app');
        expect(condition).toContain('CNAME');
    });

    it('nonprod: may delete sandbox and pr stacks only, by name', () => {
        const deletes = statementsOf(t, 'kitchensink-gha-nonprod').filter(
            (s) => s.Effect === 'Allow' && JSON.stringify(s.Action).includes('cloudformation:DeleteStack'),
        );
        const resources = JSON.stringify(deletes.map((s) => s.Resource));

        expect(deletes).toHaveLength(1);
        expect(resources).toContain('stack/kitchensink-*-sandbox/*');
        expect(resources).toContain('stack/kitchensink-*-pr-*/*');
        expect(resources).not.toContain('-prod');
    });

    it('prod-read: grants no write and assumes only the lookup role', () => {
        const statements = statementsOf(t, 'kitchensink-gha-prod-read');
        const allowed = actionsOf(statements, 'Allow');

        for (const action of allowed) {
            expect(action).not.toMatch(
                /:(Create|Put|Delete|Update|Stop|Start|Invoke|Tag|Untag|Attach|Detach|Run|Change|Modify|Set|Register|Deregister|Send|Publish)/u,
            );
        }

        const assume = statements.filter((s) => JSON.stringify(s.Action).includes('sts:AssumeRole'));
        const resources = JSON.stringify(assume.map((s) => s.Resource));

        expect(assume).toHaveLength(1);
        expect(resources).toContain('cdk-hnb659fds-lookup-role-');
        expect(resources).not.toContain('deploy-role');
        expect(resources).not.toContain('publishing-role');
    });

    it('prod-read: explicitly denies kms:Decrypt and every write', () => {
        const denied = actionsOf(statementsOf(t, 'kitchensink-gha-prod-read'), 'Deny');

        expect(denied).toContain('kms:Decrypt');
        expect(denied.length).toBeGreaterThan(1);
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
