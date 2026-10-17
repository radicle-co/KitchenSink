/**
 * The boundary bounds RESOURCES, not only actions (ADR-0065).
 *
 * A boundary that lists the actions the stacks use but allows them on `*` caps nothing that matters: a branch workflow
 * deploys a stack whose Lambda role carries an inline `secretsmanager:GetSecretValue` on `*`, invokes it, and the
 * effective permission (policy intersect boundary) reads the OTHER application's secrets, objects and parameters in
 * this shared account. So every action that has a resource-level form is allowed only on kitchensink names, and the few
 * that cannot be scoped are NAMED (`STAR_RESOURCE_ACTIONS`, `OTHER_APPLICATION_REACH`) and judged both ways.
 *
 * Four guards, each of which fails when its property is broken:
 *
 * 1. no data-plane action (queue, topic, secret, parameter, object, invoke, database login) sits on a bare `*`;
 * 2. a table of other-application ARNs, judged against EVERY action the boundary allows, is refused except for the
 *    named residuals, and every named residual really does admit one (so the list cannot rot in either direction);
 * 3. every (action, resource) a synthesized role policy writes is admitted (a guard that only restricts would pass
 *    on a boundary that breaks every stack);
 * 4. the database logins the boundary names are exactly the logins the service registry names.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import { describe, expect, it } from 'vitest';

import { allows, type RequestContext } from './boundaryEval.js';
import {
    AWS_MANAGED_POLICY_ACTIONS,
    OTHER_APPLICATION_REACH,
    STAR_RESOURCE_ACTIONS,
    buildBoundary,
} from '../src/boundary.js';
import { renderDocument, type PolicyDocument } from '../src/policyDocument.js';
import { QUALIFIERS, type QualifierName } from '../src/qualifiers.js';
import { ACCOUNT_ID, REGION_NAME, type RoleStatement } from '../src/roleStatements.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Manifest {
    readonly roleStatements: readonly RoleStatement[];
    readonly awsManagedPolicies: readonly string[];
}

const manifest = (qualifier: QualifierName): Manifest =>
    JSON.parse(readFileSync(path.join(here, `../manifests/cfnResourceTypes.${qualifier}.json`), 'utf8')) as Manifest;

const allQualifiers = Object.values(QUALIFIERS);

const rendered = (qualifier: QualifierName): PolicyDocument =>
    renderDocument(buildBoundary(qualifier), { account: ACCOUNT_ID, region: REGION_NAME });

const allowStatements = (qualifier: QualifierName) =>
    buildBoundary(qualifier).Statement.filter((statement) => statement.Effect === 'Allow');

const allowedActions = (qualifier: QualifierName): string[] => [
    ...new Set(allowStatements(qualifier).flatMap((statement) => [...statement.Action])),
];

/** Actions that read or write DATA, or log in, or invoke: never on a bare `*`. */
const DATA_PLANE =
    /^(sqs|sns|dynamodb|rds-db|bedrock|s3|secretsmanager|ssm|kms|cloudfront-keyvaluestore):|^lambda:(Invoke|Get)|^events:PutEvents$|^logs:(GetLogEvents|FilterLogEvents|DescribeLogStreams|PutLogEvents|CreateLogStream|CreateLogGroup)$/u;

