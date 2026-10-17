/**
 * @module boundary — the permissions boundary applied to every role a qualifier's stacks create (ADR-0065).
 *
 * The execution policy decides what CloudFormation may BUILD; the boundary decides what anything it built may DO,
 * whatever that thing's own policy says. A branch deploy that writes a role with `iam:*` still gets a role that
 * cannot call IAM, and a role created in the sandbox tier cannot read a production name.
 *
 * ## The two halves
 *
 * - **Allow** is a table: the actions the synthesized roles really use, derived from the apps by
 *   `scripts/deriveResourceTypes.ts` and committed in `manifests/`. `boundary.test.ts` holds the table to be a
 *   SUPERSET of the committed manifest, so a new construct that needs a new action fails a test, not a deploy. It
 *   is deliberately not a `<service>:*` list: widening a role past what the apps use is a reviewed change here.
 * - **Deny** is the escalation set (every IAM mutation, organizations, account, the bootstrap and CI roles) and the
 *   other tier's names. Denies win over any Allow in a role's own policy.
 *
 * ⚠️ `rds-db:connect` cannot be separated by tier here: its resource is an opaque `dbuser:<resource id>/<user>`
 * with no name to match. The separation for database access rests on the role's own resource, which comes from its
 * own stack, and on the execution policy that only lets a tier deploy its own stacks.
 *
 * @pattern Specification / policy module — a capability cap judged by a superset guard and an escalation guard
 */
import { ACCOUNT, REGION, type PolicyDocument, type Statement } from './policyDocument.js';
import { QUALIFIERS, type QualifierName } from './qualifiers.js';

const SERVICE_RUNTIME_ACTIONS: readonly string[] = [
    'bedrock:InvokeModel',
    'cloudfront:CreateInvalidation',
    'dynamodb:PutItem',
    'ec2:AssignPrivateIpAddresses',
    'ec2:CreateNetworkInterface',
    'ec2:DeleteNetworkInterface',
    'ec2:DescribeNetworkInterfaces',
    'ec2:DescribeSubnets',
    'ec2:UnassignPrivateIpAddresses',
    'ecr:BatchCheckLayerAvailability',
    'ecr:BatchGetImage',
    'ecr:GetAuthorizationToken',
    'ecr:GetDownloadUrlForLayer',
    'ecs:RunTask',
    'ecs:TagResource',
    'events:PutEvents',
    'lambda:GetFunction',
    'lambda:InvokeFunction',
    'logs:CreateLogGroup',
    'logs:CreateLogStream',
    'logs:DescribeLogGroups',
    'logs:DescribeLogStreams',
    'logs:FilterLogEvents',
    'logs:GetLogEvents',
    'logs:PutLogEvents',
    'rds-db:connect',
    's3:Abort*',
    's3:DeleteObject',
    's3:DeleteObject*',
    's3:GetBucket*',
    's3:GetObject*',
    's3:List*',
    's3:ListBucket',
    's3:PutObject',
    's3:PutObjectLegalHold',
    's3:PutObjectRetention',
    's3:PutObjectTagging',
    's3:PutObjectVersionTagging',
    'secretsmanager:DescribeSecret',
    'secretsmanager:GetSecretValue',
    'secretsmanager:PutSecretValue',
    'sns:Publish',
    'sqs:ChangeMessageVisibility',
    'sqs:DeleteMessage',
    'sqs:GetQueueAttributes',
    'sqs:GetQueueUrl',
    'sqs:ReceiveMessage',
    'sqs:SendMessage',
    'ssm:GetParameters',
];

const NONPROD_ONLY_RUNTIME_ACTIONS: readonly string[] = [
    'cloudformation:DeleteStack',
    'cloudformation:DescribeStacks',
    'cloudformation:ListStacks',
    'ec2:DescribeInstances',
    'ec2:StartInstances',
    'ec2:StopInstances',
    'ecs:DeleteService',
    'ecs:DescribeClusters',
    'ecs:DescribeServices',
    'ecs:DescribeTasks',
    'ecs:ListClusters',
    'ecs:ListServices',
    'ecs:ListTasks',
    'ecs:StopTask',
    'ecs:UpdateService',
    'events:DisableRule',
    'events:EnableRule',
    'events:ListRules',
    'events:ListTagsForResource',
    'logs:CreateLogDelivery',
    'logs:DeleteLogDelivery',
    'logs:DescribeResourcePolicies',
    'logs:GetLogDelivery',
    'logs:ListLogDeliveries',
    'logs:PutResourcePolicy',
    'logs:UpdateLogDelivery',
    'rds:DescribeDBInstances',
    'rds:StartDBInstance',
    'rds:StopDBInstance',
    'ssm:GetParameter',
    'ssm:PutParameter',
    'states:StartExecution',
    'xray:GetSamplingRules',
    'xray:GetSamplingTargets',
    'xray:PutTelemetryRecords',
    'xray:PutTraceSegments',
];

