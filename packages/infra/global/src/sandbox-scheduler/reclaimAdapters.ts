/**
 * The AWS SDK v3 adapters for the midnight reclaim (ADR-0061).
 *
 * Kept apart from `./awsAdapters` on purpose: the nightly STOP loads that module, and the stop must never fail to start
 * because a client only the reclaim uses (`@aws-sdk/client-cloudformation`) cannot be loaded. Only `reclaimHandler`
 * imports this file.
 *
 * ⛔ THE ADAPTERS DECIDE NOTHING. Which stack is in scope is `reclaim.ts`; this file turns a port call into SDK calls. In
 * particular {@link createReclaimCloudFormationApi} sends `DeleteStack` with NO `RoleARN`: the stack's own saved role
 * does the delete, and the reclaim role's IAM grant (which stacks it may name) is the whole boundary.
 *
 * @pattern Adapter — SDK clients adapted to the ports `reclaim.ts` declares
 * @sideEffect Every method calls AWS.
 */
import { CloudFormationClient, DeleteStackCommand, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
    DeleteServiceCommand,
    DescribeTasksCommand,
    ECSClient,
    ListTasksCommand,
    StopTaskCommand,
} from '@aws-sdk/client-ecs';

import type {
    ReclaimCloudFormationApi,
    ReclaimEcsApi,
    ReclaimServiceSummary,
    ReclaimTaskSummary,
    StackSummary,
} from '../../lib/sandbox-scheduler/reclaim.js';
import { describeAllServices, listClusterSummaries } from './awsAdapters.js';

/** `DescribeTasks` accepts at most 100 tasks per call. */
const DESCRIBE_TASKS_BATCH = 100;

/**
 * The reclaim's CloudFormation port.
 *
 * @param client - The CloudFormation client.
 * @returns The port. `deleteStack` sends the stack name and NOTHING else — never a `RoleARN`.
 */
export function createReclaimCloudFormationApi(client: CloudFormationClient): ReclaimCloudFormationApi {
    return {
        async listStacks(): Promise<StackSummary[]> {
            const stacks: StackSummary[] = [];
            let nextToken: string | undefined;

            do {
                const response = await client.send(new DescribeStacksCommand({ NextToken: nextToken }));

                for (const stack of response.Stacks ?? []) {
                    if (stack.StackName !== undefined && stack.StackStatus !== undefined) {
                        stacks.push({
                            name: stack.StackName,
                            status: stack.StackStatus,
                            environmentTag: (stack.Tags ?? []).find((tag) => tag.Key === 'Environment')?.Value,
                        });
                    }
                }

                nextToken = response.NextToken;
            } while (nextToken);

            return stacks;
        },
        async deleteStack(stackName: string): Promise<void> {
            await client.send(new DeleteStackCommand({ StackName: stackName }));
        },
    };
}

/**
 * The reclaim's ECS port.
 *
 * @param client - The ECS client.
 * @returns The port.
 */
export function createReclaimEcsApi(client: ECSClient): ReclaimEcsApi {
    return {
        listClusters: (inScope) => listClusterSummaries(client, inScope),
        async listServices(clusterArn: string): Promise<ReclaimServiceSummary[]> {
            return (await describeAllServices(client, clusterArn)).map((service) => ({
                clusterArn,
                serviceArn: service.serviceArn ?? '',
                serviceName: service.serviceName ?? '',
                status: service.status ?? '',
            }));
        },
        async listTasks(clusterArn: string): Promise<ReclaimTaskSummary[]> {
            // ⚠️ BOTH desired statuses. A task asked to stop is `desiredStatus STOPPED` while it is still running down,
            // and a listing of RUNNING alone would call the cluster quiet while a task is still draining.
            const taskArns = new Set<string>();

            for (const desiredStatus of ['RUNNING', 'STOPPED'] as const) {
                let nextToken: string | undefined;

                do {
                    const response = await client.send(
                        new ListTasksCommand({ cluster: clusterArn, desiredStatus, nextToken }),
                    );

                    for (const arn of response.taskArns ?? []) {
                        taskArns.add(arn);
                    }

                    nextToken = response.nextToken;
                } while (nextToken);
            }

            const all = [...taskArns];
            const tasks: ReclaimTaskSummary[] = [];

            for (let index = 0; index < all.length; index += DESCRIBE_TASKS_BATCH) {
                const response = await client.send(
                    new DescribeTasksCommand({
                        cluster: clusterArn,
                        tasks: all.slice(index, index + DESCRIBE_TASKS_BATCH),
                    }),
                );

                for (const task of response.tasks ?? []) {
                    tasks.push({
                        clusterArn,
                        taskArn: task.taskArn ?? '',
                        desiredStatus: task.desiredStatus ?? '',
                        lastStatus: task.lastStatus ?? '',
                    });
                }
            }

            return tasks;
        },
        async deleteService(clusterArn: string, serviceArn: string): Promise<void> {
            await client.send(new DeleteServiceCommand({ cluster: clusterArn, service: serviceArn, force: true }));
        },
        async stopTask(clusterArn: string, taskArn: string): Promise<void> {
            await client.send(
                new StopTaskCommand({
                    cluster: clusterArn,
                    task: taskArn,
                    reason: 'sandbox midnight reclaim (ADR-0061)',
                }),
            );
        },
    };
}
