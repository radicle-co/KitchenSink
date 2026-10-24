// @vitest-environment node
/**
 * Integration: the midnight reclaim, end to end, against a stateful fake account (ADR-0061).
 *
 * The REAL `reclaimHandler`, the REAL adapters and the REAL planner run; the only fake is the AWS SDK's `send`,
 * intercepted on each client class's prototype. The fake is a small WORLD, not a list of canned answers: a service
 * that was deleted drains, then disappears; a task asked to stop runs down, then stops; a stack that was deleted
 * goes `DELETE_IN_PROGRESS`, then disappears — unless something still imports it. The loop is driven the way the
 * state machine drives it, one iteration at a time with the world advancing between calls, until the handler says
 * it is complete.
 *
 * ## What this proves that the unit tests cannot
 *
 * The planner is pure and its unit table is exhaustive, but three things only show up when the pieces run together
 * across iterations:
 *
 *  - **order over time**: `DeleteService` and `StopTask` reach a stage's stacks BEFORE any `DeleteStack` for that
 *    stage, and the shared tier goes identity service, then schema, then ALB (the ALB is wedged on an export in use
 *    otherwise, and the fake models that);
 *  - **the IAM boundary matches the plan**: the fake REFUSES a `DeleteStack` the reclaim role could not make
 *    (a name outside `kitchensink-*-pr-*` or the allowlist, a tag outside the grant, any `RoleARN`), so a planner
 *    that drifts from `SandboxSchedulerStack`'s grant fails here instead of looping `AccessDenied` for two hours;
 *  - **what is left untouched**: the database, the network, the webhooks, the scheduler, production and another
 *    application's stacks come out of a full night exactly as they went in.
 */
import { CloudFormationClient, DeleteStackCommand, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { DescribeInstancesCommand, EC2Client } from '@aws-sdk/client-ec2';
import {
    DeleteServiceCommand,
    DescribeClustersCommand,
    DescribeServicesCommand,
    DescribeTasksCommand,
    ECSClient,
    ListClustersCommand,
    ListServicesCommand,
    ListTasksCommand,
    StopTaskCommand,
} from '@aws-sdk/client-ecs';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    PER_PR_STACK_NAME,
    SHARED_TIER_DELETE_ORDER,
    environmentTagBelongs,
    type ReclaimStepResult,
} from '../lib/sandbox-scheduler/reclaim.js';

const { announceSilentNoOp } = vi.hoisted(() => ({ announceSilentNoOp: vi.fn() }));

vi.mock('../src/observability/silentNoOp.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/observability/silentNoOp.js')>()),
    announceSilentNoOp,
}));

const { handler } = await import('../src/sandbox-scheduler/reclaimHandler.js');

const ACCOUNT = '123456789012';
const clusterArn = (name: string): string => `arn:aws:ecs:us-east-1:${ACCOUNT}:cluster/${name}`;

interface FakeStack {
    name: string;
    status: string;
    tag: string | undefined;
    /** Stacks that import this stack's exports: CloudFormation refuses to delete it while any is still there. */
    importedBy: readonly string[];
}
interface FakeService {
    arn: string;
    cluster: string;
    status: 'ACTIVE' | 'DRAINING' | 'INACTIVE';
}
interface FakeTask {
    arn: string;
    cluster: string;
    desired: 'RUNNING' | 'STOPPED';
    last: string;
}

/** The fake account. Everything the handler can see or change lives here. */
class World {
    public rdsStatus = 'stopped';
    public natState = 'stopped';
    public readonly stacks = new Map<string, FakeStack>();
    public readonly clusters = new Map<string, string | undefined>();
    public readonly services: FakeService[] = [];
    public readonly tasks: FakeTask[] = [];
    /** Every mutating call, in order. */
    public readonly log: string[] = [];
    /** Names DeleteStack was refused for (IAM), so a scenario can force a persistent refusal. */
    public denyDeleteOf: ReadonlySet<string> = new Set();
    public violations: string[] = [];

