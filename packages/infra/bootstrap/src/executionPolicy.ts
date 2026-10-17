/**
 * @module executionPolicy — what CloudFormation may do when it deploys for one qualifier (ADR-0065).
 *
 * The bootstrap's execution role was `AdministratorAccess`, so whoever could make CloudFormation deploy a template
 * was an account administrator. This module is the replacement: a DATA TABLE of grants, rendered into several
 * managed policies (each under IAM's 6144-character limit). Nothing is assembled from strings.
 *
 * ## The rules the table is built to
 *
 * - **Names and the tier tag are the boundary.** Every Allow is scoped to `kitchensink-*` names (or `/kitchensink/…`),
 *   and every modify or delete to the `kitchensink:tier` tag the CDK apps put on their whole tree. A resource without
 *   the tag matches nothing, so the grant fails CLOSED. CloudFormation's own `aws:cloudformation:stack-name` is NOT
 *   used: CloudFormation omits it on ACM certificates, ECS, DynamoDB, CloudFront and some SQS queues.
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
import { isReadOnlyPattern, isTagAddPattern, tagKeySupport } from './iamCatalogue.js';
import { iamCatalogueSnapshot } from './iamCatalogueSnapshot.js';
import { ACCOUNT, REGION, type Condition, type PolicyDocument, type Statement } from './policyDocument.js';
import {
    QUALIFIERS,
    STACK_TAG_PATTERNS,
    TIER_TAG_KEY,
    boundaryPolicyName,
    executionPolicyName,
    tierTagValue,
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

const PART_NAMES = ['compute', 'data', 'observe', 'network', 'edge', 'iam', 'tags', 'guard'] as const;

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
    /**
     * Marks a grant that exists only to be folded into the ONE `TagNew` statement (see `mergeTagAdds`): the
     * tag-adding actions whose resources may not carry the tier tag yet.
     */
    readonly tagAdd?: true;
}

const arn = (service: string, resource: string, regional = true): string =>
    regional ? `arn:aws:${service}:${REGION}:${ACCOUNT}:${resource}` : `arn:aws:${service}::${ACCOUNT}:${resource}`;

const KS = 'kitchensink-*';
const iamArn = (resource: string): string => `arn:aws:iam::${ACCOUNT}:${resource}`;

/** The key a modify or delete is judged on: the tag the resource ALREADY carries. */
const RESOURCE_TIER_TAG = `aws:ResourceTag/${TIER_TAG_KEY}`;

/** The key a create is judged on: the tag the REQUEST puts on the new resource. */
const REQUEST_TIER_TAG = `aws:RequestTag/${TIER_TAG_KEY}`;

/** The tier tag a resource must carry for a modify, delete or configuration read to apply. */
const ownTier = (qualifier: QualifierName): Condition => ({
    StringEquals: { [RESOURCE_TIER_TAG]: tierTagValue(qualifier) },
});

/** The tier tag a create (or a tag-adding action) must carry in its request. */
const requestTier = (qualifier: QualifierName): Condition => ({
    StringEquals: { [REQUEST_TIER_TAG]: tierTagValue(qualifier) },
});

/**
 * Two conditions as one. The same operator may appear in both (`StringEquals`): their keys are merged, and the
 * same key twice is a bug, not a merge.
 */
function mergeConditions(...conditions: readonly (Condition | undefined)[]): Condition | undefined {
    const merged: Record<string, Record<string, string | readonly string[]>> = {};

    for (const condition of conditions) {
        for (const [operator, keys] of Object.entries(condition ?? {})) {
            const target = (merged[operator] ??= {});

            for (const [key, value] of Object.entries(keys)) {
                if (key in target) {
                    throw new Error(`mergeConditions: ${operator} ${key} is set twice`);
                }

                target[key] = value;
            }
        }
    }

    return Object.keys(merged).length === 0 ? undefined : merged;
}

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
 * Reads that stay under the tier tag, against the rule that reads are scoped by name only. A secret's VALUE is the
 * secret: CloudFormation reads it only to resolve a dynamic reference to a secret that already exists, so no
 * create-time read needs it ungated, and CDK's generated secret names carry no `kitchensink` prefix to scope by.
 */
export const TAG_GATED_READS: readonly string[] = ['secretsmanager:GetSecretValue'];

