// @vitest-environment node
/**
 * The reclaim's Lambda entrypoint and its AWS adapters (ADR-0061).
 *
 * ## The adapters
 *
 * Every factory in `awsAdapters.ts` takes a client instance, so a fake `send` that dispatches on the command class
 * drives the REAL paging and batching code. The facts pinned here are the ones a wrong adapter turns into a silent
 * wrong answer:
 *
 *  - `DescribeStacks`, `ListTasks` and `ListServices` all page; a first page only would call a busy account quiet.
 *  - `ListTasks` is read for BOTH desired statuses. A task asked to stop is `STOPPED` while it still runs down.
 *  - `DescribeTasks` takes at most 100 tasks, `DescribeServices` at most 10, `DescribeClusters` at most 100.
 *  - ⛔ `DeleteStack` carries the stack name and NOTHING else. A `RoleARN` here would make the call need `iam:PassRole`
 *    and would let the caller choose the role; the stack's own saved role does the delete.
 *
 * ## The handler
 *
 * A step that ends with work left announces ONCE, with a fixed sentence. A `report` announces `reclaim-crashed`. A tier
 * that cannot be observed THROWS and does not announce from the step, because the state machine's Catch routes it to
 * `report`, and an announce in both places would be two issues for one night.
 */
import {
    DescribeClustersCommand,
    DescribeServicesCommand,
    DescribeTasksCommand,
    ListClustersCommand,
    ListServicesCommand,
    ListTasksCommand,
    DeleteServiceCommand,
    StopTaskCommand,
    type ECSClient,
} from '@aws-sdk/client-ecs';
import { CloudFormationClient, DeleteStackCommand, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isInvalidReclaimRequestError } from '../lib/sandbox-scheduler/invalidReclaimRequestError.js';
import { ReclaimTierUnobservableError } from '../lib/sandbox-scheduler/reclaimTierUnobservableError.js';
import type { ReclaimStepResult } from '../lib/sandbox-scheduler/reclaim.js';
import { createReclaimCloudFormationApi, createReclaimEcsApi } from '../src/sandbox-scheduler/reclaimAdapters.js';

const { runReclaimStep, announceSilentNoOp } = vi.hoisted(() => ({
    runReclaimStep: vi.fn(),
    announceSilentNoOp: vi.fn(),
}));

vi.mock('../lib/sandbox-scheduler/reclaim.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/sandbox-scheduler/reclaim.js')>()),
    runReclaimStep,
}));

vi.mock('../src/observability/silentNoOp.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/observability/silentNoOp.js')>()),
    announceSilentNoOp,
}));

const { handler } = await import('../src/sandbox-scheduler/reclaimHandler.js');

/** A fake client whose `send` records each command and answers from a function of it. */
function fakeClient<T>(
    answer: (command: { constructor: { name: string }; input: Record<string, unknown> }) => unknown,
) {
    const commands: { name: string; input: Record<string, unknown> }[] = [];
    const client = {
        send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
            commands.push({ name: command.constructor.name, input: command.input });

            return answer(command);
        }),
    };

    return { client: client as unknown as T, commands };
}

describe('the CloudFormation adapter', () => {
    it('lists EVERY page of stacks and reads the Environment tag', async () => {
        const { client, commands } = fakeClient<CloudFormationClient>((command) =>
            command.input['NextToken'] === undefined
                ? {
                      Stacks: [
                          {
                              StackName: 'kitchensink-food-service-pr-1',
                              StackStatus: 'CREATE_COMPLETE',
                              Tags: [{ Key: 'Environment', Value: 'pr-1-sandbox' }],
                          },
                      ],
                      NextToken: 'p2',
                  }
                : { Stacks: [{ StackName: 'armoury-api', StackStatus: 'UPDATE_COMPLETE', Tags: [] }] },
        );

        expect(await createReclaimCloudFormationApi(client).listStacks()).toEqual([
            { name: 'kitchensink-food-service-pr-1', status: 'CREATE_COMPLETE', environmentTag: 'pr-1-sandbox' },
            { name: 'armoury-api', status: 'UPDATE_COMPLETE', environmentTag: undefined },
        ]);
        expect(commands.map((entry) => [entry.name, entry.input['NextToken']])).toEqual([
            [DescribeStacksCommand.name, undefined],
            [DescribeStacksCommand.name, 'p2'],
        ]);
    });

    it('⛔ sends DeleteStack with the stack name and NOTHING else — no RoleARN', async () => {
        const { client, commands } = fakeClient<CloudFormationClient>(() => ({}));

        await createReclaimCloudFormationApi(client).deleteStack('kitchensink-food-service-pr-1');

        expect(commands).toEqual([
            { name: DeleteStackCommand.name, input: { StackName: 'kitchensink-food-service-pr-1' } },
        ]);
        expect(Object.keys(commands[0]?.input ?? {})).toEqual(['StackName']);
    });
});

