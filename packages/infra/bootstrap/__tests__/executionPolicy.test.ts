/**
 * The execution policy is the privilege (ADR-0065): it is what CloudFormation uses to create every resource, so
 * these guards read it as STRUCTURE and fail on the properties that turn a deploy role into an administrator.
 *
 * Mutation lens, applied by hand before this file was committed: widening any one statement (adding `iam:*`, an
 * `Action: "*"` Allow, dropping the permissions-boundary condition from `iam:CreateRole`, dropping the production
 * name Deny, adding a stack pattern of the other tier) makes at least one test below fail. The fixture tables
 * (`PRODUCTION_NAMES`, `NONPROD_NAMES`, `ESCALATION_ACTIONS`) hold shapes the tree does not contain today, so the
 * guard is judged against the class, not against the current templates only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { NAME_PREFIX, NONPROD_NAMES, PRODUCTION_NAMES } from './nameFixtures.js';
import { buildExecutionPolicy, PASS_ROLE_SERVICES } from '../src/executionPolicy.js';
import { iamLike } from '../src/iamPattern.js';
import {
    ACCOUNT,
    MANAGED_POLICY_LIMIT,
    REGION,
    managedPolicySize,
    renderDocument,
    type PolicyDocument,
    type Statement,
} from '../src/policyDocument.js';
import { anyAllow, unconditionalDeny } from '../src/policyEval.js';
import { QUALIFIERS, STACK_NAME_PATTERNS, boundaryPolicyName, type QualifierName } from '../src/qualifiers.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Manifest {
    readonly resourceTypes: readonly string[];
    readonly rolePassedToServices: readonly string[];
    readonly stackNames: readonly string[];
}

const manifest = (qualifier: QualifierName): Manifest =>
    JSON.parse(readFileSync(path.join(here, `../manifests/cfnResourceTypes.${qualifier}.json`), 'utf8')) as Manifest;

const boundaryArn = (qualifier: QualifierName): string =>
    `arn:aws:iam::${ACCOUNT}:policy/${boundaryPolicyName(qualifier)}`;

/** Actions that, granted to a role CloudFormation creates, are a path to account administrator. */
const ESCALATION_ACTIONS: readonly string[] = [
    'iam:CreateUser',
    'iam:CreateAccessKey',
    'iam:CreateLoginProfile',
    'iam:UpdateLoginProfile',
    'iam:AddUserToGroup',
    'iam:CreateGroup',
    'iam:AttachUserPolicy',
    'iam:PutUserPolicy',
    'iam:CreateSAMLProvider',
    'iam:UpdateAccountPasswordPolicy',
    'organizations:CreateAccount',
    'organizations:DescribeOrganization',
    'account:PutAlternateContact',
    'sts:AssumeRole',
];

const allQualifiers = Object.values(QUALIFIERS);
const stageQualifiers = [QUALIFIERS.nonprod, QUALIFIERS.prod] as const;

const parts = (qualifier: QualifierName): readonly PolicyDocument[] =>
    buildExecutionPolicy(qualifier).map((part) => part.document);

const allStatements = (qualifier: QualifierName): readonly Statement[] =>
    parts(qualifier).flatMap((document) => [...document.Statement]);

const allowStatements = (qualifier: QualifierName): readonly Statement[] =>
    allStatements(qualifier).filter((statement) => statement.Effect === 'Allow');

