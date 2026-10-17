/**
 * @module boundary — the permissions boundary applied to every role a qualifier's stacks create (ADR-0065).
 *
 * The execution policy decides what CloudFormation may BUILD; the boundary decides what anything it built may DO,
 * whatever that thing's own policy says. A branch deploy that writes a role with `iam:*` still gets a role that
 * cannot call IAM, a role created in the sandbox tier cannot read a production name, and a role whose own policy says
 * `secretsmanager:GetSecretValue` on `*` can still read only KitchenSink's secrets, not the other application's in
 * this shared account.
 *
 * ## The two halves
 *
 * - **Allow** is a table of grants, each an action list bound to the RESOURCES it may touch. The actions are the ones
 *   the synthesized roles really use, derived by `scripts/deriveResourceTypes.ts` and committed in `manifests/`; the
 *   resources are the KitchenSink names those roles use (`kitchensink-*`, `/kitchensink/*`, the Nova models, the
 *   registry's database logins). `boundary.test.ts` holds the actions to be a SUPERSET of the manifest and
 *   `boundaryResources.test.ts` holds every synthesized (action, resource) pair to be admitted, so a new construct
 *   that needs new access fails a test, not a deploy. It is deliberately not a `<service>:*` list: widening a role
 *   past what the apps use is a reviewed change here.
 * - **Deny** is the escalation set (every IAM mutation, organizations, account, the bootstrap and CI roles) and the
 *   other tier's names. Denies win over any Allow in a role's own policy.
 *
 * ## What is NOT bounded by name, and why it is safe or named
 *
 * - A secret or an EC2 instance whose name CloudFormation GENERATES (`DatabaseCredentialsSecret...`, no stack prefix)
 *   cannot be matched by name, so those two are granted on `*` under a `StringLike` on the
 *   `aws:cloudformation:stack-name` resource tag, pinned to the tier's stack patterns: a resource of the other
 *   application is either untagged or tagged with a stack that is not ours, and the condition fails closed.
 * - `ecs:RunTask` names a task definition whose family is generated; it is bounded by the cluster it runs in.
 * - Actions with no resource-level form, or whose list-all form is evaluated against `*`, are the NAMED residuals
 *   {@link STAR_RESOURCE_ACTIONS}; actions that DO take a resource but whose resource id carries no name to match are
 *   {@link OTHER_APPLICATION_REACH}. Both are judged in both directions by `boundaryResources.test.ts`, so neither
 *   list can grow or rot unseen.
 * - `rds-db:connect` is bounded to the registry's login names; the resource id in front of the name is an opaque
 *   `db-XXXX` that cannot be told apart by tier, so the SEPARATION of production from non-production database
 *   access rests on the role's own resource and on the execution policy that only lets a tier deploy its own stacks.
 *
 * @pattern Specification / policy module — a capability cap judged by a superset guard and an escalation guard
 */
import { ACCOUNT, REGION, type Condition, type PolicyDocument, type Statement } from './policyDocument.js';
import { QUALIFIERS, STACK_TAG_PATTERNS, TIER_TAG_KEY, tierTagValue, type QualifierName } from './qualifiers.js';
import { resourceTypesOf, tierNameResources } from './tierNames.js';

/** An ARN in any region of this account. */
const arn = (service: string, resource: string): string => `arn:aws:${service}:*:${ACCOUNT}:${resource}`;

