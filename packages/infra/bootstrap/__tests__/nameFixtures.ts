/**
 * Resource-name fixtures shared by the execution-policy and boundary guards.
 *
 * Two tables of names the tree may or may not hold today: PRODUCTION names the nonprod policy must refuse, and
 * NONPROD names the production policy must refuse. They are written out by hand, per service, so the guard
 * is judged against the CLASS of name (an SSM path, a bucket, a generated function name), not against the current
 * templates alone.
 */
import { ACCOUNT, REGION } from '../src/policyDocument.js';
import type { TierService } from '../src/tierNames.js';

export const NAME_PREFIX = `arn:aws:lambda:${REGION}:${ACCOUNT}`;

/** Names of PRODUCTION things, by service. The nonprod policy must refuse every one of them. */
export const PRODUCTION_NAMES: ReadonlyArray<readonly [string, string]> = [
    ['lambda:UpdateFunctionCode', `${NAME_PREFIX}:function:kitchensink-identity-webhooks-prod-Fn-ABC123`],
    ['sqs:DeleteQueue', `arn:aws:sqs:${REGION}:${ACCOUNT}:kitchensink-recipe-account-erasure-prod`],
    ['s3:DeleteBucket', 'arn:aws:s3:::kitchensink-data-prod-mediabucket-abc123'],
    ['sns:DeleteTopic', `arn:aws:sns:${REGION}:${ACCOUNT}:kitchensink-handle-sync-prod`],
    ['dynamodb:DeleteTable', `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/kitchensink-messages-prod`],
    ['events:DeleteRule', `arn:aws:events:${REGION}:${ACCOUNT}:rule/kitchensink-recipe-archive-sweep-prod`],
    [
        'logs:DeleteLogGroup',
        `arn:aws:logs:${REGION}:${ACCOUNT}:log-group:/aws/lambda/kitchensink-recipe-workers-prod:*`,
    ],
    ['cloudwatch:DeleteAlarms', `arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:kitchensink-deletion-dlq-depth-prod`],
    ['rds:DeleteDBInstance', `arn:aws:rds:${REGION}:${ACCOUNT}:db:kitchensink-data-prod-database-abc`],
    ['ssm:PutParameter', `arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/kitchensink/prod/domain/hosted-zone-id`],
    ['ssm:PutParameter', `arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/kitchensink/identity/prod/webhooks/api/url`],
    [
        'secretsmanager:DeleteSecret',
        `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:kitchensink/prod/edge/origin-header-AbCdEf`,
    ],
    ['iam:PutRolePolicy', `arn:aws:iam::${ACCOUNT}:role/kitchensink-identity-service-prod-TaskRole-ABC`],
    ['cloudformation:DeleteStack', `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/kitchensink-data-prod/0000-1111`],
    ['ecs:DeleteService', `arn:aws:ecs:${REGION}:${ACCOUNT}:service/kitchensink-network-prod-Cluster-ABC/svc`],
    ['states:DeleteStateMachine', `arn:aws:states:${REGION}:${ACCOUNT}:stateMachine:kitchensink-sched-prod-SM-ABC`],
];

/** Names of NONPROD things. The production policy must refuse every one of them. */
export const NONPROD_NAMES: ReadonlyArray<readonly [string, string]> = [
    ['lambda:UpdateFunctionCode', `${NAME_PREFIX}:function:kitchensink-food-service-pr-91-Fn-ABC123`],
    ['lambda:UpdateFunctionCode', `${NAME_PREFIX}:function:kitchensink-identity-webhooks-sandbox-Fn-ABC123`],
    ['sqs:DeleteQueue', `arn:aws:sqs:${REGION}:${ACCOUNT}:kitchensink-recipe-account-erasure-pr-91`],
    ['s3:DeleteBucket', 'arn:aws:s3:::kitchensink-data-sandbox-mediabucket-abc123'],
    ['ssm:PutParameter', `arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/kitchensink/pr-91/domain/hosted-zone-id`],
    ['ssm:PutParameter', `arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/kitchensink/sandbox/domain/hosted-zone-id`],
    [
        'cloudformation:DeleteStack',
        `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/kitchensink-data-sandbox/0000-1111`,
    ],
];