describe.each(allQualifiers)('executionPolicy(%s) — shape', (qualifier) => {
    const built = buildExecutionPolicy(qualifier);

    it('is split into parts that each fit the 6144-character managed policy limit', () => {
        expect(built.length).toBeGreaterThan(1);
        expect(built.length).toBeLessThanOrEqual(10);

        for (const part of built) {
            expect(managedPolicySize(part.document), part.name).toBeLessThan(MANAGED_POLICY_LIMIT);
        }
    });

    it('also fits once the account id and region are rendered in', () => {
        for (const part of built) {
            const rendered = renderDocument(part.document, { account: '123456789012', region: 'us-east-1' });

            expect(managedPolicySize(rendered), part.name).toBeLessThan(MANAGED_POLICY_LIMIT);
            expect(JSON.stringify(rendered)).not.toMatch(/[<>]/u);
        }
    });

    it('gives every statement a unique alphanumeric Sid, across the parts', () => {
        const sids = allStatements(qualifier).map((statement) => statement.Sid);

        expect(new Set(sids).size).toBe(sids.length);

        for (const sid of sids) {
            expect(sid).toMatch(/^[A-Za-z0-9]+$/u);
        }
    });

    it('names every part distinctly', () => {
        const names = built.map((part) => part.name);

        expect(new Set(names).size).toBe(names.length);
    });
});

describe.each(allQualifiers)('executionPolicy(%s) — no administrator shapes', (qualifier) => {
    const allows = allowStatements(qualifier);
    const allowedActions = allows.flatMap((statement) => [...statement.Action]);

    it('never allows Action "*"', () => {
        expect(allowedActions).not.toContain('*');
    });

    it('never allows a service-level wildcard (<service>:*)', () => {
        expect(allowedActions.filter((action) => /:\*$/u.test(action))).toEqual([]);
    });

    it.each(['iam:*', 'organizations:*', 'account:*', 'sts:*', 'kms:*', 'cloudformation:*'])(
        'never allows %s',
        (action) => {
            expect(allowedActions).not.toContain(action);
        },
    );

    it('never allows a user, access-key, login-profile, group or SAML action', () => {
        expect(
            allowedActions.filter(
                (action) => action.startsWith('iam:') && /user|accesskey|loginprofile|group|saml/iu.test(action),
            ),
        ).toEqual([]);
    });

    it('never allows an organizations or account action', () => {
        expect(allowedActions.filter((action) => /^(organizations|account):/u.test(action))).toEqual([]);
    });

    it('never allows sts:AssumeRole', () => {
        expect(allowedActions.filter((action) => action.startsWith('sts:'))).toEqual([]);
    });

    it('never allows creating or editing an OIDC provider except the GitHub token provider (account only)', () => {
        const oidc = allows.filter((statement) => statement.Action.some((action) => /OpenIDConnect/iu.test(action)));

        if (qualifier !== QUALIFIERS.account) {
            expect(oidc).toEqual([]);

            return;
        }

        for (const statement of oidc) {
            expect(statement.Resource).toEqual([
                `arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com`,
            ]);
        }
    });

    it.each(ESCALATION_ACTIONS)('has no Allow that covers %s on any resource', (action) => {
        // The account qualifier may call sts nothing at all either; the only Allows with a wildcard resource are
        // read/describe/create actions of the services in the table, none of which is in ESCALATION_ACTIONS.
        expect(
            allows.filter((statement) =>
                statement.Action.some((pattern) => iamLike(pattern.toLowerCase(), action.toLowerCase())),
            ),
        ).toEqual([]);
    });
});

