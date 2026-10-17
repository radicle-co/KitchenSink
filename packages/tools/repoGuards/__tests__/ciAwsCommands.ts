/**
 * The AWS commands the CI jobs run against an OBSERVE service, with the IAM action each needs, one authoritative
 * table for two readers: the access-stack test requires each role's observe grants to equal it, and
 * `awsCliObserveCoverage.test.ts` requires it to equal what the CI files actually call. Neither reader may carry
 * its own copy of the list, because a copy cannot tell that the list is incomplete.
 *
 * A row is `[caller, action, a real resource shape, tiers]`. The caller is prose for the reader of a failure; the
 * coverage guard works from the SOURCE, not from this text.
 */

export const OBSERVE_TIERS = ['nonprod', 'prod'] as const;
export type ObserveTier = (typeof OBSERVE_TIERS)[number];

export type ObserveRow = readonly [caller: string, action: string, resource: string, tiers: readonly ObserveTier[]];

/** Services whose Allows are "observe" grants. The teardown verbs are `TEARDOWN`'s, held by their own table. */
export const OBSERVE_SERVICE = /^(ecs|logs|rds|ec2|states|sns|sqs|tag|cloudwatch|iam):/u;

/** The destructive observe-service actions: granted to the non-prod role on per-PR names only. */
export const TEARDOWN: ReadonlySet<string> = new Set(['ecs:DeleteService', 'ecs:StopTask', 'logs:DeleteLogGroup']);

/**
 * @param env - The account and region the resource ARNs are built for.
 * @returns Every enumerated observe command.
 */
export function observeCommands(env: { readonly account: string; readonly region: string }): readonly ObserveRow[] {
    const { account, region } = env;
    const ALL = OBSERVE_TIERS;
    const arn = (service: string, rest: string): string => `arn:aws:${service}:${region}:${account}:${rest}`;
    const CLUSTER = 'kitchensink-food-service-pr-91-FoodServiceCluster442EDB29-QR9FHWWoNVeo';
    const QUEUE_CHECK_ROLE = `arn:aws:iam::${account}:role/kitchensink-recipe-workers-p-QueueCheckRole90B692FA-blEhaaA5OyQT`;
    const MANAGED_POLICY = 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole';
    const STATE_MACHINE = arn('states', 'stateMachine:ReclaimStateMachineAB12-xYz');
    const GROUP = arn('logs', 'log-group:/aws/lambda/kitchensink-recipe-workers-pr-91');

    return [
        ['deploy checks: aws ecs describe-services', 'ecs:DescribeServices', arn('ecs', `service/${CLUSTER}/api`), ALL],
        ['deploy checks: aws ecs describe-task-definition', 'ecs:DescribeTaskDefinition', '*', ALL],
        ['deploy checks: aws ecs list-clusters', 'ecs:ListClusters', '*', ALL],
        ['deploy checks: aws ecs list-services', 'ecs:ListServices', arn('ecs', `cluster/${CLUSTER}`), ALL],
        ['ecsQuiesce.sh: aws ecs list-tasks', 'ecs:ListTasks', arn('ecs', `cluster/${CLUSTER}`), ALL],
        ['ecsQuiesce.sh: aws ecs wait tasks-stopped', 'ecs:DescribeTasks', arn('ecs', `task/${CLUSTER}/0123abcd`), ALL],
        ['verifyDeployment.sh: aws logs describe-log-groups', 'logs:DescribeLogGroups', GROUP, ALL],
        ['verifyDeployment.sh: aws logs describe-subscription-filters', 'logs:DescribeSubscriptionFilters', GROUP, ALL],
        [
            'verifyDeployment.sh: aws rds describe-db-instances',
            'rds:DescribeDBInstances',
            arn('rds', 'db:kitchensink-data-sandbox-db'),
            ALL,
        ],
        [
            'verifyDeployment.sh: aws rds describe-db-clusters',
            'rds:DescribeDBClusters',
            arn('rds', 'cluster:kitchensink-data-sandbox'),
            ALL,
        ],
        ['sandboxWake.sh: aws ec2 describe-instances', 'ec2:DescribeInstances', '*', ALL],
        [
            'verifyDeployment.sh: aws sqs get-queue-attributes',
            'sqs:GetQueueAttributes',
            arn('sqs', 'kitchensink-recipe-parse-pr-91'),
            ALL,
        ],
        [
            'verifyDeployment.sh: aws sqs get-queue-url',
            'sqs:GetQueueUrl',
            arn('sqs', 'kitchensink-recipe-parse-pr-91'),
            ALL,
        ],
        [
            'verifyDeployment.sh: aws sns get-topic-attributes',
            'sns:GetTopicAttributes',
            arn('sns', 'kitchensink-handle-sync-sandbox'),
            ALL,
        ],
        [
            'verifyDeployment.sh: aws stepfunctions describe-state-machine',
            'states:DescribeStateMachine',
            STATE_MACHINE,
            ALL,
        ],
        ['sandboxScheduler.sh: aws stepfunctions list-executions', 'states:ListExecutions', STATE_MACHINE, ALL],
        ['ecsQuiesce.sh, teardownSandboxPr.sh: resourcegroupstaggingapi get-resources', 'tag:GetResources', '*', ALL],
        // The queue-guarantee tier (deployedE2eTiers.yml) reads the backstop role's policies at any target stage.
        ['deployedE2eTiers.yml: aws iam list-role-policies', 'iam:ListRolePolicies', QUEUE_CHECK_ROLE, ALL],
        [
            'deployedE2eTiers.yml: aws iam list-attached-role-policies',
            'iam:ListAttachedRolePolicies',
            QUEUE_CHECK_ROLE,
            ALL,
        ],
        ['deployedE2eTiers.yml: aws iam get-role-policy', 'iam:GetRolePolicy', QUEUE_CHECK_ROLE, ALL],
        ['deployedE2eTiers.yml: aws iam get-policy', 'iam:GetPolicy', MANAGED_POLICY, ALL],
        ['deployedE2eTiers.yml: aws iam get-policy-version', 'iam:GetPolicyVersion', MANAGED_POLICY, ALL],
        // `food-loadtest.yml`'s collector (`collectMetrics.mjs`, run by `run.mjs`) samples the food queue gauges on
        // every tier: the workflow signs in as `nonprod` for a preview target.
        ['food-loadtest.yml collector', 'cloudwatch:GetMetricStatistics', '*', ALL],
    ];
}