const SQS = arn('sqs', 'kitchensink-*');
const SNS = arn('sns', 'kitchensink-*');
const DYNAMODB = arn('dynamodb', 'table/kitchensink-*');
const EVENT_BUS = arn('events', 'event-bus/kitchensink-*');
const EVENT_RULE = arn('events', 'rule/kitchensink-*');
const S3 = 'arn:aws:s3:::kitchensink-*';
/** `kitchensink/...` and `kitchensink-...`: `?` is exactly one character. */
const SECRET_NAMED = arn('secretsmanager', 'secret:kitchensink?*');
const SECRET_ANY = arn('secretsmanager', 'secret:*');
const PARAMETER = arn('ssm', 'parameter/kitchensink/*');
const FUNCTION = arn('lambda', 'function:kitchensink-*');
/** Every log group a stack makes carries `kitchensink` (`/aws/lambda/kitchensink-...`, `/kitchensink/...`, `kitchensink-...-LogGroup-...`). */
const LOG_GROUPS = ['log-group:/aws/lambda/kitchensink-*', 'log-group:kitchensink-*'].map((group) =>
    arn('logs', group),
);
const ECR = arn('ecr', 'repository/kitchensink-*');
/** Clusters, services and tasks: a cluster named kitchensink-..., or a service or task under one. */
const ECS = ['cluster', 'service', 'task'].map((type) => arn('ecs', `${type}/kitchensink-*`));
const TASK_DEFINITION = arn('ecs', 'task-definition/*');
const STACK = arn('cloudformation', 'stack/kitchensink-*/*');
const DB_INSTANCE = arn('rds', 'db:kitchensink-*');
const DB_INSTANCE_ANY = arn('rds', 'db:*');
const DB_CLUSTER_ANY = arn('rds', 'cluster:*');
/** A state machine's name is CloudFormation-generated WITHOUT the stack prefix, so only the tag can bound it. */
const STATE_MACHINE_ANY = arn('states', 'stateMachine:*');
const INSTANCE = arn('ec2', 'instance/*');
const DISTRIBUTION = `arn:aws:cloudfront::${ACCOUNT}:distribution/*`;
const KEY_VALUE_STORE = `arn:aws:cloudfront::${ACCOUNT}:key-value-store/*`;
const HOSTED_ZONE = 'arn:aws:route53:::hostedzone/*';
const ROLE_KITCHENSINK = `arn:aws:iam::${ACCOUNT}:role/kitchensink-*`;
const MODELS = [
    'arn:aws:bedrock:*::foundation-model/amazon.nova-*',
    arn('bedrock', 'inference-profile/*amazon.nova-*'),
];

/**
 * The PostgreSQL logins the services connect as, one prefix per database (`food_app`, `food_migrator`, `food_seeder`,
 * `identity_service`, `identity_migrator`, `recipe_app`, `recipe_migrator`). A prefix and not seven names, because the
 * boundary has to fit one managed policy. The owner roles (`<database>_owner`) match the prefix but are NOLOGIN and
 * never hold `rds_iam`, so no token authenticates as one (ADR-0039). `boundaryResources.test.ts` holds the prefixes
 * equal to the databases of `DATABASE_ROLES` in `@kitchensink/db-schema-guard`.
 */
const DB_USERS = ['food', 'identity', 'recipe'].map((database) => arn('rds-db', `dbuser:*/${database}_*`));

/** The tier's stack-name tag patterns; the account tier serves both stage tiers' CI roles, so it takes both. */
const stackTagPatterns = (qualifier: QualifierName): readonly string[] =>
    qualifier === QUALIFIERS.account
        ? [...STACK_TAG_PATTERNS[QUALIFIERS.nonprod], ...STACK_TAG_PATTERNS[QUALIFIERS.prod]]
        : STACK_TAG_PATTERNS[qualifier];

/** One grant: actions per tier, the resources they may touch, and an optional condition. */
interface Grant {
    readonly sid: string;
    readonly resources: readonly string[];
    readonly condition?: (qualifier: QualifierName) => Condition;
    readonly actions: Readonly<Partial<Record<QualifierName, readonly string[]>>>;
}

const stage = (actions: readonly string[]): Grant['actions'] => ({ ksnonprod: actions, ksprod: actions });

const SQS_ACTIONS = [
    'sqs:ChangeMessageVisibility',
    'sqs:DeleteMessage',
    'sqs:GetQueueAttributes',
    'sqs:GetQueueUrl',
    'sqs:ReceiveMessage',
    'sqs:SendMessage',
];
const S3_ACTIONS = [
    's3:Abort*',
    's3:DeleteObject*',
    's3:GetBucket*',
    's3:GetObject*',
    's3:List*',
    's3:PutObject',
    's3:PutObjectLegalHold',
    's3:PutObjectRetention',
    's3:PutObjectTagging',
    's3:PutObjectVersionTagging',
];
const SECRET_ACTIONS = ['secretsmanager:DescribeSecret', 'secretsmanager:GetSecretValue'];
const ECR_PULL = ['ecr:BatchCheckLayerAvailability', 'ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'];

/** The tag CloudFormation puts on every resource a stack makes. Only CloudFormation can set an `aws:` tag. */
const RESOURCE_TAG_KEY = 'aws:ResourceTag/aws:cloudformation:stack-name';

