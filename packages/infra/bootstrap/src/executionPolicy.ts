/**
 * @module executionPolicy — what CloudFormation may do when it deploys for one qualifier (ADR-0065).
 *
 * The bootstrap's execution role was `AdministratorAccess`, so whoever could make CloudFormation deploy a template
 * was an account administrator. This module is the replacement: a DATA TABLE of grants, rendered into several
 * managed policies (each under IAM's 6144-character limit). Nothing is assembled from strings.
 *
 * ## The rules the table is built to
 *
 * - **Names are the boundary.** Every Allow is scoped to `kitchensink-*` names (or `/kitchensink/…`), or to the
 *   `aws:cloudformation:stack-name` tag for resources CloudFormation names by id (EC2, ELB, CloudFront, API Gateway
 *   parents). A resource without the tag matches nothing, so the grant fails CLOSED.
 * - **The other tier is denied by name.** The nonprod policy denies every `*-prod*` name and the prod policy denies
 *   every sandbox/preview name, so a branch deploy cannot reach production even if a stack pattern were widened.
 * - **No verb is wider than the service needs.** Verb wildcards (`lambda:Update*`) are used on name-scoped
 *   resources; `<service>:*` never appears in an Allow, and IAM actions are listed one by one.
 * - **Roles it creates are capped.** `iam:CreateRole`, `PutRolePolicy`, `AttachRolePolicy` and
 *   `PutRolePermissionsBoundary` require the qualifier's permissions boundary, and the boundary and these policies
 *   are immutable to the role they bind.
 * - **It cannot rejoin the deploy chain.** `sts:AssumeRole` on `cdk-*` roles, the toolkit stacks, the CI roles and
 *   the bootstrap policies are explicit Denies.
 *
 * ⚠️ The action lists are reviewed against the AWS Service Authorization Reference, not proven by a deploy. A list
 * that is too narrow fails LOUDLY (an AccessDenied in the stack events, with the action named); a list that is too
 * wide cannot, which is why the guards in `executionPolicy.test.ts` read the table for the escalation shapes
 * instead. The authoring loop after a sandbox deploy is IAM Access Analyzer policy generation over CloudTrail.
 *
 * @pattern Specification / policy module — the privilege is a table of grants judged by guards
 * @pattern Registry — `covers` ties every grant to the CloudFormation resource types it serves, so a new type in
 *   the committed manifest fails a test until someone scopes it
 */
import { isReadOnlyPattern } from './iamCatalogue.js';
import { iamCatalogueSnapshot } from './iamCatalogueSnapshot.js';
import { ACCOUNT, REGION, type Condition, type PolicyDocument, type Statement } from './policyDocument.js';
import {
    QUALIFIERS,
    STACK_TAG_PATTERNS,
    boundaryPolicyName,
    executionPolicyName,
    type QualifierName,
} from './qualifiers.js';
import { resourceTypesOf, tierNameResources } from './tierNames.js';

/** The services a created role may be passed to. A superset of any tier; each tier lists its own subset. */
export const PASS_ROLE_SERVICES: readonly string[] = [
    'apigateway.amazonaws.com',
    'ec2.amazonaws.com',
    'ecs-tasks.amazonaws.com',
    'edgelambda.amazonaws.com',
    'events.amazonaws.com',
    'lambda.amazonaws.com',
    'scheduler.amazonaws.com',
    'states.amazonaws.com',
];

/** The AWS-managed policies the stacks attach to roles (the committed manifest holds the same four). */
export const ATTACHABLE_AWS_POLICIES: readonly string[] = [
    'service-role/AWSLambdaBasicExecutionRole',
    'service-role/AWSLambdaVPCAccessExecutionRole',
    'service-role/AmazonAPIGatewayPushToCloudWatchLogs',
    'service-role/AmazonECSTaskExecutionRolePolicy',
];

const PART_NAMES = ['compute', 'data', 'observe', 'network', 'edge', 'iam', 'guard'] as const;

/** One of the managed policies an execution role is built from. */
type PartName = (typeof PART_NAMES)[number];

/** One managed policy of a qualifier's execution role. */
export interface ExecutionPolicyPart {
    /** The part's short name (`compute`, `data`, ...). */
    readonly name: PartName;
    /** The managed policy's name in the account (`kitchensink-ci-exec-<qualifier>-<part>`). */
    readonly policyName: string;
    readonly document: PolicyDocument;
    /** The CloudFormation resource types the part's grants serve. */
    readonly covers: readonly string[];
}

interface Grant {
    readonly part: PartName;
    readonly covers?: readonly string[];
    readonly statement: Statement;
}

const arn = (service: string, resource: string, regional = true): string =>
    regional ? `arn:aws:${service}:${REGION}:${ACCOUNT}:${resource}` : `arn:aws:${service}::${ACCOUNT}:${resource}`;

const KS = 'kitchensink-*';
const iamArn = (resource: string): string => `arn:aws:iam::${ACCOUNT}:${resource}`;

/** The tag a resource CloudFormation named by id must carry for a modify/delete to apply. */
const ownStack = (qualifier: QualifierName): Condition => ({
    StringLike: { 'aws:ResourceTag/aws:cloudformation:stack-name': STACK_TAG_PATTERNS[qualifier] },
});

const boundaryArn = (qualifier: QualifierName): string => iamArn(`policy/${boundaryPolicyName(qualifier)}`);

const allow = (
    part: PartName,
    sid: string,
    action: readonly string[],
    resource: readonly string[],
    covers: readonly string[] = [],
    condition?: Condition,
): Grant => ({
    part,
    covers,
    statement: {
        Sid: sid,
        Effect: 'Allow',
        Action: action,
        Resource: resource,
        ...(condition === undefined ? {} : { Condition: condition }),
    },
});

/** Whether an action pattern only reads, by the Service Authorization Reference's access level (Read or List). */
const isRead = (pattern: string): boolean => isReadOnlyPattern(iamCatalogueSnapshot, pattern);