/**
 * An Allow for resources that carry the tier tag: mutations and deletes keep the tag condition, READS do not.
 *
 * CloudFormation's resource handlers read before they create (an existence or attribute check on a resource that has
 * no tag yet), so a read gated on the tag is denied at create time (the first sandbox probe: `SNS:GetTopicAttributes`
 * on a topic that did not exist). Reads are scoped by NAME only; they change nothing, and the tier Denies and the
 * name patterns still refuse the other tier. The read statement is named `<Sid>Reads`.
 *
 * A TAGGING action cannot require the tag it is adding, so a tag-adding action that stays here (allowed when the
 * resource already carries the tier tag) also gets a request-tag twin, folded into the part's `TagNew` statement
 * (`mergeTagAdds`). Resources addressed by `*` get no twin: a request-added tag on `*` would let a stack claim ANY
 * resource of the account, so those types take the tag when they are created or from the one-shot admin re-tag.
 * ⚠️ The twin does NOT stop at names: ACM certificates, CloudFront distributions, task definitions and generated
 * secret names are addressed by an id pattern, so there the request path can claim an untagged resource of the other
 * application. Only CloudFormation makes these calls, and only on resources a stack declares or imports (ADR-0065).
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
    const tagAdds = writes.filter((candidate) => isTagAddPattern(iamCatalogueSnapshot, candidate));

    return [
        ...(reads.length === 0 ? [] : [allow(part, `${sid}Reads`, reads, resource, writes.length === 0 ? covers : [])]),
        ...(writes.length === 0 ? [] : [allow(part, sid, writes, resource, covers, condition)]),
        ...(tagAdds.length === 0 || resource.includes('*') ? [] : [tagAddGrant(tagAdds, resource, [])]),
    ];
}

/** A placeholder for tag-adding actions, folded into the `TagNew` statement by {@link mergeTagAdds}. */
const tagAddGrant = (action: readonly string[], resource: readonly string[], covers: readonly string[]): Grant => ({
    part: 'tags',
    covers,
    tagAdd: true,
    statement: { Sid: 'TagNew', Effect: 'Allow', Action: action, Resource: resource },
});

/**
 * Actions the Service Authorization Reference says honour `aws:RequestTag`, but that must NOT be asked for it.
 *
 * A multi-resource request evaluates the condition against every resource it creates, and one of them (a volume, a
 * network interface) is not tagged by CloudFormation. And CloudFormation calls `events:PutRule` with NO tags, then tags
 * the rule in a second call (CloudTrail, every PutRule since 2026-10-10), so the request never carries the tier tag.
 * They stay name-scoped (EC2 has no names: they are residuals).
 */
const REQUEST_TAG_EXEMPT: ReadonlySet<string> = new Set([
    'ec2:RunInstances',
    'ec2:CreateNetworkInterface',
    'events:PutRule',
]);

/**
 * An Allow for CREATING resources: the resource has no tag to ask for yet, so the REQUEST must carry the tier tag.
 *
 * Each action is sorted by what the reference says it honours, never by a guess:
 *
 * - a tag-adding action goes to the shared `TagNew` statement (allowed when the request adds the tier tag);
 * - an action that honours `aws:RequestTag` stays in `<Sid>` with the request-tag condition;
 * - an action that acts on an EXISTING resource of ours (`iam:PutRolePolicy` right after its `CreateRole`) honours only
 *   `aws:ResourceTag` and moves to `<Sid>Existing`, under the resource tag;
 * - an action that honours neither (or is exempt) stays name-scoped in `<Sid>NameOnly`, a NAMED residual.
 *
 * @param tagResources - Where the tag-adding actions apply when `resource` is `*` (a distribution has no name).
 * @throws When a tag-adding action sits on `*` with no `tagResources`.
 */
