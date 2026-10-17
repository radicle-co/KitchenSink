/**
 * The customization is the one place HIGH-1 is closed in the bootstrap itself, so each edit is held by a test that
 * reads the OUTPUT, not the transform: who can assume each role, which stacks the deploy role can touch, what the
 * lookup role can read, and that nothing in the template can fall back to administrator.
 *
 * Every assertion is a property of the produced template. The mutation lens: reverting any one edit in the
 * transform (leaving the root trust, `Resource: "*"`, `ReadOnlyAccess`, the `AdministratorAccess` fallback) makes
 * at least one test here fail, and the 'fails loudly when the stock template changes shape' cases prove the
 * transform cannot silently skip an edit.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { LOOKUP_ROLE_ACTIONS, customizeBootstrapTemplate } from '../src/customizeBootstrapTemplate.js';
import type { Json } from '../src/json.js';
import {
    ASSUMABLE_ROLE_KINDS,
    BOOTSTRAP_TRUST,
    STACK_NAME_PATTERNS,
    ciRoleArn,
    type AssumableRoleKind,
    type QualifierName,
    QUALIFIERS,
} from '../src/qualifiers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const stock = parse(readFileSync(path.join(here, '../src/stockTemplate.yaml'), 'utf8')) as Json;
const ACCOUNT_TOKEN = '${AWS::AccountId}';

type JsonObject = { [key: string]: Json };

const asObject = (value: Json | undefined, what: string): JsonObject => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`expected ${what} to be an object`);
    }

    return value;
};

const asArray = (value: Json | undefined, what: string): Json[] => {
    if (!Array.isArray(value)) {
        throw new Error(`expected ${what} to be an array`);
    }

    return value;
};

const resource = (template: Json, id: string): JsonObject =>
    asObject(asObject(asObject(template, 'template')['Resources'], 'Resources')[id], id);

const properties = (template: Json, id: string): JsonObject =>
    asObject(resource(template, id)['Properties'], `${id}.Properties`);

const ROLE_IDS: Readonly<Record<AssumableRoleKind, string>> = {
    deploy: 'DeploymentActionRole',
    'file-publishing': 'FilePublishingRole',
    'image-publishing': 'ImagePublishingRole',
    lookup: 'LookupRole',
};

const qualifiers = Object.values(QUALIFIERS);

/** Every `aws:PrincipalArn` ArnEquals list found anywhere in a trust statement's condition (through Fn::If). */
function principalArnConditions(condition: Json | undefined): Json[][] {
    const found: Json[][] = [];

    const visit = (node: Json | undefined): void => {
        if (Array.isArray(node)) {
            node.forEach(visit);
        } else if (typeof node === 'object' && node !== null) {
            const equals = node['ArnEquals'];

            if (typeof equals === 'object' && equals !== null && !Array.isArray(equals)) {
                found.push(asArray(equals['aws:PrincipalArn'], 'aws:PrincipalArn'));
            }

            Object.values(node).forEach(visit);
        }
    };

    visit(condition);

    return found;
}

