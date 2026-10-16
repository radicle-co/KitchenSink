/**
 * The teardown boundary (ADR-0061, ADR-0063): which stacks, services and tasks a role that tears the sandbox down
 * may delete. Two roles hold it — the midnight reclaim Lambda's and CI's `kitchensink-gha-nonprod` — and both are
 * built from ONE function, so this suite judges that function directly and then proves both synthesized roles
 * carry exactly its output.
 *
 * Refusals are judged on the RESOURCE PATTERN with conditions ignored (`policyAdmits`): a tag a resource may or
 * may not carry is defence in depth, never the reason a shared database survives.
 */
import { App, Stack, aws_sns as sns } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { GithubActionsAccessStack } from '../lib/platform/GithubActionsAccessStack.js';
import { SandboxSchedulerStack } from '../lib/platform/SandboxSchedulerStack.js';
import { SHARED_TIER_DELETE_ORDER } from '../lib/sandbox-scheduler/reclaim.js';
import { PRODUCTION_ENVIRONMENT_TAG, teardownGrants } from '../lib/sandbox-scheduler/teardownGrants.js';
import { policyAdmits, type PolicyStatementJson } from './iamGlob.js';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };
const stackArn = (name: string): string =>
    `arn:aws:cloudformation:${env.region}:${env.account}:stack/${name}/0f1e2d3c-aaaa-bbbb-cccc-0123456789ab`;
const ecsArn = (kind: 'service' | 'task', cluster: string, leaf: string): string =>
    `arn:aws:ecs:${env.region}:${env.account}:${kind}/${cluster}/${leaf}`;

const statements: readonly PolicyStatementJson[] = teardownGrants(env, 'Probe').map(
    (statement) => statement.toStatementJson() as PolicyStatementJson,
);

const asList = (value: string | readonly string[] | undefined): readonly string[] =>
    value === undefined ? [] : typeof value === 'string' ? [value] : value;

describe('teardownGrants: what it may delete', () => {
    const stackRows: readonly (readonly [string, string, boolean])[] = [
        // ⛔ sandboxSharedTier.sh "What is NOT in the list, and must never be added".
        ['the shared database', 'kitchensink-data-sandbox', false],
        ['the network', 'kitchensink-network-sandbox', false],
        ['the identity webhooks', 'kitchensink-identity-webhooks-sandbox', false],
        ['the scheduler itself', 'kitchensink-sandbox-scheduler-sandbox', false],
        ['a shared-tier lookalike', 'kitchensink-alb-sandbox-old', false],
        ['production', 'kitchensink-food-service-prod', false],
        ['the production ALB', 'kitchensink-alb-prod', false],
        ['the account-scoped stack', 'kitchensink-github-actions-access', false],
        ['another application`s per-PR stack', 'armoury-api-pr-5', false],
        ['a per-PR stack', 'kitchensink-food-pr-91', true],
        ['a per-PR service stack', 'kitchensink-food-service-pr-91', true],
        ...SHARED_TIER_DELETE_ORDER.map((name) => [`the shared-tier stack ${name}`, name, true] as const),
    ];

    it.each(stackRows)('cloudformation:DeleteStack on %s (%s) -> %s', (_label, name, expected) => {
        expect(policyAdmits(statements, 'cloudformation:DeleteStack', stackArn(name))).toBe(expected);
    });

    it.each([
        ['a per-PR cluster', 'kitchensink-food-service-pr-91-FoodServiceCluster442EDB29-QR9FHWWoNVeo', true],
        ['the shared sandbox cluster', 'kitchensink-identity-service-sandbox-IdentityServiceCluster3A4949E2-jZ', false],
        ['production', 'kitchensink-food-service-prod-FoodServiceCluster442EDB29-xRt2eYoDUrGB', false],
        ['another application`s per-PR cluster', 'armoury-api-pr-5-Cluster-X', false],
    ])('ecs:DeleteService and ecs:StopTask under %s -> %s', (_label, cluster, expected) => {
        expect(policyAdmits(statements, 'ecs:DeleteService', ecsArn('service', cluster, 'api'))).toBe(expected);
        expect(policyAdmits(statements, 'ecs:StopTask', ecsArn('task', cluster, '0123abcd'))).toBe(expected);
    });

    it('grants nothing else: no update, no cluster delete, no log or image delete', () => {
        const allowed = statements.filter((s) => s.Effect === 'Allow').flatMap((s) => asList(s.Action));

        expect(new Set(allowed)).toEqual(new Set(['cloudformation:DeleteStack', 'ecs:DeleteService', 'ecs:StopTask']));
    });

    it('names the shared tier by EXACT stack names, and that set is SHARED_TIER_DELETE_ORDER', () => {
        const base = `arn:aws:cloudformation:${env.region}:${env.account}:stack/`;
        const exact = statements
            .filter((s) => s.Effect === 'Allow' && asList(s.Action).includes('cloudformation:DeleteStack'))
            .flatMap((s) => asList(s.Resource))
            .map((arn) => arn.slice(base.length).replace(/\/\*$/u, ''))
            .filter((name) => !name.includes('*') && !name.includes('?'));

        expect(new Set(exact)).toEqual(new Set(SHARED_TIER_DELETE_ORDER));
        expect(exact).toHaveLength(SHARED_TIER_DELETE_ORDER.length);
    });

    it('⛔ denies every one of its actions on a production-tagged resource, and any DeleteStack that names a role', () => {
        const denies = statements.filter((s) => s.Effect === 'Deny');
        const production = denies.find((s) => s.Condition?.['StringEquals'] !== undefined);
        const namesARole = denies.find((s) => s.Condition?.['Null'] !== undefined);

        expect(new Set(asList(production?.Action))).toEqual(
            new Set(['cloudformation:DeleteStack', 'ecs:DeleteService', 'ecs:StopTask']),
        );
        expect(production?.Condition).toEqual({
            StringEquals: { 'aws:ResourceTag/Environment': PRODUCTION_ENVIRONMENT_TAG },
        });
        // The value is the one the deploy apps stamp, held literally so a rename of the constant cannot pass.
        expect(PRODUCTION_ENVIRONMENT_TAG).toBe('production');
        expect(production?.Resource).toBe('*');
        expect(namesARole?.Condition).toEqual({ Null: { 'cloudformation:RoleArn': 'false' } });
        expect(denies).toHaveLength(2);
    });

    it('labels every statement with the caller`s prefix, so each role keeps its own Sids', () => {
        expect(statements.every((s) => typeof s.Sid === 'string' && s.Sid.startsWith('Probe'))).toBe(true);
        expect(new Set(statements.map((s) => s.Sid)).size).toBe(statements.length);
    });
});