describe.each(allQualifiers)('buildBoundary(%s) — no data-plane action on a bare "*"', (qualifier) => {
    it('allows only named residual actions on "*", and none of them is a data-plane action', () => {
        const onStar = allowStatements(qualifier)
            .filter((statement) => statement.Resource.includes('*'))
            .flatMap((statement) => [...statement.Action]);

        expect(onStar.filter((action) => !(action in STAR_RESOURCE_ACTIONS))).toEqual([]);
        expect(onStar.filter((action) => DATA_PLANE.test(action))).toEqual([]);
    });

    it('names no residual that the boundary does not use on "*" (the list cannot rot)', () => {
        const used = new Set(
            allowStatements(qualifier)
                .filter((statement) => statement.Resource.includes('*'))
                .flatMap((statement) => [...statement.Action]),
        );
        const everUsed = new Set(
            allQualifiers.flatMap((other) =>
                allowStatements(other)
                    .filter((statement) => statement.Resource.includes('*'))
                    .flatMap((statement) => [...statement.Action]),
            ),
        );

        expect(Object.keys(STAR_RESOURCE_ACTIONS).filter((action) => !everUsed.has(action))).toEqual([]);
        expect(used.size).toBeGreaterThan(0);
    });

    it('gives every named residual a reason, and says whether it READS or WRITES and what the write can reach', () => {
        for (const reason of Object.values(STAR_RESOURCE_ACTIONS)) {
            expect(reason).toMatch(/^(READ|WRITE): .{25,}/u);
        }

        for (const reason of Object.values(OTHER_APPLICATION_REACH)) {
            expect(reason.length).toBeGreaterThan(20);
        }
    });

    it('describes every write residual by what it can do to the other application', () => {
        for (const [action, reason] of Object.entries(STAR_RESOURCE_ACTIONS)) {
            if (reason.startsWith('WRITE: ') && !action.startsWith('xray:')) {
                expect(reason, action).toMatch(/other application|any |every |account/u);
            }
        }
    });
});

/**
 * Resources that belong to the OTHER application sharing this account. Each is the shape a real name would have,
 * including the CloudFormation-generated secret name that is NOT prefixed (`DatabaseCredentialsSecret...`), which
 * is exactly what a name-only rule would let through.
 */
const ARMOURY = (r = REGION_NAME, a = ACCOUNT_ID): ReadonlyArray<{ resource: string; context: RequestContext }> => {
    const tag = 'secretsmanager:ResourceTag/aws:cloudformation:stack-name';
    const ec2Tag = 'ec2:ResourceTag/aws:cloudformation:stack-name';
    const resourceTag = 'aws:ResourceTag/aws:cloudformation:stack-name';

    return [
        { resource: `arn:aws:secretsmanager:${r}:${a}:secret:armoury/prod/db-AbCdEf`, context: {} },
        { resource: `arn:aws:secretsmanager:${r}:${a}:secret:DatabaseCredentialsSecret7483BC14-AbCdEf`, context: {} },
        {
            resource: `arn:aws:secretsmanager:${r}:${a}:secret:DatabaseCredentialsSecret7483BC14-AbCdEf`,
            context: {
                [tag]: 'armoury-data-prod',
                [ec2Tag]: 'armoury-data-prod',
                [resourceTag]: 'armoury-data-prod',
            },
        },
        { resource: 'arn:aws:s3:::armoury-uploads-prod', context: {} },
        { resource: 'arn:aws:s3:::armoury-uploads-prod/users/1/photo.png', context: {} },
        { resource: `arn:aws:ssm:${r}:${a}:parameter/armoury/prod/db-password`, context: {} },
        { resource: `arn:aws:lambda:${r}:${a}:function:armoury-api-prod`, context: {} },
        {
            resource: `arn:aws:lambda:${r}:${a}:function:armoury-api-prod`,
            context: { [resourceTag]: 'armoury-api-prod' },
        },
        { resource: `arn:aws:lambda:${r}:${a}:function:armoury-api-prod:7`, context: {} },
        { resource: `arn:aws:dynamodb:${r}:${a}:table/armoury-sessions`, context: {} },
        { resource: `arn:aws:sqs:${r}:${a}:armoury-jobs`, context: {} },
        { resource: `arn:aws:sns:${r}:${a}:armoury-alerts`, context: {} },
        { resource: `arn:aws:events:${r}:${a}:event-bus/armoury-bus`, context: {} },
        { resource: `arn:aws:events:${r}:${a}:rule/armoury-nightly`, context: {} },
        { resource: `arn:aws:ecr:${r}:${a}:repository/armoury-api`, context: {} },
        { resource: `arn:aws:logs:${r}:${a}:log-group:/aws/lambda/armoury-api-prod:*`, context: {} },
        { resource: `arn:aws:logs:${r}:${a}:log-group:/armoury/app:*`, context: {} },
        { resource: `arn:aws:ecs:${r}:${a}:cluster/armoury-cluster`, context: {} },
        { resource: `arn:aws:ecs:${r}:${a}:service/armoury-cluster/api`, context: {} },
        { resource: `arn:aws:ecs:${r}:${a}:task/armoury-cluster/0123456789abcdef`, context: {} },
        {
            resource: `arn:aws:ecs:${r}:${a}:task-definition/armoury-api:3`,
            context: { 'ecs:cluster': `arn:aws:ecs:${r}:${a}:cluster/armoury-cluster` },
        },
        { resource: `arn:aws:cloudformation:${r}:${a}:stack/armoury-data-prod/0000-1111`, context: {} },
        { resource: `arn:aws:rds:${r}:${a}:db:armoury-prod-db`, context: {} },
        { resource: `arn:aws:rds-db:${r}:${a}:dbuser:db-ARMOURY123/armoury_app`, context: {} },
        {
            resource: `arn:aws:ec2:${r}:${a}:instance/i-0123456789abcdef0`,
            context: { [ec2Tag]: 'armoury-network-prod' },
        },
        { resource: `arn:aws:states:${r}:${a}:stateMachine:armoury-flow`, context: {} },
        {
            resource: `arn:aws:states:${r}:${a}:stateMachine:ArmouryFlow-AbCdEf`,
            context: { [resourceTag]: 'armoury-flow-prod' },
        },
        { resource: `arn:aws:bedrock:${r}::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0`, context: {} },
        { resource: `arn:aws:iam::${a}:role/armoury-task-role`, context: {} },
        { resource: `arn:aws:iam::${a}:role/cdk-hnb659fds-deploy-role-${a}-${r}`, context: {} },
        { resource: `arn:aws:cloudfront::${a}:distribution/E2ARMOURY12345`, context: {} },
        { resource: `arn:aws:cloudfront::${a}:key-value-store/armoury-kvs`, context: {} },
        { resource: 'arn:aws:route53:::hostedzone/ZARMOURY123', context: {} },
    ];
};