    public addStack(name: string, tag?: string, importedBy: readonly string[] = []): void {
        const token = /(pr-[0-9]+)$/u.exec(name)?.[1];

        this.stacks.set(name, {
            name,
            status: 'CREATE_COMPLETE',
            tag: tag ?? (token === undefined ? 'sandbox' : `${token}-sandbox`),
            importedBy,
        });
    }

    public addPreview(token: string, apps: readonly string[]): void {
        const cluster = clusterArn(`kitchensink-food-service-${token}-Cluster`);

        for (const app of apps) {
            this.addStack(`kitchensink-${app}-${token}`, undefined, []);
        }

        this.clusters.set(cluster, `${token}-sandbox`);
        this.services.push({ arn: `${cluster}/api`, cluster, status: 'ACTIVE' });
        this.tasks.push({ arn: `arn:task/${token}/1`, cluster, desired: 'RUNNING', last: 'RUNNING' });
    }

    /** The IAM grant the reclaim role holds, restated from the plan, as an executable predicate. */
    private mayDelete(name: string, tag: string | undefined): boolean {
        if (tag === 'production') {
            return false;
        }

        const token = PER_PR_STACK_NAME.exec(name)?.[1];

        if (token !== undefined && tag !== undefined && /^pr-/u.test(tag)) {
            return true;
        }

        return (SHARED_TIER_DELETE_ORDER as readonly string[]).includes(name) && tag === 'sandbox';
    }

    /** Advance time by one minute: what was draining finishes, what was deleting is gone. */
    public tick(): void {
        for (const service of this.services) {
            if (service.status === 'DRAINING') {
                service.status = 'INACTIVE';
            }
        }

        for (const task of this.tasks) {
            if (task.desired === 'STOPPED') {
                task.last = 'STOPPED';
            }
        }

        for (const stack of [...this.stacks.values()]) {
            if (stack.status !== 'DELETE_IN_PROGRESS') {
                continue;
            }

            const stillImporting = stack.importedBy.some((importer) => this.stacks.has(importer));

            if (stillImporting) {
                stack.status = 'DELETE_FAILED';
                this.log.push(`failed:${stack.name}:export in use`);
            } else {
                this.stacks.delete(stack.name);
                this.log.push(`gone:${stack.name}`);
            }
        }
    }