/**
 * An Allow for resources that carry the stack-name tag: mutations and deletes keep the tag condition, READS do not.
 *
 * CloudFormation's resource handlers read before they create (an existence or attribute check on a resource that has
 * no tag yet), so a read gated on the tag is denied at create time (the first sandbox probe: `SNS:GetTopicAttributes`
 * on a topic that did not exist). Reads are scoped by NAME only; they change nothing, and the tier Denies and the
 * name patterns still refuse the other tier. The read statement is named `<Sid>Reads`.
 */
function ownAllow(
    part: PartName,
    sid: string,
    action: readonly string[],
    resource: readonly string[],
    covers: readonly string[],
    condition: Condition,
): Grant[] {
    const reads = action.filter(isRead);
    const writes = action.filter((candidate) => !isRead(candidate));

    return [
        ...(reads.length === 0 ? [] : [allow(part, `${sid}Reads`, reads, resource, writes.length === 0 ? covers : [])]),
        ...(writes.length === 0 ? [] : [allow(part, sid, writes, resource, covers, condition)]),
    ];
}

const deny = (
    part: PartName,
    sid: string,
    action: readonly string[],
    resource: readonly string[],
    condition?: Condition,
): Grant => ({
    part,
    statement: {
        Sid: sid,
        Effect: 'Deny',
        Action: action,
        Resource: resource,
        ...(condition === undefined ? {} : { Condition: condition }),
    },
});

/**
 * What both stage tiers share.
 *
 * ## Create versus modify
 *
 * A name pattern plus a Deny on the other tier's names is NOT a boundary: CloudFormation truncates a generated name
 * (`<stack>-<LogicalId>-<hash>`, 64 characters for Lambda and IAM roles) and the stage token is what is cut, and
 * some resources are addressed by an id with no name at all. So:
 *
 * - **Create** actions are scoped by NAME (`*Create`/`*Register` statements): the resource does not exist yet, so a
 *   resource tag cannot be asked for, and a colliding name fails with "already exists".
 * - **Modify, delete and configuration-read** actions carry the `aws:cloudformation:stack-name` tag condition
 *   (`*Own` statements): a resource without the tag matches nothing, so the grant fails CLOSED.
 * - **Residuals** are the resource types that can be neither tagged nor named by tier. They are listed by Sid in
 *   `executionPolicyScoping.test.ts` with the reason, and stated here so that no reader mistakes them for scoped:
 *   S3 buckets (tagged after creation), EventBridge Scheduler schedules, SSM parameters and Secrets Manager secrets
 *   (explicit names carry the stage), CloudWatch alarms and dashboards, IAM instance profiles, CloudFront policies,
 *   key groups, public keys, key-value stores and functions (id-addressed), Application Auto Scaling (any ECS
 *   service's desired count), the API Gateway account settings and tags, log deliveries, and Lambda event source mappings.
 *   `RegisterTaskDefinition` takes no resource at all: it can add a NEW revision to any family.
 */