const CI_ROLE_ACTIONS: readonly string[] = [
    'cloudformation:DeleteStack',
    'cloudformation:DescribeStackEvents',
    'cloudformation:DescribeStackResources',
    'cloudformation:DescribeStacks',
    'cloudformation:GetTemplate',
    'cloudformation:GetTemplateSummary',
    'cloudformation:ListExports',
    'cloudformation:ListStackResources',
    'cloudformation:ListStacks',
    'cloudfront-keyvaluestore:DeleteKey',
    'cloudfront-keyvaluestore:DescribeKeyValueStore',
    'cloudfront-keyvaluestore:GetKey',
    'cloudfront-keyvaluestore:ListKeys',
    'cloudfront-keyvaluestore:PutKey',
    'cloudwatch:GetMetricStatistics',
    'ec2:DescribeInstances',
    'ecr:BatchCheckLayerAvailability',
    'ecr:BatchGetImage',
    'ecr:CompleteLayerUpload',
    'ecr:CreateRepository',
    'ecr:DeleteRepository',
    'ecr:DescribeImages',
    'ecr:DescribeRepositories',
    'ecr:GetAuthorizationToken',
    'ecr:GetDownloadUrlForLayer',
    'ecr:InitiateLayerUpload',
    'ecr:ListImages',
    'ecr:PutImage',
    'ecr:PutImageTagMutability',
    'ecr:PutLifecyclePolicy',
    'ecr:TagResource',
    'ecr:UploadLayerPart',
    'ecs:DeleteService',
    'ecs:DescribeServices',
    'ecs:DescribeTaskDefinition',
    'ecs:DescribeTasks',
    'ecs:ListClusters',
    'ecs:ListServices',
    'ecs:ListTasks',
    'ecs:StopTask',
    'iam:GetPolicy',
    'iam:GetPolicyVersion',
    'iam:GetRolePolicy',
    'iam:ListAttachedRolePolicies',
    'iam:ListRolePolicies',
    'lambda:GetFunctionConfiguration',
    'lambda:GetFunctionUrlConfig',
    'lambda:InvokeFunction',
    'logs:DeleteLogGroup',
    'logs:DescribeLogGroups',
    'logs:DescribeSubscriptionFilters',
    'rds:DescribeDBClusters',
    'rds:DescribeDBInstances',
    'route53:ChangeResourceRecordSets',
    'route53:GetChange',
    'route53:GetHostedZone',
    'route53:ListHostedZones',
    'route53:ListHostedZonesByName',
    'route53:ListResourceRecordSets',
    's3:ListBucket',
    'secretsmanager:DescribeSecret',
    'secretsmanager:GetSecretValue',
    'sns:GetTopicAttributes',
    'sqs:GetQueueAttributes',
    'sqs:GetQueueUrl',
    'ssm:DeleteParameter',
    'ssm:GetParameter',
    'ssm:GetParameters',
    'ssm:GetParametersByPath',
    'ssm:PutParameter',
    'states:DescribeStateMachine',
    'states:ListExecutions',
    'tag:GetResources',
];

/**
 * The actions of each AWS-managed policy the stacks attach to roles. Their contents are not in the template, so the
 * boundary guard needs them here to hold the boundary to be a superset of what those roles can do.
 */
export const AWS_MANAGED_POLICY_ACTIONS: Readonly<Record<string, readonly string[]>> = {
    'service-role/AWSLambdaBasicExecutionRole': ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
    'service-role/AWSLambdaVPCAccessExecutionRole': [
        'ec2:AssignPrivateIpAddresses',
        'ec2:CreateNetworkInterface',
        'ec2:DeleteNetworkInterface',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DescribeSubnets',
        'ec2:UnassignPrivateIpAddresses',
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
    ],
    'service-role/AmazonAPIGatewayPushToCloudWatchLogs': [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:DescribeLogGroups',
        'logs:DescribeLogStreams',
        'logs:FilterLogEvents',
        'logs:GetLogEvents',
        'logs:PutLogEvents',
    ],
    'service-role/AmazonECSTaskExecutionRolePolicy': [
        'ecr:BatchCheckLayerAvailability',
        'ecr:BatchGetImage',
        'ecr:GetAuthorizationToken',
        'ecr:GetDownloadUrlForLayer',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
    ],
};