    /** Answer one SDK command, as the service would. */
    public answer(command: { constructor: { name: string }; input: Record<string, unknown> }): unknown {
        const { input } = command;

        switch (command.constructor.name) {
            case DescribeDBInstancesCommand.name:
                return {
                    DBInstances: [
                        { DBInstanceIdentifier: 'kitchensink-data-sandbox', DBInstanceStatus: this.rdsStatus },
                        { DBInstanceIdentifier: 'kitchensink-data-prod', DBInstanceStatus: 'available' },
                    ],
                };
            case DescribeInstancesCommand.name:
                return {
                    Reservations: [
                        {
                            Instances: [
                                {
                                    InstanceId: 'i-sbx',
                                    State: { Name: this.natState },
                                    SourceDestCheck: false,
                                    Tags: [
                                        {
                                            Key: 'Name',
                                            Value: 'Global-sandbox/Network-sandbox/Vpc/publicSubnet1/NatInstance',
                                        },
                                        { Key: 'aws:cloudformation:stack-name', Value: 'kitchensink-network-sandbox' },
                                    ],
                                },
                                {
                                    InstanceId: 'i-prod',
                                    State: { Name: 'running' },
                                    SourceDestCheck: false,
                                    Tags: [
                                        {
                                            Key: 'Name',
                                            Value: 'Global-prod/Network-prod/Vpc/publicSubnet1/NatInstance',
                                        },
                                        { Key: 'aws:cloudformation:stack-name', Value: 'kitchensink-network-prod' },
                                    ],
                                },
                            ],
                        },
                    ],
                };
            case DescribeStacksCommand.name:
                return {
                    Stacks: [...this.stacks.values()].map((stack) => ({
                        StackName: stack.name,
                        StackStatus: stack.status,
                        Tags: stack.tag === undefined ? [] : [{ Key: 'Environment', Value: stack.tag }],
                    })),
                };
            case ListClustersCommand.name:
                return { clusterArns: [...this.clusters.keys()] };
            case DescribeClustersCommand.name:
                // The permissions boundary (ADR-0065) refuses a per-resource call on a production name, and allows only
                // `kitchensink-*`: a describe that names anything else is a violation and fails the whole call.
                for (const arn of input['clusters'] as string[]) {
                    const name = arn.split('/').pop() ?? '';

                    if (!name.startsWith('kitchensink-') || name.includes('-prod')) {
                        this.violations.push(`DescribeClusters reached the out-of-scope cluster ${arn}`);
                        throw Object.assign(new Error(`AccessDenied: ecs:DescribeClusters on ${arn}`), {
                            name: 'AccessDenied',
                        });
                    }
                }

                return {
                    clusters: (input['clusters'] as string[]).map((arn) => {
                        const tag = this.clusters.get(arn);

                        return { clusterArn: arn, tags: tag === undefined ? [] : [{ key: 'Environment', value: tag }] };
                    }),
                };
            case ListServicesCommand.name:
                return {
                    serviceArns: this.services
                        .filter((service) => service.cluster === input['cluster'] && service.status !== 'INACTIVE')
                        .map((service) => service.arn),
                };
            case DescribeServicesCommand.name:
                return {
                    services: this.services
                        .filter((service) => (input['services'] as string[]).includes(service.arn))
                        .map((service) => ({
                            serviceArn: service.arn,
                            serviceName: service.arn,
                            status: service.status,
                        })),
                };
            case ListTasksCommand.name:
                return {
                    taskArns: this.tasks
                        .filter((task) => task.cluster === input['cluster'] && task.desired === input['desiredStatus'])
                        .map((task) => task.arn),
                };
            case DescribeTasksCommand.name:
                return {
                    tasks: this.tasks
                        .filter((task) => (input['tasks'] as string[]).includes(task.arn))
                        .map((task) => ({ taskArn: task.arn, desiredStatus: task.desired, lastStatus: task.last })),
                };

            case DeleteServiceCommand.name: {
                const service = this.services.find((candidate) => candidate.arn === input['service']);

                if (service === undefined || input['force'] !== true) {
                    throw new Error('InvalidParameterException');
                }

                this.refuseForeignCluster(service.cluster, 'DeleteService');

                service.status = 'DRAINING';

                for (const task of this.tasks.filter((candidate) => candidate.cluster === service.cluster)) {
                    task.desired = 'STOPPED';
                }

                this.log.push(`deleteService:${service.cluster}`);

                return {};
            }

            case StopTaskCommand.name: {
                const task = this.tasks.find((candidate) => candidate.arn === input['task']);

                if (task === undefined) {
                    throw new Error('InvalidParameterException');
                }

                this.refuseForeignCluster(task.cluster, 'StopTask');

                task.desired = 'STOPPED';
                this.log.push(`stopTask:${task.cluster}`);

                return {};
            }

            case DeleteStackCommand.name:
                return this.deleteStack(input);
            default:
                throw new Error(`the fake account does not implement ${command.constructor.name}`);
        }
    }

    /**
     * The reclaim role's ECS grant, restated: only a `kitchensink-…` cluster. The account also hosts another application
     * (ADR-0061 review), and `DeleteService` is irreversible.
     */
    private refuseForeignCluster(cluster: string, action: string): void {
        if (!(cluster.split('/').pop() ?? '').startsWith('kitchensink-')) {
            this.violations.push(`${action} reached the foreign cluster ${cluster}`);
            throw Object.assign(new Error(`AccessDenied: ${action} ${cluster}`), { name: 'AccessDenied' });
        }
    }

    public addForeignApplication(): void {
        const cluster = clusterArn('armoury-api-pr-92-Cluster-X');

        this.clusters.set(cluster, 'pr-92-sandbox');
        this.services.push({ arn: `${cluster}/api`, cluster, status: 'ACTIVE' });
        this.tasks.push({ arn: 'arn:task/armoury/1', cluster, desired: 'RUNNING', last: 'RUNNING' });
        this.addStack('armoury-api-pr-92', 'pr-92-sandbox');
    }