function stageGrants(qualifier: 'ksnonprod' | 'ksprod'): Grant[] {
    const own = ownStack(qualifier);
    const nonprod = qualifier === QUALIFIERS.nonprod;
    const assetsBucket = `cdk-${qualifier}-assets-${ACCOUNT}-${REGION}`;
    const passServices = PASS_ROLE_SERVICES.filter((service) => !nonprod || service !== 'edgelambda.amazonaws.com');
    const tagKey = 'aws:ResourceTag/aws:cloudformation:stack-name';
    // CloudFront Functions are named by CloudFormation from the CONSTRUCT path, so the stage is inside the name but
    // not at its end (`us-east-1SandboxRouterprodRouterFunction...`). The tier Allow is therefore positive, and the
    // other tier's Deny below is what separates `...Routerpr1...` from `...Routerprod...`.
    const routerFunctions = nonprod
        ? [
              arn('cloudfront', 'function/*SandboxRouterpr*', false),
              arn('cloudfront', 'function/*SandboxRoutersandbox*', false),
              arn('cloudfront', 'function/kitchensink-sandox*', false),
          ]
        : [arn('cloudfront', 'function/*SandboxRouterprod*', false)];

    const grants: Grant[] = [
        // ---- compute ------------------------------------------------------------------------------------------
        allow(
            'compute',
            'LambdaCreate',
            ['lambda:CreateFunction', 'lambda:TagResource'],
            [arn('lambda', `function:${KS}`)],
            ['AWS::Lambda::Function'],
        ),
        ...ownAllow(
            'compute',
            'LambdaOwn',
            [
                'lambda:Add*',
                'lambda:Create*',
                'lambda:Delete*',
                'lambda:EnableReplication*',
                'lambda:Get*',
                'lambda:Invoke*',
                'lambda:List*',
                'lambda:Publish*',
                'lambda:Put*',
                'lambda:Remove*',
                'lambda:Tag*',
                'lambda:Untag*',
                'lambda:Update*',
            ],
            [arn('lambda', `function:${KS}`), arn('lambda', `function:${KS}:*`)],
            [
                'AWS::Lambda::Function',
                'AWS::Lambda::Permission',
                'AWS::Lambda::Version',
                'AWS::Lambda::Url',
                'AWS::Lambda::EventInvokeConfig',
                'AWS::CloudFormation::CustomResource',
                'Custom::*',
            ],
            own,
        ),
        allow(
            'compute',
            'LambdaEventSourceMappings',
            ['lambda:DeleteEventSourceMapping', 'lambda:GetEventSourceMapping', 'lambda:UpdateEventSourceMapping'],
            [arn('lambda', 'event-source-mapping:*')],
            ['AWS::Lambda::EventSourceMapping'],
            { ArnLike: { 'lambda:FunctionArn': [arn('lambda', `function:${KS}`)] } },
        ),
        allow(
            'compute',
            'EcsCreate',
            ['ecs:CreateCluster', 'ecs:CreateService', 'ecs:TagResource'],
            [arn('ecs', `cluster/${KS}`), arn('ecs', `service/${KS}/*`)],
            ['AWS::ECS::Cluster', 'AWS::ECS::Service'],
        ),
        ...ownAllow(
            'compute',
            'EcsOwn',
            [
                'ecs:Delete*',
                'ecs:Describe*',
                'ecs:List*',
                'ecs:Put*',
                'ecs:TagResource',
                'ecs:UntagResource',
                'ecs:Update*',
            ],
            [arn('ecs', `cluster/${KS}`), arn('ecs', `service/${KS}/*`), arn('ecs', `task/${KS}/*`)],
            ['AWS::ECS::Cluster', 'AWS::ECS::ClusterCapacityProviderAssociations', 'AWS::ECS::Service'],
            own,
        ),
        allow(
            'compute',
            'EcsRegisterTaskDefinition',
            ['ecs:RegisterTaskDefinition'],
            ['*'],
            ['AWS::ECS::TaskDefinition'],
        ),
        allow(
            'compute',
            'EcsTagTaskDefinitions',
            ['ecs:TagResource'],
            [arn('ecs', 'task-definition/*:*')],
            ['AWS::ECS::TaskDefinition'],
        ),
        ...ownAllow(
            'compute',
            'EcsTaskDefinitionsOwn',
            [
                'ecs:DeleteTaskDefinitions',
                'ecs:DeregisterTaskDefinition',
                'ecs:DescribeTaskDefinition',
                'ecs:ListTagsForResource',
                'ecs:UntagResource',
            ],
            [arn('ecs', 'task-definition/*:*')],
            ['AWS::ECS::TaskDefinition'],
            own,
        ),
        allow(
            'compute',
            'AppAutoScaling',
            [
                'application-autoscaling:Delete*',
                'application-autoscaling:Deregister*',
                'application-autoscaling:Describe*',
                'application-autoscaling:Put*',
                'application-autoscaling:Register*',
                'application-autoscaling:TagResource',
                'application-autoscaling:UntagResource',
            ],
            ['*'],
            ['AWS::ApplicationAutoScaling::ScalableTarget', 'AWS::ApplicationAutoScaling::ScalingPolicy'],
            { StringEquals: { 'application-autoscaling:service-namespace': 'ecs' } },
        ),
        allow(
            'compute',
            'StatesCreate',
            ['states:CreateStateMachine', 'states:TagResource'],
            [arn('states', 'stateMachine:*')],
            ['AWS::StepFunctions::StateMachine'],
        ),
        ...ownAllow(
            'compute',
            'StatesOwnMachines',
            [
                'states:Delete*',
                'states:Describe*',
                'states:ListTagsForResource',
                'states:TagResource',
                'states:UntagResource',
                'states:Update*',
            ],
            [arn('states', 'stateMachine:*')],
            [],
            own,
        ),
        allow(
            'compute',
            'EventsCreate',
            ['events:CreateEventBus', 'events:PutRule', 'events:TagResource'],
            [arn('events', `rule/${KS}`), arn('events', `rule/*/${KS}`), arn('events', `event-bus/${KS}`)],
            ['AWS::Events::Rule', 'AWS::Events::EventBus'],
        ),
        ...ownAllow(
            'compute',
            'EventsOwn',
            [
                'events:DeleteEventBus',
                'events:DeleteRule',
                'events:Describe*',
                'events:DisableRule',
                'events:EnableRule',
                'events:List*',
                'events:PutPermission',
                'events:PutTargets',
                'events:RemovePermission',
                'events:RemoveTargets',
                'events:TagResource',
                'events:UntagResource',
            ],
            [arn('events', `rule/${KS}`), arn('events', `rule/*/${KS}`), arn('events', `event-bus/${KS}`)],
            ['AWS::Events::Rule', 'AWS::Events::EventBus'],
            own,
        ),
        allow(
            'compute',
            'SchedulerSchedules',
            [
                'scheduler:CreateSchedule',
                'scheduler:DeleteSchedule',
                'scheduler:GetSchedule',
                'scheduler:UpdateSchedule',
            ],
            [arn('scheduler', `schedule/*/${KS}`)],
            ['AWS::Scheduler::Schedule'],
        ),
        // ---- data ---------------------------------------------------------------------------------------------
        allow('data', 'SqsCreate', ['sqs:CreateQueue', 'sqs:TagQueue'], [arn('sqs', KS)], ['AWS::SQS::Queue']),
        ...ownAllow(
            'data',
            'SqsOwn',
            [
                'sqs:AddPermission',
                'sqs:Delete*',
                'sqs:Get*',
                'sqs:List*',
                'sqs:RemovePermission',
                'sqs:Set*',
                'sqs:TagQueue',
                'sqs:UntagQueue',
            ],
            [arn('sqs', KS)],
            ['AWS::SQS::Queue', 'AWS::SQS::QueuePolicy'],
            own,
        ),
        allow('data', 'SnsCreate', ['sns:CreateTopic', 'sns:TagResource'], [arn('sns', KS)], ['AWS::SNS::Topic']),
        ...ownAllow(
            'data',
            'SnsOwn',
            [
                'sns:AddPermission',
                'sns:DeleteTopic',
                'sns:Get*',
                'sns:List*',
                'sns:RemovePermission',
                'sns:Set*',
                'sns:Subscribe',
                'sns:TagResource',
                'sns:Unsubscribe',
                'sns:UntagResource',
            ],
            [arn('sns', KS)],
            ['AWS::SNS::Topic', 'AWS::SNS::Subscription', 'AWS::SNS::TopicPolicy'],
            own,
        ),
        allow(
            'data',
            'S3OwnBuckets',
            [
                's3:CreateBucket',
                's3:DeleteBucket',
                's3:DeleteBucket*',
                's3:GetAccelerateConfiguration',
                's3:GetBucket*',
                's3:GetEncryptionConfiguration',
                's3:GetLifecycleConfiguration',
                's3:ListBucket',
                's3:PutAccelerateConfiguration',
                's3:PutBucket*',
                's3:PutEncryptionConfiguration',
                's3:PutLifecycleConfiguration',
            ],
            [`arn:aws:s3:::${KS}`],
            ['AWS::S3::Bucket', 'AWS::S3::BucketPolicy'],
        ),
        allow(
            'data',
            'S3ReadCdkAssets',
            ['s3:GetBucket*', 's3:GetObject*', 's3:List*'],
            [`arn:aws:s3:::${assetsBucket}`, `arn:aws:s3:::${assetsBucket}/*`],
        ),
        allow(
            'data',
            'DynamoDbCreate',
            ['dynamodb:CreateTable', 'dynamodb:TagResource'],
            [arn('dynamodb', `table/${KS}`)],
            ['AWS::DynamoDB::Table'],
        ),
        ...ownAllow(
            'data',
            'DynamoDbOwn',
            [
                'dynamodb:Delete*',
                'dynamodb:Describe*',
                'dynamodb:ListTagsOfResource',
                'dynamodb:TagResource',
                'dynamodb:UntagResource',
                'dynamodb:Update*',
            ],
            [arn('dynamodb', `table/${KS}`)],
            ['AWS::DynamoDB::Table'],
            own,
        ),
        allow(
            'data',
            'RdsCreate',
            ['rds:AddTagsToResource', 'rds:CreateDBInstance', 'rds:CreateDBSubnetGroup'],
            [
                arn('rds', `db:${KS}`),
                arn('rds', `subgrp:${KS}`),
                arn('rds', 'pg:default.*'),
                arn('rds', 'og:default:*'),
                arn('rds', 'secgrp:*'),
            ],
            ['AWS::RDS::DBInstance', 'AWS::RDS::DBSubnetGroup'],
        ),
        ...ownAllow(
            'data',
            'RdsOwn',
            [
                'rds:DeleteDB*',
                'rds:ListTagsForResource',
                'rds:ModifyDB*',
                'rds:RebootDBInstance',
                'rds:RemoveTagsFromResource',
            ],
            [arn('rds', `db:${KS}`), arn('rds', `subgrp:${KS}`)],
            ['AWS::RDS::DBInstance', 'AWS::RDS::DBSubnetGroup'],
            own,
        ),
        allow('data', 'RdsDescribe', ['rds:Describe*'], ['*']),
        allow(
            'data',
            'SecretsOwn',
            [
                'secretsmanager:DeleteResourcePolicy',
                'secretsmanager:DeleteSecret',
                'secretsmanager:DescribeSecret',
                'secretsmanager:GetResourcePolicy',
                'secretsmanager:PutResourcePolicy',
                'secretsmanager:PutSecretValue',
                'secretsmanager:RestoreSecret',
                'secretsmanager:TagResource',
                'secretsmanager:UntagResource',
                'secretsmanager:UpdateSecret',
            ],
            [arn('secretsmanager', 'secret:kitchensink*')],
            ['AWS::SecretsManager::Secret', 'AWS::SecretsManager::SecretTargetAttachment'],
        ),
        ...ownAllow(
            'data',
            'SecretsByStackTag',
            [
                'secretsmanager:DeleteSecret',
                'secretsmanager:DescribeSecret',
                'secretsmanager:PutSecretValue',
                'secretsmanager:TagResource',
                'secretsmanager:UntagResource',
                'secretsmanager:UpdateSecret',
            ],
            [arn('secretsmanager', 'secret:*')],
            [],
            own,
        ),
        allow('data', 'SecretsCreate', ['secretsmanager:CreateSecret', 'secretsmanager:GetRandomPassword'], ['*']),
        allow(
            'data',
            'SsmParameters',
            [
                'ssm:AddTagsToResource',
                'ssm:DeleteParameter',
                'ssm:DeleteParameters',
                'ssm:GetParameter',
                'ssm:GetParameters',
                'ssm:GetParametersByPath',
                'ssm:LabelParameterVersion',
                'ssm:ListTagsForResource',
                'ssm:PutParameter',
                'ssm:RemoveTagsFromResource',
            ],
            [arn('ssm', 'parameter/kitchensink/*')],
            ['AWS::SSM::Parameter'],
        ),
        allow('data', 'SsmDescribe', ['ssm:DescribeParameters'], ['*']),
        // CloudFormation resolves every SSM-typed template parameter with THIS role, before the change set exists:
        // each stack's `BootstrapVersion` (`/cdk-bootstrap/<qualifier>/version`) and the public AMI parameter.
        // `/kitchensink/...` is `SsmParameters`. Kept in the `network` part, which has the room.
        allow(
            'network',
            'SsmBootstrapVersion',
            ['ssm:GetParameters'],
            [arn('ssm', `parameter/cdk-bootstrap/${qualifier}/version`)],
        ),
        allow(
            'network',
            'SsmPublicAmi',
            ['ssm:GetParameter', 'ssm:GetParameters'],
            [`arn:aws:ssm:${REGION}::parameter/aws/service/ami-amazon-linux-latest/*`],
        ),
        allow(
            'data',
            'KmsThroughServices',
            [
                'kms:CreateGrant',
                'kms:Decrypt',
                'kms:DescribeKey',
                'kms:Encrypt',
                'kms:GenerateDataKey*',
                'kms:ReEncrypt*',
            ],
            ['*'],
            [],
            {
                StringEquals: {
                    'kms:CallerAccount': ACCOUNT,
                    'kms:ViaService': [
                        `dynamodb.${REGION}.amazonaws.com`,
                        `lambda.${REGION}.amazonaws.com`,
                        `logs.${REGION}.amazonaws.com`,
                        `rds.${REGION}.amazonaws.com`,
                        `s3.${REGION}.amazonaws.com`,
                        `secretsmanager.${REGION}.amazonaws.com`,
                        `sns.${REGION}.amazonaws.com`,
                        `sqs.${REGION}.amazonaws.com`,
                        `ssm.${REGION}.amazonaws.com`,
                    ],
                },
            },
        ),
        // ---- observe ------------------------------------------------------------------------------------------
        allow(
            'observe',
            'LogGroupsCreate',
            ['logs:CreateLogGroup', 'logs:TagLogGroup', 'logs:TagResource'],
            [
                arn('logs', 'log-group:/aws/lambda/kitchensink-*'),
                arn('logs', 'log-group:kitchensink-*'),
                arn('logs', 'log-group:/kitchensink/*'),
            ],
            ['AWS::Logs::LogGroup'],
        ),
        ...ownAllow(
            'observe',
            'LogGroupsOwn',
            [
                'logs:DeleteLogGroup',
                'logs:DeleteRetentionPolicy',
                'logs:DeleteSubscriptionFilter',
                'logs:DescribeSubscriptionFilters',
                'logs:ListTagsForResource',
                'logs:ListTagsLogGroup',
                'logs:PutRetentionPolicy',
                'logs:PutSubscriptionFilter',
                'logs:UntagLogGroup',
                'logs:UntagResource',
            ],
            [
                arn('logs', 'log-group:/aws/lambda/kitchensink-*'),
                arn('logs', 'log-group:/aws/lambda/kitchensink-*:*'),
                arn('logs', 'log-group:kitchensink-*'),
                arn('logs', 'log-group:kitchensink-*:*'),
                arn('logs', 'log-group:/kitchensink/*'),
                arn('logs', 'log-group:/kitchensink/*:*'),
            ],
            ['AWS::Logs::LogGroup', 'AWS::Logs::SubscriptionFilter'],
            own,
        ),
        allow(
            'observe',
            'LogDeliveries',
            ['logs:*Delivery*', 'logs:DescribeLogGroups'],
            ['*'],
            ['AWS::Logs::Delivery', 'AWS::Logs::DeliveryDestination', 'AWS::Logs::DeliverySource'],
        ),
        allow(
            'observe',
            'CloudWatchAlarms',
            [
                'cloudwatch:DeleteAlarms',
                'cloudwatch:DescribeAlarms',
                'cloudwatch:DisableAlarmActions',
                'cloudwatch:EnableAlarmActions',
                'cloudwatch:ListTagsForResource',
                'cloudwatch:PutCompositeAlarm',
                'cloudwatch:PutMetricAlarm',
                'cloudwatch:TagResource',
                'cloudwatch:UntagResource',
            ],
            [arn('cloudwatch', `alarm:${KS}`)],
            ['AWS::CloudWatch::Alarm'],
        ),
        allow(
            'observe',
            'CloudWatchDashboards',
            ['cloudwatch:DeleteDashboards', 'cloudwatch:GetDashboard', 'cloudwatch:PutDashboard'],
            [arn('cloudwatch', nonprod ? 'dashboard/pr-*-food-data' : 'dashboard/food-data', false)],
            ['AWS::CloudWatch::Dashboard'],
        ),
        // ---- network ------------------------------------------------------------------------------------------
        allow('network', 'Ec2Describe', ['ec2:Describe*'], ['*']),
        allow(
            'network',
            'Ec2Create',
            [
                'ec2:CreateInternetGateway',
                'ec2:CreateNetworkInterface',
                'ec2:CreateRouteTable',
                'ec2:CreateSecurityGroup',
                'ec2:CreateSubnet',
                'ec2:CreateVpc',
                'ec2:RunInstances',
            ],
            ['*'],
            [
                'AWS::EC2::Instance',
                'AWS::EC2::InternetGateway',
                'AWS::EC2::RouteTable',
                'AWS::EC2::SecurityGroup',
                'AWS::EC2::Subnet',
                'AWS::EC2::VPC',
            ],
        ),
        allow('network', 'Ec2TagOnCreate', ['ec2:CreateTags'], ['*'], [], {
            StringEquals: {
                'ec2:CreateAction': [
                    'CreateInternetGateway',
                    'CreateNetworkInterface',
                    'CreateRouteTable',
                    'CreateSecurityGroup',
                    'CreateSubnet',
                    'CreateVpc',
                    'RunInstances',
                ],
            },
        }),
        ...ownAllow(
            'network',
            'Ec2Own',
            [
                'ec2:Associate*',
                'ec2:AuthorizeSecurityGroup*',
                'ec2:Attach*',
                'ec2:CreateRoute',
                'ec2:CreateTags',
                'ec2:Delete*',
                'ec2:DeleteTags',
                'ec2:Detach*',
                'ec2:Disassociate*',
                'ec2:Modify*',
                'ec2:ReplaceRoute',
                'ec2:RevokeSecurityGroup*',
                'ec2:StartInstances',
                'ec2:StopInstances',
                'ec2:TerminateInstances',
                'ec2:UpdateSecurityGroupRuleDescriptions*',
            ],
            ['*'],
            [
                'AWS::EC2::Route',
                'AWS::EC2::SecurityGroupEgress',
                'AWS::EC2::SecurityGroupIngress',
                'AWS::EC2::SubnetRouteTableAssociation',
                'AWS::EC2::VPCGatewayAttachment',
            ],
            own,
        ),
        allow('network', 'ElbDescribe', ['elasticloadbalancing:Describe*'], ['*']),
        allow(
            'network',
            'ElbCreate',
            ['elasticloadbalancing:CreateLoadBalancer', 'elasticloadbalancing:CreateTargetGroup'],
            ['*'],
            ['AWS::ElasticLoadBalancingV2::LoadBalancer', 'AWS::ElasticLoadBalancingV2::TargetGroup'],
        ),
        allow('network', 'ElbTagOnCreate', ['elasticloadbalancing:AddTags'], ['*'], [], {
            StringEquals: {
                'elasticloadbalancing:CreateAction': [
                    'CreateListener',
                    'CreateLoadBalancer',
                    'CreateRule',
                    'CreateTargetGroup',
                ],
            },
        }),
        ...ownAllow(
            'network',
            'ElbOwn',
            [
                'elasticloadbalancing:Add*',
                'elasticloadbalancing:CreateListener',
                'elasticloadbalancing:CreateRule',
                'elasticloadbalancing:Delete*',
                'elasticloadbalancing:Deregister*',
                'elasticloadbalancing:Modify*',
                'elasticloadbalancing:Register*',
                'elasticloadbalancing:Remove*',
                'elasticloadbalancing:Set*',
            ],
            ['*'],
            [
                'AWS::ElasticLoadBalancingV2::Listener',
                'AWS::ElasticLoadBalancingV2::ListenerCertificate',
                'AWS::ElasticLoadBalancingV2::ListenerRule',
                'AWS::ElasticLoadBalancingV2::LoadBalancer',
                'AWS::ElasticLoadBalancingV2::TargetGroup',
            ],
            own,
        ),
        // ---- edge ---------------------------------------------------------------------------------------------
        allow(
            'edge',
            'CloudFrontCreate',
            [
                'cloudfront:CreateCachePolicy',
                'cloudfront:CreateDistribution',
                'cloudfront:CreateFunction',
                'cloudfront:CreateKeyGroup',
                'cloudfront:CreateKeyValueStore',
                'cloudfront:CreateOriginAccessControl',
                'cloudfront:CreateOriginRequestPolicy',
                'cloudfront:CreatePublicKey',
                'cloudfront:CreateResponseHeadersPolicy',
                'cloudfront:TagResource',
            ],
            ['*'],
            [
                'AWS::CloudFront::CachePolicy',
                'AWS::CloudFront::Distribution',
                'AWS::CloudFront::Function',
                'AWS::CloudFront::KeyGroup',
                'AWS::CloudFront::KeyValueStore',
                'AWS::CloudFront::OriginAccessControl',
                'AWS::CloudFront::OriginRequestPolicy',
                'AWS::CloudFront::PublicKey',
                'AWS::CloudFront::ResponseHeadersPolicy',
            ],
        ),
        ...ownAllow(
            'edge',
            'CloudFrontOwnDistributions',
            [
                'cloudfront:AllowVendedLogDeliveryForResource',
                'cloudfront:AssociateAlias',
                'cloudfront:CreateInvalidation',
                'cloudfront:Delete*',
                'cloudfront:Get*',
                'cloudfront:ListTagsForResource',
                'cloudfront:TagResource',
                'cloudfront:UntagResource',
                'cloudfront:Update*',
            ],
            [arn('cloudfront', 'distribution/*', false)],
            [],
            own,
        ),
        allow(
            'edge',
            'CloudFrontPolicies',
            [
                'cloudfront:Delete*',
                'cloudfront:Describe*',
                'cloudfront:Get*',
                'cloudfront:List*',
                'cloudfront:Publish*',
                'cloudfront:Update*',
            ],
            [
                arn('cloudfront', 'cache-policy/*', false),
                arn('cloudfront', 'origin-access-control/*', false),
                arn('cloudfront', 'origin-request-policy/*', false),
                arn('cloudfront', 'response-headers-policy/*', false),
                arn('cloudfront', 'key-value-store/*', false),
                ...routerFunctions,
            ],
        ),
        // Key groups and public keys have NO resource type in the Service Authorization Reference: their actions
        // authorize only on `*`, so a `key-group/*` ARN would never match and a delete or update would be denied.
        allow(
            'edge',
            'CloudFrontKeyMaterial',
            [
                'cloudfront:DeleteKeyGroup',
                'cloudfront:DeletePublicKey',
                'cloudfront:GetKeyGroup',
                'cloudfront:GetKeyGroupConfig',
                'cloudfront:GetPublicKey',
                'cloudfront:GetPublicKeyConfig',
                'cloudfront:ListKeyGroups',
                'cloudfront:ListPublicKeys',
                'cloudfront:UpdateKeyGroup',
                'cloudfront:UpdatePublicKey',
            ],
            ['*'],
            ['AWS::CloudFront::KeyGroup', 'AWS::CloudFront::PublicKey'],
        ),
        allow('edge', 'AcmRequest', ['acm:RequestCertificate'], ['*'], ['AWS::CertificateManager::Certificate'], {
            'ForAllValues:StringLike': { 'acm:DomainNames': nonprod ? ['*sandbox.commise.app'] : ['*commise.app'] },
        }),
        ...ownAllow(
            'edge',
            'AcmOwn',
            [
                'acm:AddTagsToCertificate',
                'acm:DeleteCertificate',
                'acm:DescribeCertificate',
                'acm:ListTagsForCertificate',
                'acm:RemoveTagsFromCertificate',
            ],
            [arn('acm', 'certificate/*')],
            ['AWS::CertificateManager::Certificate'],
            own,
        ),
        allow(
            'edge',
            'Route53Records',
            ['route53:ChangeResourceRecordSets'],
            ['arn:aws:route53:::hostedzone/*'],
            ['AWS::Route53::RecordSet'],
            {
                'ForAllValues:StringLike': {
                    'route53:ChangeResourceRecordSetsNormalizedRecordNames': nonprod
                        ? ['sandbox.commise.app*', '*.sandbox.commise.app*']
                        : ['commise.app*', '*.commise.app*', '_*.commise.app*'],
                },
            },
        ),
        allow(
            'edge',
            'Route53Read',
            [
                'route53:GetChange',
                'route53:GetHostedZone',
                'route53:ListHostedZones*',
                'route53:ListResourceRecordSets',
            ],
            ['*'],
        ),
        allow(
            'edge',
            'ApiGatewayCreate',
            ['apigateway:POST'],
            [`arn:aws:apigateway:${REGION}::/restapis`, `arn:aws:apigateway:${REGION}::/domainnames`],
            ['AWS::ApiGateway::DomainName', 'AWS::ApiGateway::RestApi'],
        ),
        ...ownAllow(
            'edge',
            'ApiGatewayOwn',
            ['apigateway:DELETE', 'apigateway:GET', 'apigateway:PATCH', 'apigateway:POST', 'apigateway:PUT'],
            [`arn:aws:apigateway:${REGION}::/restapis/*`, `arn:aws:apigateway:${REGION}::/domainnames/*`],
            [
                'AWS::ApiGateway::Deployment',
                'AWS::ApiGateway::DomainName',
                'AWS::ApiGateway::GatewayResponse',
                'AWS::ApiGateway::Method',
                'AWS::ApiGateway::Resource',
                'AWS::ApiGateway::RestApi',
                'AWS::ApiGateway::Stage',
                'AWS::ApiGatewayV2::ApiMapping',
            ],
            own,
        ),
        allow(
            'edge',
            'ApiGatewayAccount',
            ['apigateway:GET', 'apigateway:PATCH'],
            [`arn:aws:apigateway:${REGION}::/account`],
            ['AWS::ApiGateway::Account'],
        ),
        allow(
            'edge',
            'ApiGatewayTags',
            ['apigateway:DELETE', 'apigateway:GET', 'apigateway:PUT'],
            [`arn:aws:apigateway:${REGION}::/tags/*`],
        ),
        // ---- iam ----------------------------------------------------------------------------------------------
        allow(
            'iam',
            'IamCreateCappedRoles',
            ['iam:CreateRole', 'iam:PutRolePermissionsBoundary', 'iam:PutRolePolicy'],
            [iamArn(`role/${KS}`)],
            ['AWS::IAM::Role', 'AWS::IAM::Policy'],
            { StringEquals: { 'iam:PermissionsBoundary': boundaryArn(qualifier) } },
        ),
        allow('iam', 'IamAttachAwsPolicies', ['iam:AttachRolePolicy'], [iamArn(`role/${KS}`)], [], {
            StringEquals: { 'iam:PermissionsBoundary': boundaryArn(qualifier) },
            ArnEquals: {
                'iam:PolicyARN': ATTACHABLE_AWS_POLICIES.map((policy) => `arn:aws:iam::aws:policy/${policy}`),
            },
        }),
        ...ownAllow(
            'iam',
            'IamOwnRoles',
            [
                'iam:DeleteRole',
                'iam:DeleteRolePolicy',
                'iam:DetachRolePolicy',
                'iam:GetRole',
                'iam:GetRolePolicy',
                'iam:ListAttachedRolePolicies',
                'iam:ListInstanceProfilesForRole',
                'iam:ListRolePolicies',
                'iam:ListRoleTags',
                'iam:TagRole',
                'iam:UntagRole',
                'iam:UpdateAssumeRolePolicy',
                'iam:UpdateRole',
                'iam:UpdateRoleDescription',
            ],
            [iamArn(`role/${KS}`)],
            [],
            own,
        ),
        allow(
            'iam',
            'IamInstanceProfiles',
            [
                'iam:AddRoleToInstanceProfile',
                'iam:CreateInstanceProfile',
                'iam:DeleteInstanceProfile',
                'iam:GetInstanceProfile',
                'iam:RemoveRoleFromInstanceProfile',
                'iam:TagInstanceProfile',
                'iam:UntagInstanceProfile',
            ],
            [iamArn(`instance-profile/${KS}`)],
            ['AWS::IAM::InstanceProfile'],
        ),
        allow('iam', 'IamPassRole', ['iam:PassRole'], [iamArn(`role/${KS}`)], [], {
            StringEquals: { 'iam:PassedToService': passServices },
            StringLike: { [tagKey]: STACK_TAG_PATTERNS[qualifier] },
        }),
        allow(
            'iam',
            'IamServiceLinkedRoles',
            ['iam:CreateServiceLinkedRole'],
            [iamArn('role/aws-service-role/*')],
            [],
            {
                StringEquals: {
                    'iam:AWSServiceName': [
                        'delivery.logs.amazonaws.com',
                        'ecs.amazonaws.com',
                        'ecs.application-autoscaling.amazonaws.com',
                        'elasticloadbalancing.amazonaws.com',
                        'logger.cloudfront.amazonaws.com',
                        'rds.amazonaws.com',
                        'replicator.lambda.amazonaws.com',
                    ],
                },
            },
        ),
    ];

    // ---- guard (explicit Denies) ------------------------------------------------------------------------------
    return [
        ...grants,
        ...commonDenies(qualifier),
        ...tierDenies(
            qualifier,
            grants.map((grant) => grant.statement),
        ),
    ];
}