describe.each(qualifiers)('customizeBootstrapTemplate(%s)', (qualifier: QualifierName) => {
    const out = customizeBootstrapTemplate(stock, qualifier);

    describe('trust (edit a)', () => {
        it.each(ASSUMABLE_ROLE_KINDS)('the %s role trusts exactly the CI roles BOOTSTRAP_TRUST names', (kind) => {
            const statements = asArray(
                asObject(properties(out, ROLE_IDS[kind])['AssumeRolePolicyDocument'], 'trust')['Statement'],
                'Statement',
            );
            const expected = BOOTSTRAP_TRUST[qualifier][kind].map((tier) => ({
                'Fn::Sub': ciRoleArn(ACCOUNT_TOKEN, tier),
            }));

            expect(statements.map((s) => asObject(s, 'statement')['Action'])).toEqual([
                'sts:AssumeRole',
                'sts:TagSession',
            ]);

            for (const statement of statements) {
                const lists = principalArnConditions(asObject(statement, 'statement')['Condition']);

                // An Fn::If carries the condition once per branch; every occurrence must be the same list.
                expect(lists.length).toBeGreaterThan(0);

                for (const list of lists) {
                    expect(list).toEqual(expected);
                }
            }
        });

        it('keeps the external-id refusal beside the principal condition on AssumeRole', () => {
            const statements = asArray(
                asObject(properties(out, 'DeploymentActionRole')['AssumeRolePolicyDocument'], 'trust')['Statement'],
                'Statement',
            );

            expect(JSON.stringify(asObject(statements[0], 'statement')['Condition'])).toContain('sts:ExternalId');
        });

        it('has no statement that a TrustedAccounts parameter could widen', () => {
            for (const kind of ASSUMABLE_ROLE_KINDS) {
                const trust = JSON.stringify(properties(out, ROLE_IDS[kind])['AssumeRolePolicyDocument']);

                expect(trust).not.toContain('TrustedAccounts');
                expect(trust).not.toContain('"AWS":"*"');
            }
        });
    });

    describe('deploy role stack scope (edit b)', () => {
        const policy = asObject(
            asObject(asArray(properties(out, 'DeploymentActionRole')['Policies'], 'Policies')[0], 'policy')[
                'PolicyDocument'
            ],
            'document',
        );
        const statements = asArray(policy['Statement'], 'Statement').map((s) => asObject(s, 'statement'));

        it('limits every cloudformation action to the qualifier stack patterns', () => {
            const cloudformation = statements.filter((s) =>
                asArray([s['Action']].flat() as Json[], 'Action').some(
                    (a) => typeof a === 'string' && a.startsWith('cloudformation:'),
                ),
            );

            expect(cloudformation.length).toBeGreaterThan(0);

            for (const statement of cloudformation) {
                const resources = [statement['Resource']].flat();

                for (const entry of resources) {
                    expect(entry).not.toBe('*');
                    expect(JSON.stringify(entry)).toContain('cloudformation:');
                }

                for (const pattern of STACK_NAME_PATTERNS[qualifier]) {
                    expect(JSON.stringify(resources)).toContain(`stack/${pattern}/*`);
                }
            }
        });

        it('mentions no stack pattern of another qualifier', () => {
            const text = JSON.stringify(policy);

            for (const other of qualifiers.filter((q) => q !== qualifier)) {
                for (const pattern of STACK_NAME_PATTERNS[other]) {
                    expect(text).not.toContain(`stack/${pattern}/`);
                }
            }
        });

        it('replaces the CloudFormation read-only managed policy with scoped reads', () => {
            expect(properties(out, 'DeploymentActionRole')['ManagedPolicyArns']).toBeUndefined();
            expect(JSON.stringify(out)).not.toContain('AWSCloudFormationReadOnlyAccess');
        });

        it('keeps sts:GetCallerIdentity on * (it has no resource type)', () => {
            const sts = statements.find((s) => JSON.stringify(s['Action']).includes('sts:GetCallerIdentity'));

            expect(sts).toBeDefined();
            expect(asObject(sts, 'sts statement')['Resource']).toBe('*');
        });
    });

    describe('lookup role (edit c)', () => {
        it('drops ReadOnlyAccess', () => {
            expect(properties(out, 'LookupRole')['ManagedPolicyArns']).toBeUndefined();
            expect(JSON.stringify(out)).not.toContain('ReadOnlyAccess');
        });

        it('allows only the context-provider reads the apps use, plus the version parameter', () => {
            const policy = asObject(
                asObject(asArray(properties(out, 'LookupRole')['Policies'], 'Policies')[0], 'policy')['PolicyDocument'],
                'document',
            );
            const allowed = asArray(policy['Statement'], 'Statement')
                .map((s) => asObject(s, 'statement'))
                .filter((s) => s['Effect'] === 'Allow')
                .flatMap((s) => [s['Action']].flat() as string[])
                .sort();

            expect(allowed).toEqual([...LOOKUP_ROLE_ACTIONS].sort());
        });

        it('keeps the stock kms:Decrypt Deny', () => {
            expect(JSON.stringify(properties(out, 'LookupRole')['Policies'])).toContain('kms:Decrypt');
        });
    });

    describe('execution role (edit d and the fallback)', () => {
        it('trusts CloudFormation only on behalf of this account (confused deputy)', () => {
            const trust = JSON.stringify(properties(out, 'CloudFormationExecutionRole')['AssumeRolePolicyDocument']);

            expect(trust).toContain('cloudformation.amazonaws.com');
            expect(trust).toContain('aws:SourceAccount');
        });

        it('has no AdministratorAccess fallback anywhere', () => {
            expect(JSON.stringify(out)).not.toContain('AdministratorAccess');
            expect(properties(out, 'CloudFormationExecutionRole')['ManagedPolicyArns']).toEqual({
                Ref: 'CloudFormationExecutionPolicies',
            });
        });
    });

    describe('identity of the stack', () => {
        it('defaults the Qualifier parameter to this qualifier', () => {
            const parameters = asObject(asObject(out, 'template')['Parameters'], 'Parameters');

            expect(asObject(parameters['Qualifier'], 'Qualifier')['Default']).toBe(qualifier);
        });

        it('declares a variant of its own so the CLI refuses to overwrite it with a stock bootstrap', () => {
            const parameters = asObject(asObject(out, 'template')['Parameters'], 'Parameters');
            const variant = asObject(parameters['BootstrapVariant'], 'BootstrapVariant')['Default'];

            expect(variant).toMatch(/KitchenSink/u);
            expect(variant).not.toBe('AWS CDK: Default Resources');
        });
    });
});

describe('customizeBootstrapTemplate — purity and loudness', () => {
    it('does not mutate the stock template it is given', () => {
        const before = JSON.stringify(stock);
        customizeBootstrapTemplate(stock, QUALIFIERS.prod);

        expect(JSON.stringify(stock)).toBe(before);
    });

    it('gives different qualifiers different trust (the edit really is per qualifier)', () => {
        expect(JSON.stringify(customizeBootstrapTemplate(stock, QUALIFIERS.nonprod))).not.toBe(
            JSON.stringify(customizeBootstrapTemplate(stock, QUALIFIERS.prod)),
        );
    });

    it.each(['DeploymentActionRole', 'LookupRole', 'CloudFormationExecutionRole', 'FilePublishingRole'])(
        'fails loudly when the stock template no longer has %s',
        (id) => {
            const broken = structuredClone(stock) as JsonObject;
            delete asObject(broken['Resources'], 'Resources')[id];

            expect(() => customizeBootstrapTemplate(broken, QUALIFIERS.prod)).toThrow(new RegExp(id, 'u'));
        },
    );

    it('fails loudly when the deploy role loses the statement that must be scoped', () => {
        const broken = structuredClone(stock) as JsonObject;
        const policies = asArray(properties(broken, 'DeploymentActionRole')['Policies'], 'Policies');
        const document = asObject(asObject(policies[0], 'policy')['PolicyDocument'], 'document');
        document['Statement'] = asArray(document['Statement'], 'Statement').filter(
            (s) => asObject(s, 'statement')['Sid'] !== 'DeployPermissions',
        );

        expect(() => customizeBootstrapTemplate(broken, QUALIFIERS.prod)).toThrow(/DeployPermissions/u);
    });
});
