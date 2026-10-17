/**
 * Resource-name fixtures shared by the execution-policy and boundary guards.
 *
 * Two tables of names the tree may or may not hold today: PRODUCTION names the nonprod policy must refuse, and
 * NONPROD names the production policy must refuse. They are written out by hand, per service, so the guard
 * is judged against the CLASS of name (an SSM path, a bucket, a generated function name), not against the current
 * templates alone.
 */
import { ACCOUNT, REGION } from '../src/policyDocument.js';

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