/** Denies every tier carries: the deploy chain, the CI roles and the bootstrap policies stay out of reach. */
function commonDenies(qualifier: QualifierName): Grant[] {
    return [
        deny('guard', 'DenyBoundaryRemoval', ['iam:DeleteRolePermissionsBoundary'], ['*']),
        deny(
            'guard',
            'DenyBootstrapPolicyTamper',
            ['iam:CreatePolicyVersion', 'iam:DeletePolicy', 'iam:DeletePolicyVersion', 'iam:SetDefaultPolicyVersion'],
            [iamArn('policy/kitchensink-ci-*')],
        ),
        deny(
            'guard',
            'DenyCiAndBootstrapRoles',
            ['iam:*'],
            qualifier === QUALIFIERS.account
                ? [iamArn('role/cdk-*')]
                : [iamArn('role/kitchensink-gha-*'), iamArn('role/cdk-*')],
        ),
        deny('guard', 'DenyAssumingBootstrapRoles', ['sts:AssumeRole'], [iamArn('role/cdk-*')]),
        deny(
            'guard',
            'DenyToolkitStacks',
            ['cloudformation:*'],
            [arn('cloudformation', 'stack/CDKToolkit/*'), arn('cloudformation', 'stack/kitchensink-bootstrap-*/*')],
        ),
    ];
}