describe('the ECS adapter', () => {
    const CLUSTER = 'arn:aws:ecs:us-east-1:123456789012:cluster/c';
    const arns = (prefix: string, count: number): string[] =>
        Array.from({ length: count }, (_unused, index) => `${prefix}${index}`);

    it('reads cluster tags (TAGS must be requested) and describes in batches of 100', async () => {
        const { client, commands } = fakeClient<ECSClient>((command) => {
            if (command.constructor.name === ListClustersCommand.name) {
                return command.input['nextToken'] === undefined
                    ? { clusterArns: arns('arn:c', 150), nextToken: 't2' }
                    : { clusterArns: arns('arn:d', 10) };
            }

            return {
                clusters: (command.input['clusters'] as string[]).map((arn) => ({
                    clusterArn: arn,
                    tags: [{ key: 'Environment', value: 'pr-1-sandbox' }],
                })),
            };
        });
        const clusters = await createReclaimEcsApi(client).listClusters();
        const describes = commands.filter((entry) => entry.name === DescribeClustersCommand.name);

        expect(clusters).toHaveLength(160);
        expect(clusters[0]).toEqual({ arn: 'arn:c0', environmentTag: 'pr-1-sandbox' });
        expect(describes.map((entry) => (entry.input['clusters'] as string[]).length)).toEqual([100, 60]);
        expect(describes.every((entry) => (entry.input['include'] as string[]).includes('TAGS'))).toBe(true);
    });

    it('lists services across pages, describes them 10 at a time, and keeps their STATUS', async () => {
        const { client, commands } = fakeClient<ECSClient>((command) => {
            if (command.constructor.name === ListServicesCommand.name) {
                return command.input['nextToken'] === undefined
                    ? { serviceArns: arns('arn:s', 7), nextToken: 't2' }
                    : { serviceArns: arns('arn:t', 7) };
            }

            return {
                services: (command.input['services'] as string[]).map((arn) => ({
                    serviceArn: arn,
                    serviceName: arn,
                    status: 'DRAINING',
                })),
            };
        });
        const services = await createReclaimEcsApi(client).listServices(CLUSTER);
        const describes = commands.filter((entry) => entry.name === DescribeServicesCommand.name);

        expect(services).toHaveLength(14);
        expect(services[0]).toEqual({
            clusterArn: CLUSTER,
            serviceArn: 'arn:s0',
            serviceName: 'arn:s0',
            status: 'DRAINING',
        });
        expect(describes.map((entry) => (entry.input['services'] as string[]).length)).toEqual([10, 4]);
    });

    it('⛔ lists tasks for BOTH desired statuses, across pages, and describes them 100 at a time', async () => {
        const { client, commands } = fakeClient<ECSClient>((command) => {
            if (command.constructor.name === ListTasksCommand.name) {
                const status = command.input['desiredStatus'] as string;

                if (status === 'RUNNING') {
                    return command.input['nextToken'] === undefined
                        ? { taskArns: arns('arn:run', 120), nextToken: 't2' }
                        : { taskArns: arns('arn:run-b', 80) };
                }

                // The same task can appear in both listings while it is running down: it is read once.
                return { taskArns: ['arn:run0', ...arns('arn:stop', 49)] };
            }

            return {
                tasks: (command.input['tasks'] as string[]).map((arn) => ({
                    taskArn: arn,
                    desiredStatus: arn.startsWith('arn:stop') ? 'STOPPED' : 'RUNNING',
                    lastStatus: 'DEPROVISIONING',
                })),
            };
        });
        const tasks = await createReclaimEcsApi(client).listTasks(CLUSTER);
        const lists = commands.filter((entry) => entry.name === ListTasksCommand.name);
        const describes = commands.filter((entry) => entry.name === DescribeTasksCommand.name);

        expect(lists.map((entry) => [entry.input['desiredStatus'], entry.input['nextToken']])).toEqual([
            ['RUNNING', undefined],
            ['RUNNING', 't2'],
            ['STOPPED', undefined],
        ]);
        expect(tasks).toHaveLength(249);
        expect(new Set(tasks.map((task) => task.taskArn)).size).toBe(249);
        expect(tasks.find((task) => task.taskArn === 'arn:stop3')).toEqual({
            clusterArn: CLUSTER,
            taskArn: 'arn:stop3',
            desiredStatus: 'STOPPED',
            lastStatus: 'DEPROVISIONING',
        });
        expect(describes.map((entry) => (entry.input['tasks'] as string[]).length)).toEqual([100, 100, 49]);
    });

    it('describes nothing when there are no tasks', async () => {
        const { client, commands } = fakeClient<ECSClient>(() => ({ taskArns: [] }));

        expect(await createReclaimEcsApi(client).listTasks(CLUSTER)).toEqual([]);
        expect(commands.some((entry) => entry.name === DescribeTasksCommand.name)).toBe(false);
    });

    it('deletes a service with force, and stops a task with a reason', async () => {
        const { client, commands } = fakeClient<ECSClient>(() => ({}));
        const ecs = createReclaimEcsApi(client);

        await ecs.deleteService(CLUSTER, 'arn:svc');
        await ecs.stopTask(CLUSTER, 'arn:task');

        expect(commands[0]).toEqual({
            name: DeleteServiceCommand.name,
            input: { cluster: CLUSTER, service: 'arn:svc', force: true },
        });
        expect(commands[1]?.name).toBe(StopTaskCommand.name);
        expect(commands[1]?.input).toMatchObject({ cluster: CLUSTER, task: 'arn:task' });
    });
});

