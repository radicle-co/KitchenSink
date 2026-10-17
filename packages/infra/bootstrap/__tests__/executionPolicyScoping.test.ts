/**
 * Create-versus-modify scoping (ADR-0065): the guard that name scoping alone is NOT the boundary.
 *
 * A name pattern (`kitchensink-*`) plus a Deny on `*-prod*` looks tight and is not, for two measured reasons:
 *
 * - CloudFormation TRUNCATES a generated name (`<stack>-<LogicalId>-<hash>`, capped at 64 characters for Lambda and
 *   IAM roles), and the stage token is the part that is cut: the prod router function is named
 *   `us-east-1SandboxRouterprodRouterFunction...` and another is `kitchensink-sandox...`. A Deny on `-prod` misses
 *   those, and so does a name Allow that is meant to keep a branch out of production.
 * - Some resources are addressed by an id with no name at all (a REST API, a cache policy, an ALB listener), so a name
 *   pattern cannot reach them and an unconditioned Allow on them reaches the other application too.
 *
 * So CREATE actions are scoped by name, and every MODIFY, DELETE or READ-OF-CONFIGURATION action carries the
 * `aws:cloudformation:stack-name` tag condition: a resource without the tag matches nothing, so the grant fails
 * CLOSED. This file holds that rule three ways: by fixture (names the tree does not hold today), by structure (every
 * mutating statement is classified, and an unclassified one fails), and by the residuals being NAMED so no guard implies
 * they are scoped.
 */
import { describe, expect, it } from 'vitest';

import { buildExecutionPolicy } from '../src/executionPolicy.js';
import { ACCOUNT, REGION, type PolicyDocument, type Statement } from '../src/policyDocument.js';
import { unconditionalAllow, unconditionalDeny } from '../src/policyEval.js';
import { QUALIFIERS, STACK_TAG_PATTERNS, type QualifierName } from '../src/qualifiers.js';

const stageQualifiers = [QUALIFIERS.nonprod, QUALIFIERS.prod] as const;
const TAG_KEY = 'aws:ResourceTag/aws:cloudformation:stack-name';

const documents = (qualifier: QualifierName): readonly PolicyDocument[] =>
    buildExecutionPolicy(qualifier).map((part) => part.document);

const statements = (qualifier: QualifierName): readonly Statement[] =>
    documents(qualifier).flatMap((document) => [...document.Statement]);

/** Reachable with certainty: an unconditioned Allow covers it and no unconditioned Deny does. */
const reachable = (qualifier: QualifierName, action: string, resource: string): boolean =>
    unconditionalAllow(documents(qualifier), action, resource) &&
    !unconditionalDeny(documents(qualifier), action, resource);

const READ_ONLY = /^[a-z0-9-]+:(Get|List|Describe|BatchGet|View)/u;

const isMutating = (statement: Statement): boolean => statement.Action.some((action) => !READ_ONLY.test(action));

const carriesOwnStackTag = (statement: Statement, qualifier: QualifierName): boolean => {
    const like = statement.Condition?.['StringLike']?.[TAG_KEY];

    return JSON.stringify(like) === JSON.stringify(STACK_TAG_PATTERNS[qualifier]);
};

/**
 * Mutating statements that are scoped by a CREATE-time name, or by a condition on the REQUEST rather than on the
 * resource (a tag-on-create action, a boundary, a service-linked-role name, a record name, a domain, a KMS service).
 * The resource does not exist yet, or the condition is the whole scope, so a resource tag cannot be asked for.
 */