/** Every statement of the policies attached to the role with logical id `roleId`, in the synthesized template. */
const roleStatements = (template: Template, roleId: string): readonly PolicyStatementJson[] =>
    Object.values(template.findResources('AWS::IAM::Policy'))
        .filter((policy) => JSON.stringify(policy['Properties']['Roles']).includes(`"${roleId}"`))
        .flatMap((policy) => policy['Properties']['PolicyDocument']['Statement'] as PolicyStatementJson[]);

/** The boundary statements in a role, with the caller's Sid prefix removed so two roles can be compared. */
const boundaryOf = (all: readonly PolicyStatementJson[], prefix: string): readonly PolicyStatementJson[] => {
    const expected = new Set(teardownGrants(env, prefix).map((s) => s.sid));

    return all
        .filter((s) => s.Sid !== undefined && expected.has(s.Sid))
        .map((s) => ({ ...s, Sid: (s.Sid ?? '').slice(prefix.length) }));
};

describe('teardownGrants: both teardown roles hold exactly it', () => {
    const scheduler = ((app: App) =>
        Template.fromStack(
            new SandboxSchedulerStack(app, 'SandboxScheduler-sandbox', {
                env,
                stage: 'sandbox',
                alarmsEnabled: false,
                alarmTopic: sns.Topic.fromTopicArn(
                    new Stack(app, 'AlarmTopicHost', { env }),
                    'AlarmTopic',
                    'arn:aws:sns:us-east-1:123456789012:kitchensink-alarms-sandbox',
                ),
            }),
        ))(testApp());
    const access = Template.fromStack(new GithubActionsAccessStack(testApp(), 'GithubActionsAccess', { env }));

    const reclaimRoleId = (): string => {
        const fn = Object.values(scheduler.findResources('AWS::Lambda::Function')).find((resource) =>
            String(resource['Properties']['Description']).includes('reclaim'),
        );

        if (fn === undefined) {
            throw new Error('the scheduler stack has no reclaim Lambda');
        }

        return (fn['Properties']['Role'] as { 'Fn::GetAtt': [string, string] })['Fn::GetAtt'][0];
    };

    const nonprodRoleId = (): string =>
        Object.keys(
            access.findResources('AWS::IAM::Role', { Properties: { RoleName: 'kitchensink-gha-nonprod' } }),
        )[0] ?? '';

    it('the reclaim role and the nonprod CI role carry the same boundary, statement for statement', () => {
        const reclaim = boundaryOf(roleStatements(scheduler, reclaimRoleId()), 'SandboxReclaim');
        const nonprod = boundaryOf(roleStatements(access, nonprodRoleId()), 'CiTeardown');

        expect(reclaim).toHaveLength(teardownGrants(env, 'X').length);
        expect(nonprod).toEqual(reclaim);
    });
});