const secretTag = (qualifier: QualifierName): Condition => ({
    StringLike: { 'secretsmanager:ResourceTag/aws:cloudformation:stack-name': stackTagPatterns(qualifier) },
});

const GRANTS: readonly Grant[] = [
    {
        // Queues, topics, tables, buses and rules share one statement: an action only ever meets a resource of its
        // own service, so listing them together grants nothing across services and saves the size budget.
        sid: 'Messaging',
        resources: [SQS, SNS, DYNAMODB, EVENT_BUS, EVENT_RULE],
        actions: {
            ksnonprod: [
                'dynamodb:PutItem',
                'events:DisableRule',
                'events:EnableRule',
                'events:ListTagsForResource',
                'events:PutEvents',
                ...SQS_ACTIONS,
                'sns:Publish',
            ],
            ksprod: ['dynamodb:PutItem', 'events:PutEvents', ...SQS_ACTIONS, 'sns:Publish'],
            ksaccount: ['sns:GetTopicAttributes', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl'],
        },
    },
    { sid: 'S3', resources: [S3], actions: { ...stage(S3_ACTIONS), ksaccount: ['s3:ListBucket'] } },
    {
        sid: 'SecretsNamed',
        resources: [SECRET_NAMED],
        actions: { ...stage([...SECRET_ACTIONS, 'secretsmanager:PutSecretValue']), ksaccount: SECRET_ACTIONS },
    },
    {
        sid: 'SecretsByStack',
        resources: [SECRET_ANY],
        condition: secretTag,
        actions: { ...stage([...SECRET_ACTIONS, 'secretsmanager:PutSecretValue']), ksaccount: SECRET_ACTIONS },
    },
    {
        sid: 'Parameters',
        resources: [PARAMETER],
        actions: {
            ksnonprod: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:PutParameter'],
            ksprod: ['ssm:GetParameters'],
            ksaccount: [
                'ssm:DeleteParameter',
                'ssm:GetParameter',
                'ssm:GetParameters',
                'ssm:GetParametersByPath',
                'ssm:PutParameter',
            ],
        },
    },
    {
        // A function name is truncated by CloudFormation (64 characters) and the stage token is what is cut, so the
        // name alone cannot keep a non-production role off a production function, which would then run with its own
        // production role. The stack-name tag is not truncated. A state machine has no stack prefix at all, and an EC2
        // instance is addressed by id. An action only ever meets a resource of its own service, so the three share
        // one statement (and one copy of the condition) instead of three.
        sid: 'TaggedCompute',
        resources: [FUNCTION, STATE_MACHINE_ANY, INSTANCE],
        condition: (qualifier) => ({
            StringLike: { [RESOURCE_TAG_KEY]: stackTagPatterns(qualifier) },
        }),
        actions: {
            ksnonprod: [
                'ec2:StartInstances',
                'ec2:StopInstances',
                'lambda:GetFunction',
                'lambda:InvokeFunction',
                'states:StartExecution',
            ],
            ksprod: ['lambda:GetFunction', 'lambda:InvokeFunction'],
            ksaccount: [
                'lambda:GetFunctionConfiguration',
                'lambda:GetFunctionUrlConfig',
                'lambda:InvokeFunction',
                'states:DescribeStateMachine',
                'states:ListExecutions',
            ],
        },
    },
    {
        sid: 'Ecr',
        resources: [ECR],
        actions: {
            ksnonprod: ECR_PULL,
            ksprod: ECR_PULL,
            ksaccount: [
                ...ECR_PULL,
                'ecr:CompleteLayerUpload',
                'ecr:CreateRepository',
                'ecr:DeleteRepository',
                'ecr:DescribeImages',
                'ecr:DescribeRepositories',
                'ecr:InitiateLayerUpload',
                'ecr:ListImages',
                'ecr:PutImage',
                'ecr:PutImageTagMutability',
                'ecr:PutLifecyclePolicy',
                'ecr:TagResource',
                'ecr:UploadLayerPart',
            ],
        },
    },
    {
        sid: 'Logs',
        resources: LOG_GROUPS,
        actions: {
            ...stage([
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:DescribeLogStreams',
                'logs:FilterLogEvents',
                'logs:GetLogEvents',
                'logs:PutLogEvents',
            ]),
        },
    },
    {
        // The account tier is a CEILING over the CI roles, which delete a preview's log groups by a pattern that
        // carries the stage in the middle (`*kitchensink-*-pr-*`); the stage tiers' roles never delete one.
        sid: 'LogGroupsByName',
        resources: [arn('logs', 'log-group:*kitchensink*')],
        actions: { ksaccount: ['logs:DeleteLogGroup'] },
    },
    { sid: 'Bedrock', resources: MODELS, actions: stage(['bedrock:InvokeModel']) },
    { sid: 'DatabaseLogin', resources: DB_USERS, actions: stage(['rds-db:connect']) },
    { sid: 'CloudFrontInvalidation', resources: [DISTRIBUTION], actions: stage(['cloudfront:CreateInvalidation']) },
    {
        sid: 'EcsResources',
        resources: ECS,
        actions: {
            ksnonprod: [
                'ecs:DeleteService',
                'ecs:DescribeClusters',
                'ecs:DescribeServices',
                'ecs:DescribeTasks',
                'ecs:StopTask',
                'ecs:TagResource',
                'ecs:UpdateService',
            ],
            ksprod: ['ecs:TagResource'],
            ksaccount: [
                'ecs:DeleteService',
                'ecs:DescribeServices',
                'ecs:DescribeTasks',
                'ecs:ListServices',
                'ecs:ListTasks',
                'ecs:StopTask',
            ],
        },
    },
    {
        sid: 'EcsRunTask',
        resources: [TASK_DEFINITION],
        condition: () => ({ ArnLike: { 'ecs:cluster': [arn('ecs', 'cluster/kitchensink-*')] } }),
        actions: stage(['ecs:RunTask']),
    },
    {
        sid: 'Stacks',
        resources: [STACK],
        actions: {
            ksnonprod: ['cloudformation:DeleteStack', 'cloudformation:ListStackResources'],
            ksaccount: [
                'cloudformation:DeleteStack',
                'cloudformation:DescribeStackEvents',
                'cloudformation:DescribeStackResources',
                'cloudformation:DescribeStacks',
                'cloudformation:GetTemplate',
                'cloudformation:GetTemplateSummary',
                'cloudformation:ListStackResources',
            ],
        },
    },
    {
        sid: 'DatabaseInstances',
        resources: [DB_INSTANCE],
        actions: { ksnonprod: ['rds:StartDBInstance', 'rds:StopDBInstance'] },
    },
    {
        sid: 'DatabaseDescribe',
        resources: [DB_INSTANCE_ANY, DB_CLUSTER_ANY],
        actions: {
            ksaccount: ['rds:DescribeDBClusters', 'rds:DescribeDBInstances'],
        },
    },
    {
        sid: 'KeyValueStores',
        resources: [KEY_VALUE_STORE],
        actions: {
            ksaccount: [
                'cloudfront-keyvaluestore:DeleteKey',
                'cloudfront-keyvaluestore:DescribeKeyValueStore',
                'cloudfront-keyvaluestore:GetKey',
                'cloudfront-keyvaluestore:ListKeys',
                'cloudfront-keyvaluestore:PutKey',
            ],
        },
    },
    {
        sid: 'HostedZones',
        resources: [HOSTED_ZONE],
        actions: {
            ksaccount: ['route53:ChangeResourceRecordSets', 'route53:GetHostedZone', 'route53:ListResourceRecordSets'],
        },
    },
    {
        sid: 'IamReads',
        resources: [ROLE_KITCHENSINK, 'arn:aws:iam::aws:policy/*'],
        actions: {
            ksaccount: [
                'iam:GetPolicy',
                'iam:GetPolicyVersion',
                'iam:GetRolePolicy',
                'iam:ListAttachedRolePolicies',
                'iam:ListRolePolicies',
            ],
        },
    },
];

/**
 * Actions allowed on `*`, each with the reason a resource cannot bound it. Every reason starts with READ or WRITE.
 *
 * Not a convenience list: none is a queue, topic, secret, parameter, object, invoke, login or log-content action
 * (`boundaryResources.test.ts` refuses those here). But a WRITE on `*` is a write on the other application's resources
 * too, and each says what it can do to them; a READ returns names or configuration, and says what it can return.
 *
 * Reasons cite the AWS Service Authorization Reference for the service. The first sandbox deploy proves them; a scope
 * that is too narrow fails loudly and rolls the stack back.
 */
export const STAR_RESOURCE_ACTIONS: Readonly<Record<string, string>> = {
    'cloudformation:DescribeStacks':
        'READ: a list-all describe is evaluated against "*"; returns the parameters and outputs of every stack in the account',
    'cloudformation:ListExports': 'READ: no resource-level form; returns the export names and values of every stack',
    'cloudformation:ListStacks': 'READ: no resource-level form; returns the names and status of every stack',
    'cloudwatch:GetMetricStatistics': 'READ: metrics take no resource-level permission; returns numbers for any metric',
    'ec2:AssignPrivateIpAddresses':
        'WRITE: the VPC-access policy of a Lambda role uses "*"; can move private addresses on any interface in the account, including the other application',
    'ec2:CreateNetworkInterface':
        'WRITE: the Lambda service creates interfaces with the role; AWS documents "*" for it; can create interfaces in any subnet of the account, including the other application, using up its addresses',
    'ec2:DeleteNetworkInterface':
        'WRITE: the Lambda service removes interfaces with the role; can delete any unattached interface in the account, including the other application',
    'ec2:DescribeInstances': 'READ: Describe* has no resource-level form; returns the metadata of every instance',
    'ec2:DescribeNetworkInterfaces':
        'READ: Describe* has no resource-level form; returns the metadata of every interface',
    'ec2:DescribeSubnets': 'READ: Describe* has no resource-level form; returns the metadata of every subnet',
    'ec2:UnassignPrivateIpAddresses':
        'WRITE: the VPC-access policy of a Lambda role uses "*"; can release private addresses on any interface in the account, including the other application',
    'ecr:GetAuthorizationToken':
        'READ: a registry token is account-wide and has no resource-level form; it carries only the ECR permissions the boundary already bounds to kitchensink repositories',
    'ecs:DescribeTaskDefinition':
        'READ: takes a family the stacks do not prefix; returns the configuration of any task definition',
    'ecs:ListClusters': 'READ: a list-all call has no resource-level form; returns every cluster name',
    'ecs:ListServices': 'READ: a list-all call is evaluated against "*"; returns service names',
    'ecs:ListTasks': 'READ: a list-all call is evaluated against "*"; returns task ids',
    'events:ListRules': 'READ: no resource-level form; returns the rule names of the default bus',
    'logs:CreateLogDelivery':
        'WRITE: log deliveries have no resource-level form; creates a delivery from any source in the account, including the other application',
    'logs:DeleteLogDelivery':
        'WRITE: log deliveries have no resource-level form; can delete any log delivery in the account, stopping the logs of the other application',
    'logs:DescribeLogGroups':
        'READ: a list-all describe is evaluated against "*"; returns every log group name and its retention',
    'logs:DescribeSubscriptionFilters':
        'READ: the CI roles read the filters of any log group by a list-all form; returns the filters of every log group, including the other application',
    'logs:DescribeResourcePolicies':
        'READ: log resource policies have no resource-level form; returns every policy in the account',
    'logs:GetLogDelivery':
        'READ: log deliveries have no resource-level form; returns the configuration of any delivery',
    'logs:ListLogDeliveries': 'READ: log deliveries have no resource-level form; returns every delivery in the account',
    'logs:PutResourcePolicy':
        'WRITE: log resource policies have no resource-level form; can replace any policy in the account, which can grant a service write access to the log groups of the other application or remove its access',
    'logs:UpdateLogDelivery':
        'WRITE: log deliveries have no resource-level form; can change any log delivery in the account, redirecting the logs of the other application',
    'rds:DescribeDBInstances':
        'READ: a list-all describe is evaluated against "*"; returns the configuration of every instance',
    'route53:GetChange': 'READ: takes a change id, not a zone; returns the status of any change',
    'route53:ListHostedZones': 'READ: a list-all call has no resource-level form; returns every zone name',
    'route53:ListHostedZonesByName': 'READ: a list-all call has no resource-level form; returns every zone name',
    'tag:GetResources':
        'READ: the tagging API has no resource-level form; returns the ARNs and tags of every tagged resource in the account',
    'xray:GetSamplingRules': 'READ: X-Ray sampling calls have no resource-level form; returns configuration',
    'xray:GetSamplingTargets': 'READ: X-Ray sampling calls have no resource-level form; returns configuration',
    'xray:PutTelemetryRecords':
        "WRITE: X-Ray telemetry has no resource-level form; adds records to the account's traces only",
    'xray:PutTraceSegments':
        "WRITE: X-Ray traces have no resource-level form; adds segments to the account's traces only",
};

/**
 * Actions that take a resource but are allowed on resources the boundary cannot tell from the other application's,
 * because the resource id carries no name to match. Each is judged against a table of other-application ARNs by
 * `boundaryResources.test.ts`, which fails if an action reaches one that is not listed, and also if a listed action
 * reaches none (so the list cannot rot).
 */
export const OTHER_APPLICATION_REACH: Readonly<Record<string, string>> = {
    'cloudfront:CreateInvalidation':
        'a distribution id is generated and carries no name; invalidates a cache, reads nothing',
    'cloudfront-keyvaluestore:DeleteKey': 'a key-value store id carries no name to match (account tier only)',
    'cloudfront-keyvaluestore:DescribeKeyValueStore':
        'a key-value store id carries no name to match (account tier only)',
    'cloudfront-keyvaluestore:GetKey': 'a key-value store id carries no name to match (account tier only)',
    'cloudfront-keyvaluestore:ListKeys': 'a key-value store id carries no name to match (account tier only)',
    'cloudfront-keyvaluestore:PutKey': 'a key-value store id carries no name to match (account tier only)',
    'rds:DescribeDBClusters': 'a list-all describe is evaluated against every cluster; configuration only',
    'rds:DescribeDBInstances': 'a list-all describe is evaluated against every instance; configuration only',
    'route53:ChangeResourceRecordSets': 'a hosted zone id carries no name to match (account tier only)',
    'route53:GetHostedZone': 'a hosted zone id carries no name to match (account tier only)',
    'route53:ListResourceRecordSets': 'a hosted zone id carries no name to match (account tier only)',
};

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

/** The actions each tier may use on `*`. A subset of {@link STAR_RESOURCE_ACTIONS}, which holds the reasons. */
const STAR_ACTIONS: Readonly<Record<QualifierName, readonly string[]>> = {
    ksnonprod: [
        'cloudformation:DescribeStacks',
        'cloudformation:ListStacks',
        'ec2:AssignPrivateIpAddresses',
        'ec2:CreateNetworkInterface',
        'ec2:DeleteNetworkInterface',
        'ec2:DescribeInstances',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DescribeSubnets',
        'ec2:UnassignPrivateIpAddresses',
        'ecr:GetAuthorizationToken',
        'ecs:ListClusters',
        'ecs:ListServices',
        'ecs:ListTasks',
        'events:ListRules',
        'logs:CreateLogDelivery',
        'logs:DeleteLogDelivery',
        'logs:DescribeLogGroups',
        'logs:DescribeResourcePolicies',
        'logs:GetLogDelivery',
        'logs:ListLogDeliveries',
        'logs:PutResourcePolicy',
        'logs:UpdateLogDelivery',
        'rds:DescribeDBInstances',
        'xray:GetSamplingRules',
        'xray:GetSamplingTargets',
        'xray:PutTelemetryRecords',
        'xray:PutTraceSegments',
    ],
    ksprod: [
        'ec2:AssignPrivateIpAddresses',
        'ec2:CreateNetworkInterface',
        'ec2:DeleteNetworkInterface',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DescribeSubnets',
        'ec2:UnassignPrivateIpAddresses',
        'ecr:GetAuthorizationToken',
        'logs:DescribeLogGroups',
    ],
    ksaccount: [
        'cloudformation:ListExports',
        'cloudformation:ListStacks',
        'cloudwatch:GetMetricStatistics',
        'ec2:DescribeInstances',
        'ecr:GetAuthorizationToken',
        'ecs:DescribeTaskDefinition',
        'ecs:ListClusters',
        'logs:DescribeLogGroups',
        'logs:DescribeSubscriptionFilters',
        'route53:GetChange',
        'route53:ListHostedZones',
        'route53:ListHostedZonesByName',
        'tag:GetResources',
    ],
};

const iamArn = (resource: string): string => `arn:aws:iam::${ACCOUNT}:${resource}`;

/**
 * Every IAM verb that changes anything. Reads (`Get*`, `List*`) and `iam:PassRole` stay out of it. Denied together with
 * `organizations:*` and `account:*` in ONE statement: the boundary must fit one managed policy.
 */
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
    Condition?: Condition,
): Statement => ({ Sid, Effect, Action, Resource, ...(Condition === undefined ? {} : { Condition }) });