    private deleteStack(input: Record<string, unknown>): unknown {
        const name = String(input['StackName']);
        const stack = this.stacks.get(name);

        if (Object.keys(input).some((key) => key !== 'StackName')) {
            this.violations.push(`DeleteStack ${name} carried ${Object.keys(input).join(',')}`);
            throw Object.assign(new Error('AccessDenied: RoleArn is not permitted'), { name: 'AccessDenied' });
        }

        if (stack === undefined) {
            return {};
        }

        if (this.denyDeleteOf.has(name) || !this.mayDelete(name, stack.tag)) {
            this.violations.push(`DeleteStack ${name} (${stack.tag ?? 'no tag'}) is outside the reclaim role's grant`);
            throw Object.assign(new Error(`AccessDenied: ${name}`), { name: 'AccessDenied' });
        }

        // CloudFormation would have to drain a cluster that still has work in it, and the plan forbids asking it to.
        const token = PER_PR_STACK_NAME.exec(name)?.[1];

        for (const [arn, tag] of this.clusters) {
            // CloudFormation drains only the cluster THIS stack owns, never another application's.
            if (
                token !== undefined &&
                tag !== undefined &&
                environmentTagBelongs(token, tag) &&
                (arn.split('/').pop() ?? '').startsWith('kitchensink-')
            ) {
                const busy =
                    this.services.some((service) => service.cluster === arn && service.status !== 'INACTIVE') ||
                    this.tasks.some((task) => task.cluster === arn && task.last !== 'STOPPED');

                if (busy) {
                    this.violations.push(`DeleteStack ${name} was sent while ${arn} still had services or tasks`);
                }
            }
        }

        if (
            stack.status === 'DELETE_FAILED' ||
            stack.status === 'CREATE_COMPLETE' ||
            stack.status === 'UPDATE_COMPLETE'
        ) {
            stack.status = 'DELETE_IN_PROGRESS';
            this.log.push(`deleteStack:${name}`);
        }

        return {};
    }
}

let world: World;

/** The standard night: two previews, the shared tier, the persistent tier, production, and another application. */
function aStandardNight(): World {
    const w = new World();
    const [IDENTITY, SCHEMA, ALB] = SHARED_TIER_DELETE_ORDER;

    w.addPreview('pr-91', [
        'food-service',
        'food-schema',
        'recipe-service',
        'recipe-schema',
        'recipe-workers',
        'ingredient-parser',
        'remote-search',
    ]);
    w.addPreview('pr-92', ['food-service', 'recipe-service']);
    // The ALB's exports are imported by the identity service and by every preview's service stack.
    w.addStack(IDENTITY);
    w.addStack(SCHEMA);
    w.addStack(ALB, 'sandbox', [IDENTITY, 'kitchensink-food-service-pr-91', 'kitchensink-food-service-pr-92']);

    for (const persistent of ['data', 'network', 'identity-webhooks', 'sandbox-scheduler', 'service-logs', 'domain']) {
        w.addStack(`kitchensink-${persistent}-sandbox`);
    }

    w.addStack('kitchensink-data-prod', 'production');
    w.addStack('kitchensink-food-service-prod', 'production');
    w.addStack('armoury-api-production', undefined);
    // A production cluster the account lists and the boundary would refuse to describe.
    w.clusters.set(clusterArn('kitchensink-food-service-prod-FoodServiceCluster-X'), 'production');
    // Another application's `-pr-` cluster and stack, tagged exactly like ours: nothing about it may be touched.
    w.addForeignApplication();

    return w;
}

beforeEach(() => {
    world = aStandardNight();
    announceSilentNoOp.mockReset();
    announceSilentNoOp.mockResolvedValue(true);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const client of [RDSClient, EC2Client, ECSClient, CloudFormationClient]) {
        vi.spyOn(
            client.prototype as { send: unknown } as { send: (c: never) => Promise<unknown> },
            'send',
        ).mockImplementation(async (command: never) => world.answer(command));
    }
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Drive the loop the way the state machine does, until the handler says complete. */
async function drive(maxIterations = 120): Promise<{ results: ReclaimStepResult[]; last: ReclaimStepResult }> {
    const results: ReclaimStepResult[] = [];

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const result = (await handler({ kind: 'step', iteration, maxIterations })) as ReclaimStepResult;

        results.push(result);
        world.tick();

        if (result.complete) {
            return { results, last: result };
        }
    }

    throw new Error('the loop never completed within its bound');
}