/** Denies that separate the two stage tiers by name. The account tier has none: its names are exact. */
function tierDenies(qualifier: QualifierName, allows: readonly Statement[]): Grant[] {
    const types = resourceTypesOf(allows, false);

    if (qualifier === QUALIFIERS.nonprod) {
        return [
            deny(
                'guard',
                'DenyProductionNames',
                ['*'],
                [
                    ...tierNameResources('production', types),
                    'arn:aws:cloudwatch::*:dashboard/food-data',
                    'arn:aws:cloudfront::*:function/*prod*',
                ],
            ),
            deny('guard', 'DenyProductionResourceTag', ['*'], ['*'], {
                StringEquals: { 'aws:ResourceTag/Environment': 'production' },
            }),
        ];
    }

    if (qualifier === QUALIFIERS.prod) {
        return [
            deny(
                'guard',
                'DenyNonProductionNames',
                ['*'],
                [...tierNameResources('nonproduction', types), 'arn:aws:cloudwatch::*:dashboard/pr-*'],
            ),
            deny('guard', 'DenySandboxDns', ['route53:ChangeResourceRecordSets'], ['*'], {
                'ForAnyValue:StringLike': {
                    'route53:ChangeResourceRecordSetsNormalizedRecordNames': ['*sandbox.commise.app*'],
                },
            }),
        ];
    }

    return [];
}