const CREATE_OR_REQUEST_SCOPED: Readonly<Record<string, string>> = {
    LambdaCreate: 'creates a function under a kitchensink name',
    SqsCreate: 'creates a queue under a kitchensink name',
    SnsCreate: 'creates a topic under a kitchensink name',
    DynamoDbCreate: 'creates a table under a kitchensink name',
    RdsCreate: 'creates a database or subnet group under a kitchensink name',
    EventsCreate: 'creates a rule or bus under a kitchensink name (PutRule also overwrites: the names carry the stage)',
    EcsCreate: 'creates a cluster or service under a kitchensink name',
    EcsRegisterTaskDefinition:
        'RegisterTaskDefinition takes no resource (the family is unprefixed): a NEW revision only',
    LogGroupsCreate: 'creates a log group under a kitchensink name',
    SecretsCreate: 'CreateSecret and GetRandomPassword take no resource',
    ElbCreate: 'creates a load balancer or target group; has no name to scope',
    ElbTagOnCreate: 'elasticloadbalancing:AddTags only while creating (elasticloadbalancing:CreateAction)',
    Ec2Create: 'creates network resources; has no name to scope, tagged at creation by CloudFormation',
    Ec2TagOnCreate: 'ec2:CreateTags only while creating (ec2:CreateAction)',
    CloudFrontCreate: 'creates distributions and policies; has no name to scope',
    AcmRequest: 'requests a certificate for this tier domain only (acm:DomainNames)',
    ApiGatewayCreate: 'creates a REST API or domain name; has no name to scope',
    StatesCreate: 'creates a state machine; the generated name carries no prefix',
    IamCreateCappedRoles: 'creates a role only under the qualifier boundary',
    IamAttachAwsPolicies: 'attaches only the named AWS policies, only under the qualifier boundary',
    IamServiceLinkedRoles: 'creates only the named service-linked roles',
    KmsThroughServices: 'uses a key only through the named services',
    Route53Records: 'writes only this tier record names',
};

/**
 * Mutating statements that are NOT stack-tag scoped and are not create-only. These are the residuals: each is here
 * because the resource type cannot carry the tag or is addressed by an id, and the reason is the reason it cannot.
 * A guard that implied these were scoped would be lying, so they are named, and `executionPolicy.ts` states them.
 */
const NAMED_RESIDUALS: Readonly<Record<string, string>> = {
    S3OwnBuckets: 'CloudFormation tags a bucket AFTER creating it, so a tag condition would refuse the tagging itself',
    SchedulerSchedules: 'schedules cannot be tagged',
    SsmParameters: 'explicit names carry the stage as a path segment; the Deny on the other tier path holds',
    CloudWatchAlarms: 'explicit names end in the stage; the Deny on the other tier names holds',
    CloudWatchDashboards: 'dashboards cannot be tagged; the tier is in the name pattern',
    IamInstanceProfiles: 'instance profiles cannot be tagged',
    CloudFrontPolicies:
        'cache, origin-request, response-headers policies, access controls, key groups, public keys, key-value stores and functions are addressed by id and cannot be tagged',
    AppAutoScaling: 'Application Auto Scaling takes no resource-level scope; limited to ECS service desired count',
    ApiGatewayAccount: 'the account-level API Gateway settings are a singleton',
    LogDeliveries: 'log deliveries take no resource-level scope',
    LambdaEventSourceMappings:
        'an event source mapping is addressed by uuid; limited to kitchensink functions by lambda:FunctionArn',
    SecretsOwn: 'explicit secret names carry the stage as a path segment',
    EcsTagTaskDefinitions: 'a task definition is addressed by family and revision, and a new one has no tag yet',
    ApiGatewayTags: 'the tags of an API Gateway resource are addressed by the tagged resource ARN',
};

describe.each(stageQualifiers)('executionPolicy(%s) — create versus modify', (qualifier) => {
    const mutating = statements(qualifier).filter((statement) => statement.Effect === 'Allow' && isMutating(statement));

    it('classifies EVERY mutating Allow: stack-tag scoped, create/request scoped, or a named residual', () => {
        const unclassified = mutating
            .filter(
                (statement) =>
                    !carriesOwnStackTag(statement, qualifier) &&
                    CREATE_OR_REQUEST_SCOPED[statement.Sid] === undefined &&
                    NAMED_RESIDUALS[statement.Sid] === undefined,
            )
            .map((statement) => statement.Sid);

        expect(unclassified).toEqual([]);
    });

    it('lists no classification for a statement that is not in the policy (a stale entry hides the next gap)', () => {
        const sids = new Set(statements(qualifier).map((statement) => statement.Sid));
        const stale = [...Object.keys(CREATE_OR_REQUEST_SCOPED), ...Object.keys(NAMED_RESIDUALS)].filter(
            (sid) => !sids.has(sid) && qualifier === QUALIFIERS.nonprod,
        );

        expect(stale).toEqual([]);
    });

    it('never lets a stack-tag statement and a create statement be the same statement', () => {
        const both = mutating.filter(
            (statement) =>
                carriesOwnStackTag(statement, qualifier) && CREATE_OR_REQUEST_SCOPED[statement.Sid] !== undefined,
        );

        expect(both.map((statement) => statement.Sid)).toEqual([]);
    });

    it('keeps a create statement to create-class actions', () => {
        const createSids = new Set(Object.keys(CREATE_OR_REQUEST_SCOPED));
        const offenders = mutating
            .filter((statement) => createSids.has(statement.Sid))
            .flatMap((statement) => statement.Action.map((action) => `${statement.Sid}:${action}`))
            .filter((entry) =>
                /:[a-z0-9-]+:(Delete|Update|Modify|Detach|Disassociate|Remove|Revoke|Terminate|Stop)/iu.test(entry),
            );

        expect(offenders).toEqual([]);
    });
});