/** Which tier a sample name belongs to. */
export type SampleKind = 'production' | 'sandbox' | 'preview';

/**
 * One concrete resource name per tier for every service the tier Denies cover, in the shapes CloudFormation and the
 * services really produce (a queue, a bucket, a path-named parameter, a generated log group). The Denies are judged
 * against these in BOTH directions: the other tier's name is refused, the policy's own tier's names (sandbox AND
 * preview, or production) are not. Path-named services carry a second, slash-separated shape.
 */
export const TIER_NAME_SAMPLES: ReadonlyArray<{ service: TierService; kind: SampleKind; arn: string }> = (() => {
    const regional = (service: string, resource: string): string =>
        `arn:aws:${service}:${REGION}:${ACCOUNT}:${resource}`;
    const tokens: ReadonlyArray<readonly [SampleKind, string]> = [
        ['production', 'prod'],
        ['sandbox', 'sandbox'],
        ['preview', 'pr-91'],
    ];
    const flat: ReadonlyArray<readonly [TierService, (token: string) => string]> = [
        ['cloudformation', (t) => regional('cloudformation', `stack/kitchensink-data-${t}/0000-1111`)],
        ['cloudwatch', (t) => regional('cloudwatch', `alarm:kitchensink-deletion-dlq-depth-${t}`)],
        ['dynamodb', (t) => regional('dynamodb', `table/kitchensink-messages-${t}`)],
        ['ecr', (t) => regional('ecr', `repository/kitchensink-food-service-${t}`)],
        ['ecs', (t) => regional('ecs', `service/kitchensink-network-${t}-Cluster-ABC/svc`)],
        ['elasticloadbalancing', (t) => regional('elasticloadbalancing', `targetgroup/kitchensink-food-${t}/abc123`)],
        ['events', (t) => regional('events', `rule/kitchensink-recipe-archive-sweep-${t}`)],
        ['iam', (t) => `arn:aws:iam::${ACCOUNT}:role/kitchensink-identity-service-${t}-TaskRole-ABC`],
        ['kms', (t) => regional('kms', `alias/kitchensink-data-${t}`)],
        ['lambda', (t) => regional('lambda', `function:kitchensink-identity-webhooks-${t}-Fn-ABC123`)],
        ['logs', (t) => regional('logs', `log-group:/aws/lambda/kitchensink-recipe-workers-${t}:*`)],
        ['rds', (t) => regional('rds', `db:kitchensink-data-${t}-database-abc`)],
        ['s3', (t) => `arn:aws:s3:::kitchensink-data-${t}-mediabucket-abc123`],
        ['scheduler', (t) => regional('scheduler', `schedule/default/kitchensink-sweep-${t}`)],
        ['secretsmanager', (t) => regional('secretsmanager', `secret:kitchensink-edge-${t}-AbCdEf`)],
        ['sns', (t) => regional('sns', `kitchensink-handle-sync-${t}`)],
        ['sqs', (t) => regional('sqs', `kitchensink-recipe-account-erasure-${t}`)],
        ['ssm', (t) => regional('ssm', `parameter/kitchensink-flag-${t}`)],
        ['states', (t) => regional('states', `stateMachine:kitchensink-sched-${t}-SM-ABC`)],
    ];
    const paths: ReadonlyArray<readonly [TierService, (token: string) => string]> = [
        ['logs', (t) => regional('logs', `log-group:/kitchensink/${t}/edge:*`)],
        ['secretsmanager', (t) => regional('secretsmanager', `secret:kitchensink/${t}/edge/origin-header-AbCdEf`)],
        ['secretsmanager', (t) => regional('secretsmanager', `secret:kitchensink/identity/${t}/webhooks-AbCdEf`)],
        ['ssm', (t) => regional('ssm', `parameter/kitchensink/${t}/domain/hosted-zone-id`)],
        ['ssm', (t) => regional('ssm', `parameter/kitchensink/identity/${t}/webhooks/api/url`)],
        ['ssm', (t) => regional('ssm', `parameter/kitchensink/identity/${t}`)],
    ];

    return [...flat, ...paths].flatMap(([service, build]) =>
        tokens.map(([kind, token]) => ({ service, kind, arn: build(token) })),
    );
})();