describe.each(allQualifiers)('executionPolicy(%s) — roles it creates are capped', (qualifier) => {
    const statements = allStatements(qualifier);
    const allows = statements.filter((statement) => statement.Effect === 'Allow');
    const BOUNDARY_GATED = [
        'iam:CreateRole',
        'iam:PutRolePolicy',
        'iam:AttachRolePolicy',
        'iam:PutRolePermissionsBoundary',
    ];

    it.each(BOUNDARY_GATED)('allows %s only with the qualifier permissions boundary', (action) => {
        const granting = allows.filter((statement) => statement.Action.includes(action));

        // The account tier attaches no managed policy: its roles carry inline policies only.
        if (qualifier === QUALIFIERS.account && action === 'iam:AttachRolePolicy') {
            expect(granting).toEqual([]);

            return;
        }

        expect(granting.length).toBeGreaterThan(0);

        for (const statement of granting) {
            expect(statement.Condition?.['StringEquals']?.['iam:PermissionsBoundary']).toBe(boundaryArn(qualifier));
        }
    });

    it('denies removing a permissions boundary from any role', () => {
        expect(
            unconditionalDeny(
                parts(qualifier),
                'iam:DeleteRolePermissionsBoundary',
                `arn:aws:iam::${ACCOUNT}:role/kitchensink-x`,
            ),
        ).toBe(true);
    });

    it('keeps the boundary and execution policies immutable to the role they bind', () => {
        const policyArns = [
            `arn:aws:iam::${ACCOUNT}:policy/kitchensink-ci-boundary-${qualifier}`,
            `arn:aws:iam::${ACCOUNT}:policy/kitchensink-ci-exec-${qualifier}-compute`,
        ];

        for (const arn of policyArns) {
            for (const action of [
                'iam:CreatePolicyVersion',
                'iam:SetDefaultPolicyVersion',
                'iam:DeletePolicy',
                'iam:DeletePolicyVersion',
            ]) {
                expect(unconditionalDeny(parts(qualifier), action, arn), `${action} on ${arn}`).toBe(true);
            }
        }
    });

    it('limits iam:PassRole to kitchensink roles and a named set of services', () => {
        const passRole = allows.filter((statement) => statement.Action.includes('iam:PassRole'));

        for (const statement of passRole) {
            expect(statement.Resource.every((resource) => resource.includes(':role/kitchensink-'))).toBe(true);

            const services = statement.Condition?.['StringEquals']?.['iam:PassedToService'];
            expect(Array.isArray(services)).toBe(true);

            for (const service of services as string[]) {
                expect(PASS_ROLE_SERVICES).toContain(service);
            }
        }
    });

    it('denies assuming any CDK bootstrap role, so a stack cannot re-enter the deploy chain', () => {
        const resource = `arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-deploy-role-${ACCOUNT}-${REGION}`;

        expect(unconditionalDeny(parts(qualifier), 'sts:AssumeRole', resource)).toBe(true);
        expect(
            unconditionalDeny(
                parts(qualifier),
                'sts:AssumeRole',
                `arn:aws:iam::${ACCOUNT}:role/cdk-ksprod-deploy-role-${ACCOUNT}-${REGION}`,
            ),
        ).toBe(true);
    });

    it('denies touching the toolkit stacks', () => {
        for (const stack of [
            'CDKToolkit',
            'kitchensink-bootstrap-ksnonprod',
            'kitchensink-bootstrap-ksprod',
            'kitchensink-bootstrap-ksaccount',
        ]) {
            expect(
                unconditionalDeny(
                    parts(qualifier),
                    'cloudformation:DeleteStack',
                    `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${stack}/id`,
                ),
                stack,
            ).toBe(true);
        }
    });
});

describe.each(stageQualifiers)('executionPolicy(%s) — iam:PassRole covers what the roles trust', (qualifier) => {
    it('admits every service principal a synthesized role trusts', () => {
        const passed = new Set(
            allowStatements(qualifier)
                .filter((statement) => statement.Action.includes('iam:PassRole'))
                .flatMap((statement) => statement.Condition?.['StringEquals']?.['iam:PassedToService'] ?? []),
        );

        for (const service of manifest(qualifier).rolePassedToServices) {
            expect(passed.has(service), service).toBe(true);
        }
    });
});