/**
 * The Deny that keeps one stage tier out of resources tagged for another tier (ADR-0065). The names catch the types
 * that have a name; the tier tag also reaches the types CloudFormation names by id.
 */
function tierTagDeny(qualifier: QualifierName): Statement[] {
    if (qualifier === QUALIFIERS.account) {
        return [];
    }

    const others = Object.values(QUALIFIERS)
        .filter((other) => other !== qualifier)
        .map(tierTagValue)
        .sort();

    return [
        statement('DenyOtherTierTag', 'Deny', ['*'], ['*'], {
            StringEquals: { [`aws:ResourceTag/${TIER_TAG_KEY}`]: others },
        }),
    ];
}

/**
 * The Deny that keeps one stage tier out of the other's names: one ARN per resource TYPE the boundary's own Allows
 * name (IAM refuses a wildcard where the type belongs), in the compact stage-token form so the boundary stays ONE
 * managed policy under IAM's 6,144-character limit.
 *
 * Allows under a stack-name tag condition (`TaggedCompute`: lambda, states, ec2) are left out: a resource of the other
 * tier does not satisfy the tag, and there is no room for a second line of defence. `tierNames.test.ts` holds the
 * derivation in both directions.
 */
function tierNameDeny(qualifier: QualifierName, allows: readonly Statement[]): Statement[] {
    const types = resourceTypesOf(allows, true);

    if (qualifier === QUALIFIERS.nonprod) {
        return [statement('DenyProductionNames', 'Deny', ['*'], tierNameResources('production', types, 'compact'))];
    }

    if (qualifier === QUALIFIERS.prod) {
        return [
            statement('DenyNonProductionNames', 'Deny', ['*'], tierNameResources('nonproduction', types, 'compact')),
        ];
    }

    return [];
}