/** Mutating actions on resources whose names CloudFormation truncated so the stage token is gone. */
const TRUNCATED_NAMES = (stagePrefix: string): ReadonlyArray<readonly [string, string]> => [
    [
        'lambda:UpdateFunctionCode',
        `arn:aws:lambda:${REGION}:${ACCOUNT}:function:kitchensink-${stagePrefix}-webho-DeletionFn-ABC123`,
    ],
    [
        'lambda:DeleteFunction',
        `arn:aws:lambda:${REGION}:${ACCOUNT}:function:kitchensink-${stagePrefix}-webho-DeletionFn-ABC123`,
    ],
    [
        'lambda:UpdateFunctionConfiguration',
        `arn:aws:lambda:${REGION}:${ACCOUNT}:function:kitchensink-${stagePrefix}-webho-DeletionFn-ABC123`,
    ],
    ['iam:UpdateAssumeRolePolicy', `arn:aws:iam::${ACCOUNT}:role/kitchensink-${stagePrefix}-servi-TaskRole-ABC123`],
    ['iam:DeleteRole', `arn:aws:iam::${ACCOUNT}:role/kitchensink-${stagePrefix}-servi-TaskRole-ABC123`],
    ['iam:PassRole', `arn:aws:iam::${ACCOUNT}:role/kitchensink-${stagePrefix}-servi-TaskRole-ABC123`],
    ['sqs:DeleteQueue', `arn:aws:sqs:${REGION}:${ACCOUNT}:kitchensink-${stagePrefix}-recip-Queue-ABC123`],
    ['sns:DeleteTopic', `arn:aws:sns:${REGION}:${ACCOUNT}:kitchensink-${stagePrefix}-handl-Topic-ABC123`],
    [
        'dynamodb:DeleteTable',
        `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/kitchensink-${stagePrefix}-messa-Table-ABC123`,
    ],
    [
        'ecs:UpdateService',
        `arn:aws:ecs:${REGION}:${ACCOUNT}:service/kitchensink-${stagePrefix}-netwo-Cluster-ABC123/svc`,
    ],
    ['ecs:DeleteCluster', `arn:aws:ecs:${REGION}:${ACCOUNT}:cluster/kitchensink-${stagePrefix}-netwo-Cluster-ABC123`],
    ['events:DeleteRule', `arn:aws:events:${REGION}:${ACCOUNT}:rule/kitchensink-${stagePrefix}-recip-Rule-ABC123`],
    ['rds:DeleteDBInstance', `arn:aws:rds:${REGION}:${ACCOUNT}:db:kitchensink-${stagePrefix}-data-databa-abc123`],
    [
        'logs:DeleteLogGroup',
        `arn:aws:logs:${REGION}:${ACCOUNT}:log-group:kitchensink-${stagePrefix}-recip-Group-ABC123`,
    ],
];

