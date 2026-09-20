/**
 * Lambda adapter for the sandbox nightly-shutdown scheduler (ADR-0007).
 *
 * This is a thin, mechanical adapter: it constructs the AWS SDK v3 clients (RDS/ECS/EC2/SSM — provided
 * by the Node 22 Lambda runtime, so they are marked `external` at bundle time and are NOT package
 * dependencies) and adapts them to the injected client interfaces in `lib/sandbox-scheduler/scheduler`,
 * where ALL the sandbox-only selection + stop/start decision logic lives (and is unit-tested).
 *
 * It is deliberately located under `src/` (outside the infra `tsconfig` `bin`/`lib` include) because
 * it depends on the runtime-provided SDK rather than an installed package; esbuild bundles it via
 * `esbuild.mjs`. The type-checked, tested logic is entirely in the `lib/` module it delegates to.
 *
 * @sideEffect Stops/starts sandbox RDS, ECS services, and the NAT EC2 instance.
 */
import {
    DescribeDBInstancesCommand,
    RDSClient,
    StartDBInstanceCommand,
    StopDBInstanceCommand,
} from '@aws-sdk/client-rds';
import {
    DescribeServicesCommand,
    ECSClient,
    DescribeClustersCommand,
    ListClustersCommand,
    ListServicesCommand,
    UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import { DescribeInstancesCommand, EC2Client, StartInstancesCommand, StopInstancesCommand } from '@aws-sdk/client-ec2';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

import {
    runSchedulerAction,
    type EcsClusterSummary,
    type EcsServiceSummary,
    type Ec2InstanceSummary,
    type RdsInstanceSummary,
    type SchedulerAction,
    type SchedulerClients,
    type SchedulerSummary,
} from '../../lib/sandbox-scheduler/scheduler.js';

const rdsClient = new RDSClient({});
const ecsClient = new ECSClient({});
const ec2Client = new EC2Client({});
const ssmClient = new SSMClient({});

const clients: SchedulerClients = {
    rds: {
        async listInstances(): Promise<RdsInstanceSummary[]> {
            const response = await rdsClient.send(new DescribeDBInstancesCommand({}));

            return (response.DBInstances ?? []).map((instance) => ({
                identifier: instance.DBInstanceIdentifier ?? '',
                status: instance.DBInstanceStatus ?? '',
            }));
        },
        async stopInstance(identifier: string): Promise<void> {
            await rdsClient.send(new StopDBInstanceCommand({ DBInstanceIdentifier: identifier }));
        },
        async startInstance(identifier: string): Promise<void> {
            await rdsClient.send(new StartDBInstanceCommand({ DBInstanceIdentifier: identifier }));
        },
    },
    ecs: {
        async listClusters(): Promise<EcsClusterSummary[]> {
            const arns: string[] = [];
            let nextToken: string | undefined;

            do {
                const response = await ecsClient.send(new ListClustersCommand({ nextToken }));
                arns.push(...(response.clusterArns ?? []));
                nextToken = response.nextToken;
            } while (nextToken);

            const clusters: EcsClusterSummary[] = [];

            // ⚠️ `DescribeClusters` accepts at most 100 clusters per call, and TAGS are opt-in: without
            // `include: ['TAGS']` the response carries none and every per-PR cluster reads as untagged —
            // which is exactly the invisible state this change exists to remove.
            for (let index = 0; index < arns.length; index += 100) {
                const response = await ecsClient.send(
                    new DescribeClustersCommand({ clusters: arns.slice(index, index + 100), include: ['TAGS'] }),
                );

                for (const cluster of response.clusters ?? []) {
                    if (cluster.clusterArn) {
                        clusters.push({
                            arn: cluster.clusterArn,
                            environmentTag: (cluster.tags ?? []).find((tag) => tag.key === 'Environment')?.value,
                        });
                    }
                }
            }

            return clusters;
        },
        async listServices(clusterArn: string): Promise<EcsServiceSummary[]> {
            const serviceArns: string[] = [];
            let nextToken: string | undefined;

            do {
                const response = await ecsClient.send(new ListServicesCommand({ cluster: clusterArn, nextToken }));
                serviceArns.push(...(response.serviceArns ?? []));
                nextToken = response.nextToken;
            } while (nextToken);

            const summaries: EcsServiceSummary[] = [];

            // DescribeServices accepts at most 10 services per call.
            for (let index = 0; index < serviceArns.length; index += 10) {
                const batch = serviceArns.slice(index, index + 10);
                const response = await ecsClient.send(
                    new DescribeServicesCommand({ cluster: clusterArn, services: batch }),
                );

                for (const service of response.services ?? []) {
                    summaries.push({
                        clusterArn,
                        serviceArn: service.serviceArn ?? '',
                        serviceName: service.serviceName ?? '',
                        desiredCount: service.desiredCount ?? 0,
                    });
                }
            }

            return summaries;
        },
        async updateDesiredCount(clusterArn: string, serviceArn: string, desiredCount: number): Promise<void> {
            await ecsClient.send(new UpdateServiceCommand({ cluster: clusterArn, service: serviceArn, desiredCount }));
        },
    },
    ec2: {
        async listInstances(): Promise<Ec2InstanceSummary[]> {
            const summaries: Ec2InstanceSummary[] = [];
            let nextToken: string | undefined;

            do {
                const response = await ec2Client.send(new DescribeInstancesCommand({ NextToken: nextToken }));

                for (const reservation of response.Reservations ?? []) {
                    for (const instance of reservation.Instances ?? []) {
                        const nameTag = (instance.Tags ?? []).find((tag) => tag.Key === 'Name')?.Value;
                        summaries.push({
                            instanceId: instance.InstanceId ?? '',
                            state: instance.State?.Name ?? '',
                            nameTag,
                            sourceDestCheck: instance.SourceDestCheck ?? undefined,
                        });
                    }
                }

                nextToken = response.NextToken;
            } while (nextToken);

            return summaries;
        },
        async stopInstances(instanceIds: string[]): Promise<void> {
            await ec2Client.send(new StopInstancesCommand({ InstanceIds: instanceIds }));
        },
        async startInstances(instanceIds: string[]): Promise<void> {
            await ec2Client.send(new StartInstancesCommand({ InstanceIds: instanceIds }));
        },
    },
    ssm: {
        async getParameter(name: string): Promise<string | undefined> {
            try {
                const response = await ssmClient.send(new GetParameterCommand({ Name: name }));

                return response.Parameter?.Value;
            } catch (error) {
                if (error instanceof Error && error.name === 'ParameterNotFound') {
                    return undefined;
                }

                throw error;
            }
        },
        async putParameter(name: string, value: string): Promise<void> {
            await ssmClient.send(
                new PutParameterCommand({ Name: name, Value: value, Type: 'String', Overwrite: true }),
            );
        },
    },
};

/**
 * Lambda entrypoint. Applies the requested stop/start action to the sandbox tier.
 *
 * @param event - `{ action: 'stop' | 'start' }` supplied by the EventBridge Scheduler target input.
 * @returns The structured run summary (also logged).
 */
export const handler = async (event: { action?: SchedulerAction }): Promise<SchedulerSummary> => {
    // Require an EXPLICIT valid action — never default an unknown/typo'd input to 'stop', which would
    // silently tear the sandbox down on a malformed schedule or manual invocation.
    if (event.action !== 'start' && event.action !== 'stop') {
        throw new Error(`Invalid scheduler action ${JSON.stringify(event.action)} — expected 'start' or 'stop'.`);
    }

    const summary = await runSchedulerAction(event.action, clients);

    console.log(JSON.stringify({ message: 'sandbox-scheduler run complete', ...summary }));

    return summary;
};