/**
 * The Allow statements of one tier: ONE statement for every grant without a condition, one statement per conditioned
 * grant, then the residual `*` statement.
 *
 * An action only ever meets a resource of its own service, so unconditioned grants share a statement without granting
 * anything across services (the table keeps one entry per service for the reader); each statement saved is a wrapper's
 * worth of the 6,144-character managed-policy budget. A conditioned grant keeps its own statement, because the
 * condition would otherwise apply to the rest.
 */
function allowStatements(qualifier: QualifierName): Statement[] {
    const mine = GRANTS.flatMap((grant) => {
        const actions = grant.actions[qualifier];

        return actions === undefined ? [] : [{ grant, actions }];
    });
    const plain = mine.filter(({ grant }) => grant.condition === undefined);
    const conditioned = mine.filter(({ grant }) => grant.condition !== undefined);

    return [
        statement(
            'AllowNamedResources',
            'Allow',
            [...new Set(plain.flatMap(({ actions }) => actions))].sort(),
            plain.flatMap(({ grant }) => grant.resources),
        ),
        ...conditioned.map(({ grant, actions }) =>
            statement(grant.sid, 'Allow', [...actions].sort(), grant.resources, grant.condition?.(qualifier)),
        ),
        statement('AllowNoResourceLevelActions', 'Allow', [...STAR_ACTIONS[qualifier]].sort(), ['*']),
    ];
}

