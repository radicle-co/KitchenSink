/**
 * The permissions boundary caps every role a qualifier's stacks create (ADR-0064), independent of the execution
 * policy: even if a stack were deployed with a template that grants a role `iam:*`, the role cannot exceed the
 * boundary. Two properties carry the weight, and each has a test that reads the document as structure:
 *
 * - the boundary is a SUPERSET of what the synthesized roles really use (`manifests/*.json`), or the first deploy
 *   after a change would create a role that cannot do its job;
 * - the boundary DENIES the escalation shapes and the other tier's names, so a role created from a branch cannot
 *   read production no matter what its own policy says.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AWS_MANAGED_POLICY_ACTIONS, buildBoundary } from '../src/boundary.js';
import { iamLike } from '../src/iamPattern.js';
import { ACCOUNT, MANAGED_POLICY_LIMIT, REGION, managedPolicySize, renderDocument } from '../src/policyDocument.js';
import { unconditionalDeny } from '../src/policyEval.js';
import { QUALIFIERS, type QualifierName } from '../src/qualifiers.js';
import { NONPROD_NAMES, PRODUCTION_NAMES } from './nameFixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Manifest {
    readonly roleActions: readonly string[];
    readonly awsManagedPolicies: readonly string[];
}

const manifest = (qualifier: QualifierName): Manifest =>
    JSON.parse(readFileSync(path.join(here, `../manifests/cfnResourceTypes.${qualifier}.json`), 'utf8')) as Manifest;

const allQualifiers = Object.values(QUALIFIERS);

const allowedPatterns = (qualifier: QualifierName): string[] =>
    buildBoundary(qualifier)
        .Statement.filter((statement) => statement.Effect === 'Allow')
        .flatMap((statement) => [...statement.Action]);

describe.each(allQualifiers)('buildBoundary(%s) — shape', (qualifier) => {
    const boundary = buildBoundary(qualifier);

    it('fits one managed policy, before and after the account and region are rendered in', () => {
        expect(managedPolicySize(boundary)).toBeLessThan(MANAGED_POLICY_LIMIT);
        expect(
            managedPolicySize(renderDocument(boundary, { account: '123456789012', region: 'us-east-1' })),
        ).toBeLessThan(MANAGED_POLICY_LIMIT);
    });

    it('has unique alphanumeric Sids', () => {
        const sids = boundary.Statement.map((statement) => statement.Sid);

        expect(new Set(sids).size).toBe(sids.length);
        sids.forEach((sid) => expect(sid).toMatch(/^[A-Za-z0-9]+$/u));
    });

    it('allows no Action "*", no service-level wildcard, and no iam, organizations or account action', () => {
        const allowed = allowedPatterns(qualifier);

        expect(allowed).not.toContain('*');
        expect(allowed.filter((action) => /:\*$/u.test(action))).toEqual([]);
        // IAM reads (`iam:Get*`, `iam:List*`) and PassRole are the only IAM an Allow may carry; mutations never.
        expect(
            allowed.filter(
                (action) =>
                    /^(iam|organizations|account):/u.test(action) &&
                    action !== 'iam:PassRole' &&
                    !/^iam:(Get|List)[A-Za-z]*$/u.test(action),
            ),
        ).toEqual([]);
    });

    it('allows iam:PassRole only for kitchensink roles', () => {
        const passRole = boundary.Statement.filter(
            (statement) => statement.Effect === 'Allow' && statement.Action.includes('iam:PassRole'),
        );

        for (const statement of passRole) {
            expect(statement.Resource.every((resource) => resource.includes(':role/kitchensink-'))).toBe(true);
        }
    });
});

describe.each(allQualifiers)('buildBoundary(%s) — superset of what the stacks create', (qualifier) => {
    const manifestFor = manifest(qualifier);

    it('allows every action in every role policy the apps synthesize', () => {
        const patterns = allowedPatterns(qualifier);
        const missing = manifestFor.roleActions.filter(
            (action) => !patterns.some((pattern) => iamLike(pattern, action)),
        );

        expect(missing).toEqual([]);
    });

    it('knows the actions of every AWS-managed policy the roles attach, and allows them', () => {
        const patterns = allowedPatterns(qualifier);

        for (const policy of manifestFor.awsManagedPolicies) {
            const actions = AWS_MANAGED_POLICY_ACTIONS[policy];

            expect(actions, `${policy} has no entry in AWS_MANAGED_POLICY_ACTIONS`).toBeDefined();

            for (const action of actions ?? []) {
                expect(
                    patterns.some((pattern) => iamLike(pattern, action)),
                    `${policy}: ${action}`,
                ).toBe(true);
            }
        }
    });

    it('does not itself deny, on every resource, an action the roles use', () => {
        const denied = buildBoundary(qualifier)
            .Statement.filter(
                (statement) =>
                    statement.Effect === 'Deny' &&
                    statement.Condition === undefined &&
                    statement.Resource.includes('*'),
            )
            .flatMap((statement) => [...statement.Action]);

        const collisions = manifestFor.roleActions.filter((action) =>
            denied.some((pattern) => iamLike(pattern, action)),
        );

        expect(collisions).toEqual([]);
    });
});

describe.each(allQualifiers)('buildBoundary(%s) — what no created role may do', (qualifier) => {
    const documents = [buildBoundary(qualifier)];

    it.each([
        'iam:CreateUser',
        'iam:CreateAccessKey',
        'iam:CreateLoginProfile',
        'iam:PutRolePolicy',
        'iam:AttachRolePolicy',
        'iam:CreateRole',
        'iam:UpdateAssumeRolePolicy',
        'iam:CreatePolicyVersion',
        'iam:CreateOpenIDConnectProvider',
        'iam:PutRolePermissionsBoundary',
        'iam:DeleteRolePermissionsBoundary',
        'organizations:CreateAccount',
        'organizations:LeaveOrganization',
        'account:CloseAccount',
    ])('denies %s everywhere', (action) => {
        expect(unconditionalDeny(documents, action, '*')).toBe(true);
    });

    it('denies assuming the default-qualifier bootstrap roles', () => {
        expect(
            unconditionalDeny(
                documents,
                'sts:AssumeRole',
                `arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-deploy-role-${ACCOUNT}-${REGION}`,
            ),
        ).toBe(true);
    });
});

describe('buildBoundary — stage tiers', () => {
    it.each([QUALIFIERS.nonprod, QUALIFIERS.prod])(
        '%s denies every assumption of a bootstrap or CI role',
        (qualifier) => {
            const documents = [buildBoundary(qualifier)];

            for (const role of [
                'cdk-ksnonprod-deploy-role',
                'cdk-ksprod-deploy-role',
                'cdk-ksaccount-deploy-role',
                'kitchensink-gha-prod',
            ]) {
                expect(
                    unconditionalDeny(documents, 'sts:AssumeRole', `arn:aws:iam::${ACCOUNT}:role/${role}`),
                    role,
                ).toBe(true);
            }
        },
    );

    it.each(PRODUCTION_NAMES)('ksnonprod boundary refuses %s on %s', (action, resource) => {
        expect(unconditionalDeny([buildBoundary(QUALIFIERS.nonprod)], action, resource)).toBe(true);
    });

    it.each(NONPROD_NAMES)('ksprod boundary refuses %s on %s', (action, resource) => {
        expect(unconditionalDeny([buildBoundary(QUALIFIERS.prod)], action, resource)).toBe(true);
    });

    it('lets a role call its own tier: no tier Deny matches the other tier fixture', () => {
        // IAM mutations are denied on every resource by design, so they are not a name question.
        const notIam = (pair: readonly [string, string]): boolean => !pair[0].startsWith('iam:');

        for (const [action, resource] of NONPROD_NAMES.filter(notIam)) {
            expect(unconditionalDeny([buildBoundary(QUALIFIERS.nonprod)], action, resource), resource).toBe(false);
        }

        for (const [action, resource] of PRODUCTION_NAMES.filter(notIam)) {
            expect(unconditionalDeny([buildBoundary(QUALIFIERS.prod)], action, resource), resource).toBe(false);
        }
    });
});

describe('buildBoundary — account tier', () => {
    const boundary = buildBoundary(QUALIFIERS.account);

    it('lets the CI roles assume only the KitchenSink bootstrap roles', () => {
        const assume = boundary.Statement.filter(
            (statement) => statement.Effect === 'Allow' && statement.Action.includes('sts:AssumeRole'),
        );

        expect(assume.length).toBe(1);

        for (const resource of assume[0]?.Resource ?? []) {
            expect(resource).toMatch(/:role\/cdk-ks(nonprod|prod|account)-/u);
        }
    });

    it('denies the default qualifier explicitly', () => {
        expect(
            unconditionalDeny(
                [boundary],
                'sts:AssumeRole',
                `arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-cfn-exec-role-${ACCOUNT}-${REGION}`,
            ),
        ).toBe(true);
    });
});