describe.each(allQualifiers)('buildBoundary(%s) — the other application is out of reach', (qualifier) => {
    const document = rendered(qualifier);

    it('refuses every other-application resource for every action, except the NAMED residuals', () => {
        const admitted = new Set<string>();

        for (const action of allowedActions(qualifier)) {
            for (const { resource, context } of ARMOURY()) {
                if (allows(document, action, resource, context)) {
                    admitted.add(action);
                }
            }
        }

        const undeclared = [...admitted].filter(
            (action) => !(action in STAR_RESOURCE_ACTIONS) && !(action in OTHER_APPLICATION_REACH),
        );

        expect(undeclared).toEqual([]);
    });

    it('does not name an other-application residual that the boundary does not really admit', () => {
        const admitted = new Set<string>();
        const everyone = allQualifiers.flatMap((other) => {
            const doc = rendered(other);

            return allowedActions(other).flatMap((action) =>
                ARMOURY().some(({ resource, context }) => allows(doc, action, resource, context)) ? [action] : [],
            );
        });

        everyone.forEach((action) => admitted.add(action));

        expect(Object.keys(OTHER_APPLICATION_REACH).filter((action) => !admitted.has(action))).toEqual([]);
    });

    it.each([
        [
            'secretsmanager:GetSecretValue',
            `arn:aws:secretsmanager:${REGION_NAME}:${ACCOUNT_ID}:secret:armoury/prod/db-AbCdEf`,
        ],
        ['s3:GetObject*', 'arn:aws:s3:::armoury-uploads-prod/users/1/photo.png'],
        ['ssm:GetParameters', `arn:aws:ssm:${REGION_NAME}:${ACCOUNT_ID}:parameter/armoury/prod/db-password`],
        ['lambda:InvokeFunction', `arn:aws:lambda:${REGION_NAME}:${ACCOUNT_ID}:function:armoury-api-prod`],
        ['dynamodb:PutItem', `arn:aws:dynamodb:${REGION_NAME}:${ACCOUNT_ID}:table/armoury-sessions`],
        ['sqs:SendMessage', `arn:aws:sqs:${REGION_NAME}:${ACCOUNT_ID}:armoury-jobs`],
        ['sqs:ReceiveMessage', `arn:aws:sqs:${REGION_NAME}:${ACCOUNT_ID}:armoury-jobs`],
        ['sns:Publish', `arn:aws:sns:${REGION_NAME}:${ACCOUNT_ID}:armoury-alerts`],
        ['rds-db:connect', `arn:aws:rds-db:${REGION_NAME}:${ACCOUNT_ID}:dbuser:db-ARMOURY123/armoury_app`],
        [
            'bedrock:InvokeModel',
            `arn:aws:bedrock:${REGION_NAME}::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0`,
        ],
    ])('refuses %s on %s, tagged or not', (action, resource) => {
        for (const tagValue of [undefined, 'armoury-data-prod']) {
            const context: RequestContext =
                tagValue === undefined ? {} : { 'secretsmanager:ResourceTag/aws:cloudformation:stack-name': tagValue };

            expect(
                allows(document, action, resource, context),
                `${qualifier} ${action} ${resource} tag=${tagValue}`,
            ).toBe(false);
        }
    });
});