/** Mutating actions on things the OTHER application owns, shaped the way they are really addressed. */
const OTHER_APPLICATION: ReadonlyArray<readonly [string, string]> = [
    ['apigateway:PATCH', `arn:aws:apigateway:${REGION}::/restapis/abc123`],
    ['apigateway:DELETE', `arn:aws:apigateway:${REGION}::/restapis/abc123/stages/live`],
    ['apigateway:PUT', `arn:aws:apigateway:${REGION}::/domainnames/api.armoury.example`],
    ['ecs:DeregisterTaskDefinition', `arn:aws:ecs:${REGION}:${ACCOUNT}:task-definition/armoury-api:3`],
    ['ecs:UpdateService', `arn:aws:ecs:${REGION}:${ACCOUNT}:service/armoury-cluster/api`],
    [
        'elasticloadbalancing:CreateRule',
        `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:listener/app/armoury-alb/abc/def`,
    ],
    [
        'elasticloadbalancing:ModifyListener',
        `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:listener/app/armoury-alb/abc/def`,
    ],
    [
        'elasticloadbalancing:DeleteLoadBalancer',
        `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:loadbalancer/app/armoury-alb/abc`,
    ],
    ['lambda:UpdateFunctionCode', `arn:aws:lambda:${REGION}:${ACCOUNT}:function:armoury-handler`],
    ['iam:UpdateAssumeRolePolicy', `arn:aws:iam::${ACCOUNT}:role/armoury-task`],
    ['sqs:DeleteQueue', `arn:aws:sqs:${REGION}:${ACCOUNT}:armoury-queue`],
    ['ec2:DeleteSecurityGroup', `arn:aws:ec2:${REGION}:${ACCOUNT}:security-group/sg-0123456789abcdef0`],
    ['ec2:AuthorizeSecurityGroupIngress', `arn:aws:ec2:${REGION}:${ACCOUNT}:security-group/sg-0123456789abcdef0`],
    ['ec2:TerminateInstances', `arn:aws:ec2:${REGION}:${ACCOUNT}:instance/i-0123456789abcdef0`],
    ['cloudfront:UpdateDistribution', `arn:aws:cloudfront::${ACCOUNT}:distribution/E1ABCDEFGHIJKL`],
    ['acm:DeleteCertificate', `arn:aws:acm:${REGION}:${ACCOUNT}:certificate/00000000-0000-0000-0000-000000000000`],
    ['states:DeleteStateMachine', `arn:aws:states:${REGION}:${ACCOUNT}:stateMachine:armoury-flow`],
    ['rds:DeleteDBInstance', `arn:aws:rds:${REGION}:${ACCOUNT}:db:armoury-db`],
];

describe('executionPolicy — a modify is unreachable without the stack-name tag', () => {
    it.each(TRUNCATED_NAMES('identity'))(
        'ksnonprod cannot %s on a truncated production name %s',
        (action, resource) => {
            expect(reachable(QUALIFIERS.nonprod, action, resource)).toBe(false);
        },
    );

    it.each(TRUNCATED_NAMES('food'))('ksprod cannot %s on a truncated nonprod name %s', (action, resource) => {
        expect(reachable(QUALIFIERS.prod, action, resource)).toBe(false);
    });

    it.each(stageQualifiers)('%s cannot change anything the other application owns', (qualifier) => {
        for (const [action, resource] of OTHER_APPLICATION) {
            expect(reachable(qualifier, action, resource), `${action} on ${resource}`).toBe(false);
        }
    });

    it('keeps the production router function out of reach of the nonprod tier even though its name has no "-prod"', () => {
        const router = `arn:aws:cloudfront::${ACCOUNT}:function/us-east-1SandboxRouterprodRouterFunction19C5793B`;

        expect(reachable(QUALIFIERS.nonprod, 'cloudfront:UpdateFunction', router)).toBe(false);
        expect(reachable(QUALIFIERS.nonprod, 'cloudfront:DeleteFunction', router)).toBe(false);
    });

    it('still lets the nonprod tier change its own preview router function', () => {
        const router = `arn:aws:cloudfront::${ACCOUNT}:function/us-east-1SandboxRouterpr1RouterFunctionDCCB2930`;

        expect(unconditionalAllow(documents(QUALIFIERS.nonprod), 'cloudfront:UpdateFunction', router)).toBe(true);
        expect(unconditionalDeny(documents(QUALIFIERS.nonprod), 'cloudfront:UpdateFunction', router)).toBe(false);
    });
});

describe.each(stageQualifiers)('executionPolicy(%s) — deploy-time reads', (qualifier) => {
    it('can read the bootstrap-version parameter CloudFormation resolves for every stack', () => {
        const readable = statements(qualifier).some(
            (statement) =>
                statement.Effect === 'Allow' &&
                statement.Action.includes('ssm:GetParameters') &&
                statement.Resource.includes(
                    `arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/cdk-bootstrap/${qualifier}/version`,
                ),
        );

        expect(readable).toBe(true);
    });
});