/**
 * The permissions boundary of one qualifier.
 *
 * @param qualifier - The bootstrap qualifier.
 * @returns A policy document with `<account>` placeholders. Pure.
 */
export function buildBoundary(qualifier: QualifierName): PolicyDocument {
    const account = qualifier === QUALIFIERS.account;

    const allows: Statement[] = [
        ...allowStatements(qualifier),
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
    ];

    const statements: Statement[] = [
        ...allows,
        statement('DenyEscalation', 'Deny', [...IAM_MUTATIONS, 'organizations:*', 'account:*'], ['*']),
        ...(account
            ? [statement('DenyDefaultQualifierRoles', 'Deny', ['sts:AssumeRole'], [iamArn('role/cdk-hnb659fds-*')])]
            : [
                  statement(
                      'DenyBootstrapAndCiRoles',
                      'Deny',
                      ['sts:AssumeRole'],
                      [iamArn('role/cdk-*'), iamArn('role/kitchensink-gha-*')],
                  ),
              ]),
        ...tierNameDeny(qualifier, allows),
        ...tierTagDeny(qualifier),
    ];

    return { Version: '2012-10-17', Statement: statements };
}

/** Kept for readers of the region placeholder: boundaries are region-agnostic, so it is unused in the documents. */
export const BOUNDARY_REGION_PLACEHOLDER = REGION;