const PERSISTENT = [
    'kitchensink-data-sandbox',
    'kitchensink-network-sandbox',
    'kitchensink-identity-webhooks-sandbox',
    'kitchensink-sandbox-scheduler-sandbox',
    'kitchensink-service-logs-sandbox',
    'kitchensink-domain-sandbox',
    'kitchensink-data-prod',
    'kitchensink-food-service-prod',
    'armoury-api-production',
    'armoury-api-pr-92',
];

describe('a full night: the stop has run, and the loop is driven to completion', () => {
    it('deletes every per-PR stack and the shared tier, and touches nothing else', async () => {
        const { last, results } = await drive();

        expect(last).toMatchObject({ complete: true, failed: false, standDown: false });
        expect([...world.stacks.keys()].sort()).toEqual([...PERSISTENT].sort());
        expect(world.violations).toEqual([]);
        expect(world.services.find((service) => service.cluster.includes('armoury'))?.status).toBe('ACTIVE');
        expect(world.tasks.find((task) => task.cluster.includes('armoury'))?.desired).toBe('RUNNING');
        expect(world.log.some((entry) => entry.includes('armoury'))).toBe(false);
        expect(results.length).toBeGreaterThan(3);
        expect(announceSilentNoOp).not.toHaveBeenCalled();
    });

    it('⛔ quiesces ECS before a stage`s stacks, per stage', async () => {
        await drive();

        for (const token of ['pr-91', 'pr-92']) {
            const cluster = `kitchensink-food-service-${token}-Cluster`;
            const quiesce = world.log.findLastIndex(
                (entry) => entry.startsWith('deleteService:') && entry.includes(cluster),
            );
            const firstDelete = world.log.findIndex(
                (entry) => entry.startsWith('deleteStack:') && entry.endsWith(token),
            );

            expect(quiesce).toBeGreaterThanOrEqual(0);
            expect(firstDelete).toBeGreaterThan(quiesce);
        }
    });

    it('⛔ takes the shared tier last, one stack at a time, in the mirror order, and never wedges the ALB', async () => {
        await drive();

        const [IDENTITY, SCHEMA, ALB] = SHARED_TIER_DELETE_ORDER;
        const at = (entry: string): number => world.log.indexOf(entry);
        const lastPreview = Math.max(
            ...world.log.map((entry, index) => (/^gone:.*-pr-\d+$/u.test(entry) ? index : -1)),
        );

        expect(at(`deleteStack:${IDENTITY}`)).toBeGreaterThan(lastPreview);
        expect(at(`gone:${IDENTITY}`)).toBeLessThan(at(`deleteStack:${SCHEMA}`));
        expect(at(`gone:${SCHEMA}`)).toBeLessThan(at(`deleteStack:${ALB}`));
        expect(world.log.some((entry) => entry.startsWith('failed:'))).toBe(false);
    });

    it('is idempotent: a second night against the emptied tier does nothing and succeeds', async () => {
        await drive();

        const { last } = await drive();

        expect(last).toMatchObject({ complete: true, failed: false, actions: [] });
    });
});