describe('buildBoundary — a truncated generated name does not carry its stage token', () => {
    // CloudFormation truncates a generated name to 64 characters and the stage token is the part cut, so this production
    // function's name matches neither the production Deny nor `-prod`. Only its stack-name TAG says whose it is.
    const truncated = `arn:aws:lambda:${REGION_NAME}:${ACCOUNT_ID}:function:kitchensink-identity-webhooks-p-ErasureReconciliationFu-AbC123`;
    const tag = 'aws:ResourceTag/aws:cloudformation:stack-name';

    it('keeps the non-production boundary from invoking it', () => {
        expect(
            allows(rendered(QUALIFIERS.nonprod), 'lambda:InvokeFunction', truncated, {
                [tag]: 'kitchensink-identity-webhooks-prod',
            }),
        ).toBe(false);
    });

    it('lets the production boundary invoke it, and the non-production one invoke its own', () => {
        expect(
            allows(rendered(QUALIFIERS.prod), 'lambda:InvokeFunction', truncated, {
                [tag]: 'kitchensink-identity-webhooks-prod',
            }),
        ).toBe(true);
        expect(
            allows(rendered(QUALIFIERS.nonprod), 'lambda:InvokeFunction', truncated, {
                [tag]: 'kitchensink-identity-webhooks-sandbox',
            }),
        ).toBe(true);
    });

    it('keeps the production boundary from invoking a non-production function whose name lost its token', () => {
        expect(
            allows(rendered(QUALIFIERS.prod), 'lambda:InvokeFunction', truncated, {
                [tag]: 'kitchensink-identity-webhooks-pr-91',
            }),
        ).toBe(false);
    });
});