describe('executionPolicy — tier separation by name', () => {
    it.each(PRODUCTION_NAMES)('ksnonprod refuses %s on %s', (action, resource) => {
        expect(unconditionalDeny(parts(QUALIFIERS.nonprod), action, resource)).toBe(true);
    });

    it.each(NONPROD_NAMES)('ksprod refuses %s on %s', (action, resource) => {
        expect(unconditionalDeny(parts(QUALIFIERS.prod), action, resource)).toBe(true);
    });

    it('does not deny nonprod names to ksnonprod (a Deny that over-matches would stop every deploy)', () => {
        for (const [action, resource] of NONPROD_NAMES) {
            expect(unconditionalDeny(parts(QUALIFIERS.nonprod), action, resource), resource).toBe(false);
        }
    });

    it('does not deny production names to ksprod', () => {
        for (const [action, resource] of PRODUCTION_NAMES) {
            expect(unconditionalDeny(parts(QUALIFIERS.prod), action, resource), resource).toBe(false);
        }
    });

    it.each(stageQualifiers)('%s denies none of the resource names its own tier synthesizes', (qualifier) => {
        // A Deny that over-matches stops every deploy. Each stack name is judged as a stack, and as the prefix of a
        // generated function, queue, bucket and role name (`<stack>-<LogicalId>-<hash>`), the shapes CloudFormation makes.
        for (const stack of manifest(qualifier).stackNames) {
            const resources: ReadonlyArray<readonly [string, string]> = [
                ['cloudformation:CreateStack', `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${stack}/0000-1111`],
                ['lambda:CreateFunction', `${NAME_PREFIX}:function:${stack}-Handler-AbC123xYz`],
                ['sqs:CreateQueue', `arn:aws:sqs:${REGION}:${ACCOUNT}:${stack}-Queue-AbC123xYz`],
                ['s3:CreateBucket', `arn:aws:s3:::${stack}-bucket-abc123xyz`],
                ['iam:CreateRole', `arn:aws:iam::${ACCOUNT}:role/${stack}-TaskRole-AbC123xYz`],
            ];

            for (const [action, resource] of resources) {
                expect(unconditionalDeny(parts(qualifier), action, resource), resource).toBe(false);
            }
        }
    });

    it.each(stageQualifiers)(
        '%s allows creating a function, queue, bucket and role under its own stack names',
        (qualifier) => {
            for (const stack of manifest(qualifier).stackNames) {
                expect(
                    anyAllow(
                        parts(qualifier),
                        'lambda:CreateFunction',
                        `${NAME_PREFIX}:function:${stack}-Handler-AbC123xYz`,
                    ),
                    stack,
                ).toBe(true);
                expect(
                    anyAllow(
                        parts(qualifier),
                        'sqs:CreateQueue',
                        `arn:aws:sqs:${REGION}:${ACCOUNT}:${stack}-Queue-AbC123xYz`,
                    ),
                    stack,
                ).toBe(true);
                expect(
                    anyAllow(parts(qualifier), 's3:CreateBucket', `arn:aws:s3:::${stack}-bucket-abc123xyz`),
                    stack,
                ).toBe(true);
                expect(
                    anyAllow(
                        parts(qualifier),
                        'iam:CreateRole',
                        `arn:aws:iam::${ACCOUNT}:role/${stack}-TaskRole-AbC123xYz`,
                    ),
                    stack,
                ).toBe(true);
            }
        },
    );

    it('keeps the stack patterns of the two stage tiers disjoint over the real stack names', () => {
        const nonprod = manifest(QUALIFIERS.nonprod).stackNames;
        const prod = manifest(QUALIFIERS.prod).stackNames;

        for (const name of nonprod) {
            expect(
                STACK_NAME_PATTERNS.ksprod.some((pattern) => iamLike(pattern, name)),
                name,
            ).toBe(false);
        }

        for (const name of prod) {
            expect(
                STACK_NAME_PATTERNS.ksnonprod.some((pattern) => iamLike(pattern, name)),
                name,
            ).toBe(false);
        }
    });

    it('limits ksnonprod DNS writes to the sandbox zone names, and ksprod refuses them', () => {
        const route53 = (qualifier: QualifierName): readonly Statement[] =>
            allStatements(qualifier).filter((statement) =>
                statement.Action.includes('route53:ChangeResourceRecordSets'),
            );

        for (const statement of route53(QUALIFIERS.nonprod).filter((s) => s.Effect === 'Allow')) {
            const names =
                statement.Condition?.['ForAllValues:StringLike']?.[
                    'route53:ChangeResourceRecordSetsNormalizedRecordNames'
                ];

            expect(Array.isArray(names)).toBe(true);

            for (const name of ['identity.commise.app', 'commise.app', 'clerk.commise.app', '*.commise.app']) {
                expect(
                    (names as string[]).some((pattern) => iamLike(pattern, name)),
                    name,
                ).toBe(false);
            }

            for (const name of ['pr-91.sandbox.commise.app', 'identity.sandbox.commise.app', 'sandbox.commise.app']) {
                expect(
                    (names as string[]).some((pattern) => iamLike(pattern, name)),
                    name,
                ).toBe(true);
            }
        }

        expect(route53(QUALIFIERS.nonprod).some((statement) => statement.Effect === 'Allow')).toBe(true);

        const prodDeny = route53(QUALIFIERS.prod).filter((statement) => statement.Effect === 'Deny');

        expect(prodDeny.length).toBeGreaterThan(0);
    });
});