/** The actions of a role in either stage tier: the production set plus what the AWS-managed policies carry. */
const COMMON = SERVICE_RUNTIME_ACTIONS;

const iamArn = (resource: string): string => `arn:aws:iam::${ACCOUNT}:${resource}`;

/** Every IAM verb that changes anything. Reads (`Get*`, `List*`) and `iam:PassRole` stay out of it. */
const IAM_MUTATIONS: readonly string[] = [
    'iam:Add*',
    'iam:Attach*',
    'iam:Change*',
    'iam:Create*',
    'iam:Deactivate*',
    'iam:Delete*',
    'iam:Detach*',
    'iam:Enable*',
    'iam:Put*',
    'iam:Remove*',
    'iam:Resync*',
    'iam:Set*',
    'iam:Tag*',
    'iam:Untag*',
    'iam:Update*',
    'iam:Upload*',
];

const statement = (
    Sid: string,
    Effect: 'Allow' | 'Deny',
    Action: readonly string[],
    Resource: readonly string[],
): Statement => ({ Sid, Effect, Action, Resource });

/** The Deny that keeps one stage tier out of the other's names. */
function tierNameDeny(qualifier: QualifierName): Statement[] {
    if (qualifier === QUALIFIERS.nonprod) {
        return [
            statement(
                'DenyProductionNames',
                'Deny',
                ['*'],
                [
                    'arn:aws:*:*:*:*kitchensink-*-prod*',
                    'arn:aws:*:*:*:*kitchensink/*prod/*',
                    'arn:aws:*:*:*:*kitchensink/*prod',
                ],
            ),
        ];
    }

    if (qualifier === QUALIFIERS.prod) {
        return [
            statement(
                'DenyNonProductionNames',
                'Deny',
                ['*'],
                [
                    'arn:aws:*:*:*:*kitchensink-*-sandbox*',
                    'arn:aws:*:*:*:*kitchensink-*-pr-*',
                    'arn:aws:*:*:*:*kitchensink/sandbox*',
                    'arn:aws:*:*:*:*kitchensink/*/sandbox*',
                    'arn:aws:*:*:*:*kitchensink/pr-*',
                    'arn:aws:*:*:*:*kitchensink/*/pr-*',
                ],
            ),
        ];
    }

    return [];
}

/**
 * The permissions boundary of one qualifier.
 *
 * @param qualifier - The bootstrap qualifier.
 * @returns A policy document with `<account>` and `<region>` placeholders. Pure.
 */
export function buildBoundary(qualifier: QualifierName): PolicyDocument {
    const account = qualifier === QUALIFIERS.account;
    const actions = account
        ? CI_ROLE_ACTIONS
        : qualifier === QUALIFIERS.nonprod
          ? [...COMMON, ...NONPROD_ONLY_RUNTIME_ACTIONS]
          : COMMON;

    const statements: Statement[] = [
        statement('AllowRuntimeActions', 'Allow', [...actions].sort(), ['*']),
        ...(account
            ? [
                  statement(
                      'AllowAssumeKitchenSinkBootstrapRoles',
                      'Allow',
                      ['sts:AssumeRole'],
                      [
                          iamArn(`role/cdk-${QUALIFIERS.nonprod}-*`),
                          iamArn(`role/cdk-${QUALIFIERS.prod}-*`),
                          iamArn(`role/cdk-${QUALIFIERS.account}-*`),
                      ],
                  ),
              ]
            : [statement('AllowPassKitchenSinkRoles', 'Allow', ['iam:PassRole'], [iamArn('role/kitchensink-*')])]),
        statement('DenyIamMutation', 'Deny', IAM_MUTATIONS, ['*']),
        statement('DenyOrganizationsAndAccount', 'Deny', ['organizations:*', 'account:*'], ['*']),
        statement('DenyDefaultQualifierRoles', 'Deny', ['sts:AssumeRole'], [iamArn('role/cdk-hnb659fds-*')]),
        ...(account
            ? []
            : [
                  statement(
                      'DenyBootstrapAndCiRoles',
                      'Deny',
                      ['sts:AssumeRole'],
                      [iamArn('role/cdk-*'), iamArn('role/kitchensink-gha-*')],
                  ),
              ]),
        ...tierNameDeny(qualifier),
    ];

    return { Version: '2012-10-17', Statement: statements };
}

/** Kept for readers of the region placeholder: boundaries are region-agnostic, so it is unused in the documents. */
export const BOUNDARY_REGION_PLACEHOLDER = REGION;