describe.each(allQualifiers)('buildBoundary(%s) — admits every role statement the apps synthesize', (qualifier) => {
    const document = rendered(qualifier);
    const statements = manifest(qualifier).roleStatements;
    const tierToken = qualifier === QUALIFIERS.prod ? 'prod' : 'sandbox';
    const sampleTag = `kitchensink-x-${tierToken}`;

    // The facts a request carries when a kitchensink stack's role makes the call: its resources are tagged by
    // CloudFormation with that stack's name, and its cluster is a kitchensink cluster.
    const contexts: RequestContext[] =
        qualifier === QUALIFIERS.account
            ? ['kitchensink-x-sandbox', 'kitchensink-x-prod'].map((tag) => contextFor(tag))
            : [contextFor(sampleTag)];

    function contextFor(tag: string): RequestContext {
        return {
            'secretsmanager:ResourceTag/aws:cloudformation:stack-name': tag,
            'ec2:ResourceTag/aws:cloudformation:stack-name': tag,
            'aws:ResourceTag/aws:cloudformation:stack-name': tag,
            'ecs:cluster': `arn:aws:ecs:${REGION_NAME}:${ACCOUNT_ID}:cluster/kitchensink-x`,
        };
    }

    it('has statements to judge (a vacuous pass is not a pass)', () => {
        expect(statements.length).toBeGreaterThan(20);
    });

    it('leaves no reference unresolved', () => {
        expect(statements.filter((statement) => statement.resources.some((r) => r.includes('UNRESOLVED')))).toEqual([]);
    });

    it('admits every (action, resource) pair', () => {
        const refused: string[] = [];

        for (const statement of statements) {
            for (const action of statement.actions) {
                for (const resource of statement.resources) {
                    if (!contexts.some((context) => allows(document, action, resource, context, true))) {
                        refused.push(`${action} ${resource}`);
                    }
                }
            }
        }

        // The one deliberate refusal: the CI roles still hold an Allow on the DEFAULT qualifier's bootstrap roles during
        // the expand phase of the migration (ADR-0065 Decision 11), and the account boundary denies exactly those. Deploying
        // the CI-role stack under this qualifier is the owner step that cuts the old path; nothing else is refused.
        const expandPhase = refused.filter(
            (pair) => pair.startsWith('sts:AssumeRole ') && pair.includes(':role/cdk-hnb659fds-'),
        );

        expect(refused.filter((pair) => !expandPhase.includes(pair))).toEqual([]);
        expect(expandPhase.length === 0 || qualifier === QUALIFIERS.account).toBe(true);
    });

    it('admits the AWS-managed policies the roles attach, on the resources they are used on', () => {
        // Their documents grant these on "*"; what matters is the boundary leaves the resources the stacks make.
        const used: Readonly<Record<string, string>> = {
            logs: `arn:aws:logs:${REGION_NAME}:${ACCOUNT_ID}:log-group:/aws/lambda/kitchensink-x-${tierToken}-Fn:*`,
            ecr: `arn:aws:ecr:${REGION_NAME}:${ACCOUNT_ID}:repository/kitchensink-food`,
            ec2: '*',
        };

        for (const policy of manifest(qualifier).awsManagedPolicies) {
            for (const action of AWS_MANAGED_POLICY_ACTIONS[policy] ?? []) {
                const resource = used[action.split(':')[0] ?? ''] ?? '*';

                expect(
                    contexts.some((context) => allows(document, action, resource, context, true)),
                    `${policy}: ${action}`,
                ).toBe(true);
            }
        }
    });
});

describe('buildBoundary — database logins', () => {
    it.each([QUALIFIERS.nonprod, QUALIFIERS.prod])(
        '%s admits a login prefix for exactly the databases of the registry, and matches every login in it',
        (qualifier) => {
            const patterns = allowStatements(qualifier)
                .filter((statement) => statement.Action.includes('rds-db:connect'))
                .flatMap((statement) =>
                    statement.Resource.filter((resource) => resource.startsWith('arn:aws:rds-db:')),
                );
            const users = patterns.map((resource) => resource.split('/').pop() ?? '');

            expect([...users].sort()).toEqual(
                Object.keys(DATABASE_ROLES)
                    .map((database) => `${database}_*`)
                    .sort(),
            );

            const document = rendered(qualifier);

            for (const roles of Object.values(DATABASE_ROLES)) {
                for (const login of [roles.migrator, roles.app, ...('seeder' in roles ? [roles.seeder] : [])]) {
                    expect(
                        allows(
                            document,
                            'rds-db:connect',
                            `arn:aws:rds-db:${REGION_NAME}:${ACCOUNT_ID}:dbuser:db-ABC/${login}`,
                        ),
                        login,
                    ).toBe(true);
                }
            }
        },
    );

    it('the account tier has no database login at all', () => {
        expect(allowedActions(QUALIFIERS.account).filter((action) => action.startsWith('rds-db:'))).toEqual([]);
    });
});