describe('the tier is still in use', () => {
    it('⛔ stands down and deletes nothing when the database is running again (someone pressed Sandbox Up)', async () => {
        world.rdsStatus = 'available';

        const { last } = await drive();

        expect(last).toMatchObject({ complete: true, failed: false, standDown: true, actions: [] });
        expect(world.log).toEqual([]);
        expect(world.stacks.size).toBeGreaterThan(PERSISTENT.length);
    });

    it('stands down when the NAT is running', async () => {
        world.natState = 'running';

        expect((await drive()).last).toMatchObject({ standDown: true, actions: [] });
    });

    it('waits for a stage whose stack is still being deployed, then deletes it', async () => {
        const busy = world.stacks.get('kitchensink-food-service-pr-92');

        if (busy === undefined) {
            throw new Error('fixture');
        }

        busy.status = 'UPDATE_IN_PROGRESS';
        const first = (await handler({ kind: 'step', iteration: 0, maxIterations: 120 })) as ReclaimStepResult;

        expect(first.pending).toContain('kitchensink-food-service-pr-92');
        expect(world.log.some((entry) => entry.includes('pr-92'))).toBe(false);

        busy.status = 'UPDATE_COMPLETE';
        await drive();

        expect(world.stacks.has('kitchensink-food-service-pr-92')).toBe(false);
    });

    it('leaves a per-PR name with the wrong tag for its PR-close teardown, warns, and keeps the shared tier', async () => {
        world.addStack('kitchensink-recipe-service-pr-93', 'pr-9-sandbox');

        const { last } = await drive();

        expect(last).toMatchObject({ complete: true, failed: false });
        expect(last.warnings.join(' ')).toContain('pr-93');
        // ADR-0061 review (N1): a refusal ends in a clean success, so it is announced, once, when the run ends.
        expect(announceSilentNoOp).toHaveBeenCalledTimes(1);
        expect(announceSilentNoOp.mock.calls[0]?.[0]).toMatchObject({
            service: 'sandbox-reclaim',
            condition: 'stacks-refused',
        });
        expect(world.stacks.has('kitchensink-recipe-service-pr-93')).toBe(true);

        for (const shared of SHARED_TIER_DELETE_ORDER) {
            expect(world.stacks.has(shared)).toBe(true);
        }

        expect(world.stacks.has('kitchensink-food-service-pr-91')).toBe(false);
    });
});

describe('when it cannot finish', () => {
    it('⛔ re-issues a stack whose delete failed, fails the night while it stays wedged, and recovers', async () => {
        // The ALB is wedged on an export in use: model an importer the plan does not know about.
        const alb = world.stacks.get(SHARED_TIER_DELETE_ORDER[2]) as FakeStack;
        const stray = 'kitchensink-stray-importer';

        world.addStack(stray);
        world.stacks.set(SHARED_TIER_DELETE_ORDER[2], { ...alb, importedBy: [stray] });

        const wedged = await drive(14);

        expect(wedged.last).toMatchObject({ complete: true, failed: true });
        expect(world.log.filter((entry) => entry.startsWith('failed:')).length).toBeGreaterThan(1);
        expect(announceSilentNoOp).toHaveBeenCalledTimes(1);

        world.stacks.delete(stray);
        announceSilentNoOp.mockClear();

        const { last } = await drive();

        expect(last).toMatchObject({ complete: true, failed: false });
        expect(world.stacks.has(SHARED_TIER_DELETE_ORDER[2])).toBe(false);
        expect(announceSilentNoOp).not.toHaveBeenCalled();
    });

    it('⛔ a delete that is refused every minute ends FAILED on the last iteration, and announces exactly once', async () => {
        world.denyDeleteOf = new Set(['kitchensink-recipe-service-pr-92']);

        const { last, results } = await drive(6);

        expect(results).toHaveLength(6);
        expect(last).toMatchObject({ complete: true, failed: true });
        expect(last.errors.join(' ')).toContain('pr-92');
        expect(announceSilentNoOp).toHaveBeenCalledTimes(1);
        expect(announceSilentNoOp.mock.calls[0]?.[0]).toMatchObject({
            service: 'sandbox-reclaim',
            condition: 'stacks-left-behind',
        });
        expect(results.slice(0, -1).every((result) => !result.failed)).toBe(true);
    });

    it('⛔ a tier it cannot see THROWS at the first iteration, for the state machine to route to report', async () => {
        world.rdsStatus = 'stopped';
        vi.spyOn(
            RDSClient.prototype as { send: unknown } as { send: (c: never) => Promise<unknown> },
            'send',
        ).mockResolvedValue({
            DBInstances: [],
        });

        await expect(handler({ kind: 'step', iteration: 0, maxIterations: 120 })).rejects.toThrow('database');
        expect(world.log).toEqual([]);
        expect(announceSilentNoOp).not.toHaveBeenCalled();
    });
});