function createAllow(
    qualifier: QualifierName,
    part: PartName,
    sid: string,
    action: readonly string[],
    resource: readonly string[],
    covers: readonly string[] = [],
    condition?: Condition,
    tagResources?: readonly string[],
): Grant[] {
    const snapshot = iamCatalogueSnapshot;
    const tagAdds = action.filter((candidate) => isTagAddPattern(snapshot, candidate));
    const rest = action.filter((candidate) => !tagAdds.includes(candidate));
    const exempt = rest.filter((candidate) => REQUEST_TAG_EXEMPT.has(candidate));
    const requestTagged = rest.filter(
        (candidate) =>
            !exempt.includes(candidate) &&
            tagKeySupport(snapshot, candidate, 'requestTag').supported.length > 0 &&
            tagKeySupport(snapshot, candidate, 'requestTag').unsupported.length === 0,
    );
    const existing = rest.filter(
        (candidate) =>
            !exempt.includes(candidate) &&
            !requestTagged.includes(candidate) &&
            tagKeySupport(snapshot, candidate, 'resourceTag').supported.length > 0,
    );
    const nameOnly = rest.filter((candidate) => !requestTagged.includes(candidate) && !existing.includes(candidate));
    const tagTargets = resource.includes('*') ? tagResources : resource;

    if (tagAdds.length > 0 && tagTargets === undefined) {
        throw new Error(`createAllow ${sid}: a tag-adding action on "*" needs tagResources`);
    }

    return [
        ...(requestTagged.length === 0
            ? []
            : [allow(part, sid, requestTagged, resource, covers, mergeConditions(condition, requestTier(qualifier)))]),
        ...(existing.length === 0
            ? []
            : [allow(part, `${sid}Existing`, existing, resource, [], mergeConditions(condition, ownTier(qualifier)))]),
        ...(nameOnly.length === 0
            ? []
            : [allow(part, `${sid}NameOnly`, nameOnly, resource, requestTagged.length === 0 ? covers : [], condition)]),
        ...(tagAdds.length === 0
            ? []
            : [tagAddGrant(tagAdds, tagTargets ?? [], requestTagged.length + nameOnly.length === 0 ? covers : [])]),
    ];
}

/**
 * Folds every {@link tagAddGrant} of a tier into one `TagNew` statement: allowed when the REQUEST carries the tier tag.
 *
 * It is the second half of "a tagging action is allowed when the resource already has the tag OR the request adds it".
 * Without it a newly created resource whose tag is added by a separate call (ACM, IAM, Lambda), and a legacy resource
 * that has no tag yet, could never be tagged, so nothing could ever be modified. Its resources are the NAMED ones the
 * grants it replaces already named, so it widens no scope.
 */