describe.each(allQualifiers)('executionPolicy(%s) — covers every resource type the apps synthesize', (qualifier) => {
    it('has a grant for each CloudFormation resource type in the committed manifest', () => {
        const covered = new Set(buildExecutionPolicy(qualifier).flatMap((part) => [...part.covers]));
        const missing = manifest(qualifier).resourceTypes.filter(
            (type) => !covered.has(type) && !(type.startsWith('Custom::') && covered.has('Custom::*')),
        );

        expect(missing).toEqual([]);
    });
});

describe('executionPolicy(ksaccount) — touches only its own policies', () => {
    const q = QUALIFIERS.account;
    const policyArn = (name: string): string => `arn:aws:iam::${ACCOUNT}:policy/${name}`;
    const TAMPER_ACTIONS = [
        'iam:CreatePolicyVersion',
        'iam:DeletePolicy',
        'iam:DeletePolicyVersion',
        'iam:SetDefaultPolicyVersion',
    ];
    /** Every customer-managed policy KitchenSink's bootstrap owns, across all three tiers. */
    const EVERY_CI_POLICY = [
        boundaryPolicyName(QUALIFIERS.nonprod),
        boundaryPolicyName(QUALIFIERS.prod),
        boundaryPolicyName(QUALIFIERS.account),
        ...[QUALIFIERS.nonprod, QUALIFIERS.prod, QUALIFIERS.account].flatMap((tier) =>
            buildExecutionPolicy(tier).map((part) => part.policyName),
        ),
    ];

    it('has no Allow that names a managed policy at all (its own stack creates none)', () => {
        // The only consumer of such a grant was the owner-only policy stack, which ksaccount can never deploy.
        const naming = allowStatements(q).filter((statement) =>
            statement.Resource.some((resource) => resource.includes(':policy/')),
        );

        expect(naming.map((statement) => statement.Sid)).toEqual([]);
    });

    it('allows no managed-policy lifecycle or attachment action', () => {
        const actions = allowStatements(q).flatMap((statement) => [...statement.Action]);

        expect(
            actions.filter((action) =>
                /^iam:(CreatePolicy|DeletePolicy|SetDefaultPolicyVersion|AttachRolePolicy)/u.test(action),
            ),
        ).toEqual([]);
    });

    it.each(EVERY_CI_POLICY.flatMap((name) => TAMPER_ACTIONS.map((action) => [name, action] as const)))(
        'denies %s: %s',
        (name, action) => {
            expect(unconditionalDeny(parts(q), action, policyArn(name))).toBe(true);
        },
    );

    it('denies tampering with a kitchensink-ci policy it has never heard of', () => {
        expect(unconditionalDeny(parts(q), 'iam:CreatePolicyVersion', policyArn('kitchensink-ci-anything'))).toBe(true);
    });
});