describe('the reclaim handler', () => {
    const result = (overrides: Partial<ReclaimStepResult>): ReclaimStepResult => ({
        iteration: 3,
        complete: false,
        failed: false,
        standDown: false,
        actions: [],
        pending: [],
        warnings: [],
        errors: [],
        ...overrides,
    });

    beforeEach(() => {
        runReclaimStep.mockReset();
        announceSilentNoOp.mockReset();
        announceSilentNoOp.mockResolvedValue(true);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    it('runs one step with the parsed iteration and bound, and returns the result for the state machine', async () => {
        runReclaimStep.mockResolvedValue(result({ iteration: 4 }));

        await expect(handler({ kind: 'step', iteration: 4, maxIterations: 120 })).resolves.toMatchObject({
            iteration: 4,
        });

        expect(runReclaimStep.mock.calls[0]?.slice(1)).toEqual([4, 120]);
        expect(announceSilentNoOp).not.toHaveBeenCalled();
    });

    it('does not announce a step that is merely still working, or one that finished', async () => {
        runReclaimStep.mockResolvedValueOnce(result({ pending: ['x'] }));
        runReclaimStep.mockResolvedValueOnce(result({ complete: true }));

        await handler({ kind: 'step', iteration: 1, maxIterations: 120 });
        await handler({ kind: 'step', iteration: 2, maxIterations: 120 });

        expect(announceSilentNoOp).not.toHaveBeenCalled();
    });

    it('⛔ announces ONCE, with a fixed sentence, when the loop ends with stacks left behind', async () => {
        runReclaimStep.mockResolvedValue(
            result({
                complete: true,
                failed: true,
                pending: ['kitchensink-food-service-pr-1'],
                errors: ['deleteStack x: denied'],
            }),
        );

        await handler({ kind: 'step', iteration: 119, maxIterations: 120 });

        expect(announceSilentNoOp).toHaveBeenCalledTimes(1);
        const [noOp, context] = announceSilentNoOp.mock.calls[0] as [Record<string, string>, Record<string, string>];

        expect(noOp).toMatchObject({ service: 'sandbox-reclaim', stage: 'sandbox', condition: 'stacks-left-behind' });
        expect(noOp['detail']).not.toContain('kitchensink-food-service-pr-1');
        expect(JSON.stringify(context)).toContain('kitchensink-food-service-pr-1');
    });

    // ADR-0061 review (N1). A stack the reclaim REFUSES (a per-PR name whose tag does not belong to its token, or a
    // shared-tier stack not tagged `sandbox`) is left in place and the run still ends in a clean success. That is a
    // leak nobody hears about, so a run that ENDS with refusals announces it.
    describe('⛔ a run that ends with refused stacks is announced once (stacks-refused)', () => {
        const refusal = 'kitchensink-recipe-service-pr-93: Environment tag "pr-9-sandbox" does not belong to pr-93';

        it('announces ONCE, with a fixed sentence, when the loop ends complete with a refusal', async () => {
            runReclaimStep.mockResolvedValue(result({ complete: true, warnings: [refusal] }));

            await handler({ kind: 'step', iteration: 7, maxIterations: 120 });

            expect(announceSilentNoOp).toHaveBeenCalledTimes(1);
            const [noOp, context] = announceSilentNoOp.mock.calls[0] as [
                Record<string, string>,
                Record<string, string>,
            ];

            expect(noOp).toMatchObject({ service: 'sandbox-reclaim', stage: 'sandbox', condition: 'stacks-refused' });
            expect(noOp['detail']).not.toContain('pr-93');
            expect(JSON.stringify(context)).toContain('pr-93');
        });

        it('does NOT announce while the loop is still working: the warning repeats every minute', async () => {
            runReclaimStep.mockResolvedValue(result({ complete: false, warnings: [refusal], pending: ['x'] }));

            await handler({ kind: 'step', iteration: 3, maxIterations: 120 });

            expect(announceSilentNoOp).not.toHaveBeenCalled();
        });

        it('does not announce a clean finish', async () => {
            runReclaimStep.mockResolvedValue(result({ complete: true }));

            await handler({ kind: 'step', iteration: 7, maxIterations: 120 });

            expect(announceSilentNoOp).not.toHaveBeenCalled();
        });

        it('announces BOTH conditions, once each, when a failed run also carries a refusal', async () => {
            runReclaimStep.mockResolvedValue(
                result({ complete: true, failed: true, warnings: [refusal], pending: ['y'] }),
            );

            await handler({ kind: 'step', iteration: 119, maxIterations: 120 });

            expect(
                announceSilentNoOp.mock.calls.map(([noOp]) => (noOp as { condition: string }).condition).sort(),
            ).toEqual(['stacks-left-behind', 'stacks-refused']);
        });
    });

    it('⛔ a tier it cannot observe THROWS and does not announce here: the Catch routes it to report', async () => {
        runReclaimStep.mockRejectedValue(new ReclaimTierUnobservableError(['database']));

        await expect(handler({ kind: 'step', iteration: 0, maxIterations: 120 })).rejects.toThrow('database');

        expect(announceSilentNoOp).not.toHaveBeenCalled();
    });

    it('⛔ a report announces reclaim-crashed ONCE; the cause reaches the drain and never the envelope', async () => {
        const out = await handler({
            kind: 'report',
            error: { Error: 'ReclaimTierUnobservableError', Cause: '{"errorMessage":"secret-ish stack trace"}' },
        });

        expect(announceSilentNoOp).toHaveBeenCalledTimes(1);
        const [noOp, context] = announceSilentNoOp.mock.calls[0] as [Record<string, string>, Record<string, string>];

        expect(noOp).toMatchObject({ service: 'sandbox-reclaim', stage: 'sandbox', condition: 'reclaim-crashed' });
        expect(JSON.stringify(noOp)).not.toContain('secret-ish');
        expect(JSON.stringify(context)).toContain('secret-ish');
        expect(out).toMatchObject({ reported: true });
        expect(runReclaimStep).not.toHaveBeenCalled();
    });

    it('a report with no error object still announces', async () => {
        await handler({ kind: 'report' });

        expect(announceSilentNoOp).toHaveBeenCalledTimes(1);
    });

    it('a failed announce never changes the outcome of the step', async () => {
        announceSilentNoOp.mockRejectedValue(new Error('sentry down'));
        runReclaimStep.mockResolvedValue(result({ complete: true, failed: true }));

        await expect(handler({ kind: 'step', iteration: 119, maxIterations: 120 })).resolves.toMatchObject({
            failed: true,
        });
    });

    it.each<unknown>([{}, { kind: 'step' }, { kind: 'step', iteration: 5, maxIterations: 5 }, null])(
        '⛔ refuses %j without running anything',
        async (event) => {
            let thrown: unknown;

            try {
                await handler(event);
            } catch (error) {
                thrown = error;
            }

            expect(isInvalidReclaimRequestError(thrown)).toBe(true);
            expect(runReclaimStep).not.toHaveBeenCalled();
        },
    );
});