function mergeTagAdds(qualifier: QualifierName, grants: readonly Grant[]): Grant[] {
    const placeholders = grants.filter((grant) => grant.tagAdd === true);
    const rest = grants.filter((grant) => grant.tagAdd !== true);

    if (placeholders.length === 0) {
        return rest;
    }

    const unique = (values: readonly string[]): string[] => [...new Set(values)].sort();

    return [
        ...rest,
        {
            part: 'tags',
            covers: unique(placeholders.flatMap((grant) => [...(grant.covers ?? [])])),
            statement: {
                Sid: 'TagNew',
                Effect: 'Allow',
                Action: unique(placeholders.flatMap((grant) => [...grant.statement.Action])),
                Resource: unique(placeholders.flatMap((grant) => [...grant.statement.Resource])),
                Condition: requestTier(qualifier),
            },
        },
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
    const own = ownTier(qualifier);
    const nonprod = qualifier === QUALIFIERS.nonprod;
    const assetsBucket = `cdk-${qualifier}-assets-${ACCOUNT}-${REGION}`;
    const passServices = PASS_ROLE_SERVICES.filter((service) => !nonprod || service !== 'edgelambda.amazonaws.com');
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
        ...createAllow(
            qualifier,
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
            [
                'lambda:CreateEventSourceMapping',
                'lambda:DeleteEventSourceMapping',
                'lambda:GetEventSourceMapping',
                'lambda:UpdateEventSourceMapping',
            ],
            [arn('lambda', 'event-source-mapping:*')],
            ['AWS::Lambda::EventSourceMapping'],
            { ArnLike: { 'lambda:FunctionArn': [arn('lambda', `function:${KS}`)] } },
        ),
        // Tags on a mapping take no `lambda:FunctionArn` key, so the tier tag is their only scope; `ownAllow` adds the
        // request-tag statement that lets a mapping made before the tier tag existed receive it.
        ...ownAllow(
            'compute',
            'LambdaEventSourceMappingTags',
            ['lambda:TagResource', 'lambda:UntagResource'],
            [arn('lambda', 'event-source-mapping:*')],
            [],
            own,
        ),
        ...createAllow(
            qualifier,
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
        ...createAllow(
            qualifier,
            'compute',
            'EcsRegisterTaskDefinition',
            ['ecs:RegisterTaskDefinition'],
            ['*'],
            ['AWS::ECS::TaskDefinition'],
        ),
        ...createAllow(
            qualifier,
            'compute',
            'EcsTagTaskDefinitions',
            ['ecs:TagResource'],
            [arn('ecs', 'task-definition/*:*')],
            ['AWS::ECS::TaskDefinition'],
        ),
        ...ownAllow(
            'compute',
            'EcsTaskDefinitionsOwn',
            ['ecs:DeleteTaskDefinitions', 'ecs:DescribeTaskDefinition', 'ecs:ListTagsForResource', 'ecs:UntagResource'],
            [arn('ecs', 'task-definition/*:*')],
            ['AWS::ECS::TaskDefinition'],
            own,
        ),
        // Deregistering has no resource type in the Service Authorization Reference, so it authorizes on "*" only and no
        // tag or name can narrow it: a named residual. It retires a revision; it deletes nothing (`DeleteTaskDefinitions`
        // is tier-tagged above).
        allow(
            'compute',
            'EcsDeregisterTaskDefinition',
            ['ecs:DeregisterTaskDefinition'],
            ['*'],
            ['AWS::ECS::TaskDefinition'],
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
        ...createAllow(
            qualifier,
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
        // EventBridge and EventBridge Scheduler sit in `observe`: the compute part is at the managed-policy size limit.
        ...createAllow(
            qualifier,
            'observe',
            'EventsCreate',
            ['events:CreateEventBus', 'events:PutRule', 'events:TagResource'],
            [arn('events', `rule/${KS}`), arn('events', `rule/*/${KS}`), arn('events', `event-bus/${KS}`)],
            ['AWS::Events::Rule', 'AWS::Events::EventBus'],
        ),
        ...ownAllow(
            'observe',
            'EventsOwn',
            [
                'events:DeleteEventBus',
                'events:Describe*',
                'events:DisableRule',
                'events:EnableRule',
                'events:List*',
                'events:PutRule',
                'events:TagResource',
                'events:UntagResource',
            ],
            [arn('events', `rule/${KS}`), arn('events', `rule/*/${KS}`), arn('events', `event-bus/${KS}`)],
            ['AWS::Events::Rule', 'AWS::Events::EventBus'],
            own,
        ),
        // CloudFormation sets a new rule's targets BEFORE it tags the rule, and a rollback deletes a rule that never got
        // its tag (two per-PR stacks stuck DELETE_FAILED, 2026-10-17), so the tier tag may be absent: allowed when it is
        // this tier's OR absent. A generated rule name is truncated and carries no stage, so the condition, never the
        // name, keeps another tier's TAGGED rule out of reach (the other-tier tag Deny refuses it as well).
        allow(
            'observe',
            'EventsRuleTargets',
            ['events:DeleteRule', 'events:PutTargets', 'events:RemoveTargets'],
            [arn('events', `rule/${KS}`), arn('events', `rule/*/${KS}`)],
            [],
            { StringEqualsIfExists: { [RESOURCE_TIER_TAG]: tierTagValue(qualifier) } },
        ),
        // The bus policy actions honour no resource tag in the reference, so they are name-scoped (named residual).
        allow(
            'observe',
            'EventsBusPermissions',
            ['events:PutPermission', 'events:RemovePermission'],
            [arn('events', `event-bus/${KS}`)],
            ['AWS::Events::EventBus'],
        ),
        allow(
            'observe',
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
        ...createAllow(
            qualifier,
            'data',
            'SqsCreate',
            ['sqs:CreateQueue', 'sqs:TagQueue'],
            [arn('sqs', KS)],
            ['AWS::SQS::Queue'],
        ),
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
        ...createAllow(
            qualifier,
            'data',
            'SnsCreate',
            ['sns:CreateTopic', 'sns:TagResource'],
            [arn('sns', KS)],
            ['AWS::SNS::Topic'],
        ),
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
        ...createAllow(
            qualifier,
            'data',
            'DynamoDbCreate',
            ['dynamodb:CreateTable', 'dynamodb:TagResource'],
            [arn('dynamodb', `table/${KS}`)],
            ['AWS::DynamoDB::Table'],
        ),
        // CloudFormation tags a table's stream with the table; the stream takes no request tag here, and a refusal makes
        // CloudFormation create the TABLE untagged (Sandbox Up, 2026-10-17). The table name is the stream's scope. In the
        // compute part because the data part is at the managed-policy size limit.
        allow('compute', 'DynamoDbStreamTags', ['dynamodb:TagResource'], [arn('dynamodb', `table/${KS}/stream/*`)]),
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
        ...createAllow(
            qualifier,
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
                'rds:AddTagsToResource',
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
        allow('data', 'SecretsValueByTier', TAG_GATED_READS, [arn('secretsmanager', 'secret:*')], [], own),
        // A secret made by hand carries no tier tag, only a name that says its stage: the name is its scope, as for
        // every other named resource. `kitchensink/pr-*` cannot match `kitchensink/prod/`, which has no hyphen after `pr`.
        // In the compute part because the data part is at the managed-policy size limit.
        allow(
            'compute',
            'SecretsValueByStageName',
            TAG_GATED_READS,
            (nonprod ? ['kitchensink/sandbox/*', 'kitchensink/pr-*'] : ['kitchensink/prod/*']).map((name) =>
                arn('secretsmanager', `secret:${name}`),
            ),
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
        ...createAllow(
            qualifier,
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
                'logs:TagLogGroup',
                'logs:TagResource',
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
            [
                'cloudwatch:DeleteDashboards',
                'cloudwatch:GetDashboard',
                'cloudwatch:PutDashboard',
                'cloudwatch:TagResource',
            ],
            [arn('cloudwatch', nonprod ? 'dashboard/pr-*-food-data' : 'dashboard/food-data', false)],
            ['AWS::CloudWatch::Dashboard'],
        ),
        // ---- network ------------------------------------------------------------------------------------------
        allow('network', 'Ec2Describe', ['ec2:Describe*'], ['*']),
        ...createAllow(
            qualifier,
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
        // A rollback to a template that predates the tier tag first DeleteTags the tier tag, then CreateTags the old
        // tags; the second is refused by Ec2Own because the resource no longer carries it. EC2 tag actions address
        // "*", so there is no request path. CloudFormation's own system tag is on every EC2 resource it creates and
        // a user cannot set an `aws:` tag, so it is a sound second ownership signal HERE (not for the types that omit
        // it, ADR-0065 Decision 5a). The other tier's Deny still outranks it.
        allow('network', 'Ec2TagByStack', ['ec2:CreateTags', 'ec2:DeleteTags'], ['*'], [], {
            StringLike: { 'aws:ResourceTag/aws:cloudformation:stack-name': [...STACK_TAG_PATTERNS[qualifier]] },
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
        ...createAllow(
            qualifier,
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
        ...createAllow(
            qualifier,
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
            undefined,
            [
                arn('cloudfront', 'distribution/*', false),
                arn('cloudfront', 'function/*', false),
                arn('cloudfront', 'key-value-store/*', false),
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
        ...createAllow(
            qualifier,
            'edge',
            'AcmRequest',
            ['acm:RequestCertificate'],
            ['*'],
            ['AWS::CertificateManager::Certificate'],
            {
                'ForAllValues:StringLike': { 'acm:DomainNames': nonprod ? ['*sandbox.commise.app'] : ['*commise.app'] },
            },
        ),
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
                        ? // A preview's service hosts are `<service>-pr-N` and `<service>-sandbox` under the apex.
                          [
                              'sandbox.commise.app*',
                              '*.sandbox.commise.app*',
                              '*-sandbox.commise.app*',
                              '*-pr-*.commise.app*',
                          ]
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
        ...createAllow(
            qualifier,
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
        ...createAllow(
            qualifier,
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
        // `iam:ResourceTag`, NOT `aws:ResourceTag`: a real PassRole is refused under `aws:ResourceTag` even when the role
        // carries the tag (the policy simulator allows it, so only a deploy shows it; the first scheduler-stack deploy
        // through ksnonprod, and `passProbe` reproduced it). IAM's own key is the one PassRole is authorized by.
        allow('iam', 'IamPassRole', ['iam:PassRole'], [iamArn(`role/${KS}`)], [], {
            StringEquals: {
                'iam:PassedToService': passServices,
                [`iam:ResourceTag/${TIER_TAG_KEY}`]: tierTagValue(qualifier),
            },
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
    const merged = mergeTagAdds(qualifier, grants);

    return [
        ...merged,
        ...commonDenies(qualifier),
        ...tierDenies(
            qualifier,
            merged.map((grant) => grant.statement),
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

/**
 * Refuses every action on a resource that carries ANOTHER tier's value of the tier tag.
 *
 * The request-tag path of `TagNew` lets a stack add its own tier tag to a resource that has none; this Deny is what
 * stops it overwriting a tag that already names another tier, so a nonprod deploy can never re-tag production.
 */
function otherTierTagDeny(qualifier: QualifierName): Grant {
    const others = Object.values(QUALIFIERS)
        .filter((other) => other !== qualifier)
        .map(tierTagValue)
        .sort();

    return deny('guard', 'DenyOtherTierTag', ['*'], ['*'], { StringEquals: { [RESOURCE_TIER_TAG]: others } });
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
            otherTierTagDeny(qualifier),
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
                    'route53:ChangeResourceRecordSetsNormalizedRecordNames': [
                        '*sandbox.commise.app*',
                        '*-pr-*.commise.app*',
                    ],
                },
            }),
            otherTierTagDeny(qualifier),
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