/** Grants of the account qualifier: the CI roles, the OIDC provider, the budget and the cost monitor. */
function accountGrants(): Grant[] {
    const q = QUALIFIERS.account;
    const assetsBucket = `cdk-${q}-assets-${ACCOUNT}-${REGION}`;
    const ciOidcProvider = iamArn('oidc-provider/token.actions.githubusercontent.com');

    return [
        allow(
            'iam',
            'IamCreateCiRoles',
            ['iam:CreateRole', 'iam:PutRolePermissionsBoundary', 'iam:PutRolePolicy'],
            [iamArn('role/kitchensink-gha-*')],
            ['AWS::IAM::Role', 'AWS::IAM::Policy'],
            { StringEquals: { 'iam:PermissionsBoundary': boundaryArn(q) } },
        ),
        allow(
            'iam',
            'IamOwnCiRoles',
            [
                'iam:DeleteRole',
                'iam:DeleteRolePolicy',
                'iam:DetachRolePolicy',
                'iam:GetRole',
                'iam:GetRolePolicy',
                'iam:ListAttachedRolePolicies',
                'iam:ListRolePolicies',
                'iam:ListRoleTags',
                'iam:TagRole',
                'iam:UntagRole',
                'iam:UpdateAssumeRolePolicy',
                'iam:UpdateRole',
                'iam:UpdateRoleDescription',
            ],
            [iamArn('role/kitchensink-gha-*')],
        ),
        allow(
            'iam',
            'IamGithubOidcProvider',
            [
                'iam:AddClientIDToOpenIDConnectProvider',
                'iam:CreateOpenIDConnectProvider',
                'iam:DeleteOpenIDConnectProvider',
                'iam:GetOpenIDConnectProvider',
                'iam:RemoveClientIDFromOpenIDConnectProvider',
                'iam:TagOpenIDConnectProvider',
                'iam:UntagOpenIDConnectProvider',
                'iam:UpdateOpenIDConnectProviderThumbprint',
            ],
            [ciOidcProvider],
            ['AWS::IAM::OIDCProvider'],
        ),
        allow(
            'data',
            'BudgetsAndCostMonitor',
            [
                'budgets:*Budget*',
                'budgets:ListTagsForResource',
                'budgets:TagResource',
                'budgets:UntagResource',
                'ce:CreateAnomalyMonitor',
                'ce:CreateAnomalySubscription',
                'ce:DeleteAnomalyMonitor',
                'ce:DeleteAnomalySubscription',
                'ce:GetAnomalyMonitors',
                'ce:GetAnomalySubscriptions',
                'ce:ListTagsForResource',
                'ce:TagResource',
                'ce:UntagResource',
                'ce:UpdateAnomalyMonitor',
                'ce:UpdateAnomalySubscription',
            ],
            [
                arn('budgets', 'budget/*', false),
                'arn:aws:ce::' + ACCOUNT + ':anomalymonitor/*',
                'arn:aws:ce::' + ACCOUNT + ':anomalysubscription/*',
            ],
            ['AWS::Budgets::Budget', 'AWS::CE::AnomalyMonitor', 'AWS::CE::AnomalySubscription'],
        ),
        allow(
            'data',
            'SnsCostTopic',
            [
                'sns:AddPermission',
                'sns:CreateTopic',
                'sns:DeleteTopic',
                'sns:Get*',
                'sns:List*',
                'sns:RemovePermission',
                'sns:Set*',
                'sns:Subscribe',
                'sns:TagResource',
                'sns:Unsubscribe',
                'sns:UntagResource',
            ],
            [arn('sns', KS)],
            ['AWS::SNS::Topic', 'AWS::SNS::Subscription', 'AWS::SNS::TopicPolicy'],
        ),
        // The account app's stacks take `BootstrapVersion` too; CloudFormation resolves it with this role.
        allow(
            'data',
            'SsmBootstrapVersion',
            ['ssm:GetParameters'],
            [arn('ssm', `parameter/cdk-bootstrap/${q}/version`)],
        ),
        allow(
            'data',
            'S3ReadCdkAssets',
            ['s3:GetBucket*', 's3:GetObject*', 's3:List*'],
            [`arn:aws:s3:::${assetsBucket}`, `arn:aws:s3:::${assetsBucket}/*`],
        ),
        ...commonDenies(q),
    ];
}

/** The grants of one qualifier. */
function grantsFor(qualifier: QualifierName): Grant[] {
    return qualifier === QUALIFIERS.account ? accountGrants() : stageGrants(qualifier);
}

/**
 * The managed policies that make up one qualifier's CloudFormation execution role.
 *
 * @param qualifier - The bootstrap qualifier.
 * @returns The parts, each a policy document under IAM's size limit, with `<account>` and `<region>` placeholders
 *   still in the resource ARNs (fill them with `renderDocument`). Pure.
 */
export function buildExecutionPolicy(qualifier: QualifierName): readonly ExecutionPolicyPart[] {
    const grants = grantsFor(qualifier);

    return PART_NAMES.flatMap((name) => {
        const mine = grants.filter((grant) => grant.part === name);

        if (mine.length === 0) {
            return [];
        }

        return [
            {
                name,
                policyName: executionPolicyName(qualifier, name),
                document: { Version: '2012-10-17', Statement: mine.map((grant) => grant.statement) } as PolicyDocument,
                covers: [...new Set(mine.flatMap((grant) => [...(grant.covers ?? [])]))],
            },
        ];
    });
}
