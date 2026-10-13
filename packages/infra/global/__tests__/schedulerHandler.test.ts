// @vitest-environment node
/**
 * The Lambda entrypoint:
 *
 * - announces a failed `stop` to Sentry, ONCE, and nothing else: the sandbox alarm topic has no subscriber, so a stop
 *   that fails without an issue is a failure nobody reads (ADR-0061). A failed `start` or `sync` fails its caller, a
 *   workflow, which is already watching;
 *
 * - parses its event into one of three commands and refuses anything else — above all a `start` with no PR, which
 *   used to mean "start every cluster" (ADR-0060);
 * - fails its invocation when a run records an error, so Lambda's `Errors` metric (and the scheduler's failed-run
 *   alarm) sees a refused start instead of a success (Oct 6–7 2026);
 * - adapts EventBridge to the scheduler's port: only SCHEDULED rules, every page, with their tags.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

import {
    isSchedulerRunFailedError,
    type SchedulerClients,
    type SchedulerSummary,
} from '../lib/sandbox-scheduler/scheduler.js';
import { isInvalidSchedulerRequestError } from '../lib/sandbox-scheduler/invalidSchedulerRequestError.js';

const { runSchedulerAction, announceSilentNoOp, eventBridgeSend, eventBridgeConfigs } = vi.hoisted(() => ({
    runSchedulerAction: vi.fn(),
    announceSilentNoOp: vi.fn(),
    eventBridgeSend: vi.fn(),
    eventBridgeConfigs: [] as unknown[],
}));

vi.mock('../lib/sandbox-scheduler/scheduler.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/sandbox-scheduler/scheduler.js')>()),
    runSchedulerAction,
}));

vi.mock('../src/observability/silentNoOp.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/observability/silentNoOp.js')>()),
    announceSilentNoOp,
}));

vi.mock('@aws-sdk/client-eventbridge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@aws-sdk/client-eventbridge')>();

    return {
        ...actual,
        EventBridgeClient: class {
            public send = eventBridgeSend;

            public constructor(config: unknown) {
                eventBridgeConfigs.push(config);
            }
        },
    };
});

const { handler } = await import('../src/sandbox-scheduler/handler.js');

const summary = (errors: string[], action: SchedulerSummary['action'] = 'start'): SchedulerSummary => ({
    action,
    rds: { acted: [], skipped: [] },
    ecs: { acted: [], skipped: [] },
    nat: { acted: [], skipped: [] },
    rules: { acted: [], skipped: [] },
    reclaim: { acted: [], skipped: [] },
    warnings: [],
    errors,
});

beforeEach(() => {
    runSchedulerAction.mockReset();
    announceSilentNoOp.mockReset();
    announceSilentNoOp.mockResolvedValue(true);
    eventBridgeSend.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

/** The clients the handler handed to the (mocked) scheduler on its last run. */
function clientsOfLastRun(): SchedulerClients {
    const call = runSchedulerAction.mock.calls.at(-1);

    if (call === undefined) {
        throw new Error('the handler never ran the scheduler');
    }

    return call[1] as SchedulerClients;
}

describe('the scheduler handler', () => {
    it('returns the summary of a clean run', async () => {
        runSchedulerAction.mockResolvedValue(summary([]));

        await expect(handler({ action: 'start', stage: 'pr-7' })).resolves.toEqual(summary([]));
    });

    it('hands the PARSED command to the scheduler — the PR travels with the start', async () => {
        runSchedulerAction.mockResolvedValue(summary([]));

        await handler({ action: 'start', stage: 'pr-7' });

        expect(runSchedulerAction.mock.calls[0]?.[0]).toEqual({ action: 'start', stage: 'pr-7' });
    });

    it.each<unknown>([{ action: 'start' }, { action: 'start', stage: 'sandbox' }, { action: 'nightly' }, {}])(
        '⛔ refuses %j without running anything',
        async (event) => {
            let thrown: unknown;

            try {
                await handler(event);
            } catch (error) {
                thrown = error;
            }

            expect(isInvalidSchedulerRequestError(thrown)).toBe(true);
            expect(runSchedulerAction).not.toHaveBeenCalled();
        },
    );

    it('⛔ fails the invocation when the database start was refused', async () => {
        runSchedulerAction.mockResolvedValue(summary(['rds start db: InsufficientDBInstanceCapacity']));
        let thrown: unknown;

        try {
            await handler({ action: 'start', stage: 'pr-7' });
        } catch (error) {
            thrown = error;
        }

        expect(isSchedulerRunFailedError(thrown)).toBe(true);
    });
});

describe('⛔ a failed nightly stop becomes a Sentry issue (ADR-0061)', () => {
    const STOP = { action: 'stop', scheduledTime: '2026-10-13T04:00:00Z' };

    it('announces ONCE, with a fixed sentence and a fingerprint-bearing condition, when the stop recorded an error', async () => {
        runSchedulerAction.mockResolvedValue(summary(['rds stop db: boom'], 'stop'));

        await expect(handler(STOP)).rejects.toSatisfy(isSchedulerRunFailedError);

        expect(announceSilentNoOp).toHaveBeenCalledTimes(1);
        const [noOp, context] = announceSilentNoOp.mock.calls[0] as [Record<string, string>, Record<string, string>];

        expect(noOp).toMatchObject({
            service: 'sandbox-scheduler',
            stage: 'sandbox',
            condition: 'nightly-stop-failed',
        });
        // ⛔ The sentence reaching Sentry is fixed text. The errors travel in the context, which reaches the drain only.
        expect(noOp['detail']).not.toContain('boom');
        expect(JSON.stringify(context)).toContain('boom');
    });

    it('announces and still rethrows when the stop itself CRASHES before it can report a summary', async () => {
        runSchedulerAction.mockRejectedValue(new Error('DescribeDBInstances: throttled'));

        await expect(handler(STOP)).rejects.toThrow('throttled');

        expect(announceSilentNoOp).toHaveBeenCalledTimes(1);
        expect(announceSilentNoOp.mock.calls[0]?.[0]).toMatchObject({ condition: 'nightly-stop-failed' });
    });

    it('does not announce a stop that succeeded', async () => {
        runSchedulerAction.mockResolvedValue(summary([], 'stop'));

        await handler(STOP);

        expect(announceSilentNoOp).not.toHaveBeenCalled();
    });

    it.each<[string, Record<string, unknown>]>([
        ['start', { action: 'start', stage: 'pr-7' }],
        ['sync', { action: 'sync' }],
    ])('does not announce a failed %s: its caller is a workflow that already fails', async (action, event) => {
        runSchedulerAction.mockResolvedValue(summary(['x: failed'], action as 'start' | 'sync'));

        await expect(handler(event)).rejects.toSatisfy(isSchedulerRunFailedError);

        expect(announceSilentNoOp).not.toHaveBeenCalled();
    });

    it('does not announce a start or sync that crashes either', async () => {
        runSchedulerAction.mockRejectedValue(new Error('crash'));

        await expect(handler({ action: 'sync' })).rejects.toThrow('crash');

        expect(announceSilentNoOp).not.toHaveBeenCalled();
    });

    it('a failed announce never changes the outcome: the run still fails with its own error', async () => {
        announceSilentNoOp.mockRejectedValue(new Error('sentry down'));
        runSchedulerAction.mockResolvedValue(summary(['rds stop db: boom'], 'stop'));

        await expect(handler(STOP)).rejects.toSatisfy(isSchedulerRunFailedError);
    });
});

describe('the Step Functions adapter starts the reclaim loop', () => {
    const originalArn = process.env['RECLAIM_STATE_MACHINE_ARN'];

    afterEach(() => {
        if (originalArn === undefined) {
            delete process.env['RECLAIM_STATE_MACHINE_ARN'];
        } else {
            process.env['RECLAIM_STATE_MACHINE_ARN'] = originalArn;
        }
    });

    async function reclaimPort(): Promise<SchedulerClients['reclaim']> {
        runSchedulerAction.mockResolvedValue(summary([], 'stop'));
        await handler({ action: 'stop' });

        return clientsOfLastRun().reclaim;
    }

    it('names the state machine from its environment and starts at iteration 0 under the given name', async () => {
        process.env['RECLAIM_STATE_MACHINE_ARN'] = 'arn:aws:states:us-east-1:123456789012:stateMachine:reclaim';
        const send = vi.spyOn(SFNClient.prototype, 'send').mockResolvedValue({} as never);

        await (await reclaimPort()).startLoop('nightly-2026-10-13T04-00-00Z');

        const command = send.mock.calls[0]?.[0] as StartExecutionCommand;

        expect(command).toBeInstanceOf(StartExecutionCommand);
        expect(command.input).toEqual({
            stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:reclaim',
            name: 'nightly-2026-10-13T04-00-00Z',
            input: JSON.stringify({ iteration: 0 }),
        });
        send.mockRestore();
    });

    it('lets ExecutionAlreadyExists through untouched, for the stop to treat as success', async () => {
        process.env['RECLAIM_STATE_MACHINE_ARN'] = 'arn:aws:states:us-east-1:123456789012:stateMachine:reclaim';
        const already = Object.assign(new Error('exists'), { name: 'ExecutionAlreadyExists' });
        const send = vi.spyOn(SFNClient.prototype, 'send').mockRejectedValue(already);

        await expect((await reclaimPort()).startLoop('nightly-x')).rejects.toBe(already);
        send.mockRestore();
    });

    it('fails loudly, rather than silently skipping, when the state machine is not configured', async () => {
        delete process.env['RECLAIM_STATE_MACHINE_ARN'];

        await expect((await reclaimPort()).startLoop('nightly-x')).rejects.toThrow('RECLAIM_STATE_MACHINE_ARN');
    });
});

describe('the EventBridge adapter', () => {
    /** The command each `send` received, by its constructor name, with its input. */
    function sent(): { readonly command: string; readonly input: Record<string, unknown> }[] {
        return eventBridgeSend.mock.calls.map(([command]) => ({
            command: (command as object).constructor.name,
            input: (command as { input: Record<string, unknown> }).input,
        }));
    }

    async function adapter(): Promise<SchedulerClients['events']> {
        runSchedulerAction.mockResolvedValue({ ...summary([]), action: 'sync' });
        await handler({ action: 'sync' });

        return clientsOfLastRun().events;
    }

    it('lists the kitchensink- rules across EVERY page, keeps only scheduled ones, and reads their tags', async () => {
        eventBridgeSend.mockImplementation(
            async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
                switch (command.constructor.name) {
                    case 'ListRulesCommand':
                        return command.input['NextToken'] === undefined
                            ? {
                                  Rules: [
                                      {
                                          Name: 'kitchensink-q',
                                          Arn: 'arn:aws:events:us-east-1:1:rule/kitchensink-q',
                                          ScheduleExpression: 'rate(15 minutes)',
                                      },
                                      {
                                          Name: 'kitchensink-pattern',
                                          Arn: 'arn:aws:events:us-east-1:1:rule/kitchensink-pattern',
                                          EventPattern: '{}',
                                      },
                                  ],
                                  NextToken: 'page-2',
                              }
                            : {
                                  Rules: [
                                      {
                                          Name: 'kitchensink-sweep-pr-7',
                                          Arn: 'arn:aws:events:us-east-1:1:rule/kitchensink-sweep-pr-7',
                                          ScheduleExpression: 'rate(1 day)',
                                      },
                                  ],
                              };
                    case 'ListTagsForResourceCommand':
                        return String(command.input['ResourceARN']).endsWith('pr-7')
                            ? {
                                  Tags: [
                                      { Key: 'SandboxStage', Value: 'pr-7' },
                                      { Key: 'Environment', Value: 'pr-7-sandbox' },
                                  ],
                              }
                            : { Tags: [{ Key: 'Environment', Value: 'production' }] };
                    default:
                        throw new Error(`unexpected ${command.constructor.name}`);
                }
            },
        );

        const rules = await (await adapter()).listScheduledRules();

        expect(rules).toEqual([
            { name: 'kitchensink-q', stageTag: undefined, environmentTag: 'production' },
            { name: 'kitchensink-sweep-pr-7', stageTag: 'pr-7', environmentTag: 'pr-7-sandbox' },
        ]);
        expect(
            sent()
                .filter((call) => call.command === 'ListRulesCommand')
                .map((call) => call.input),
        ).toEqual([
            { NamePrefix: 'kitchensink-', NextToken: undefined },
            { NamePrefix: 'kitchensink-', NextToken: 'page-2' },
        ]);
        // The event-pattern rule's tags are never even read: it is not the scheduler's.
        expect(sent().filter((call) => call.command === 'ListTagsForResourceCommand')).toHaveLength(2);
    });

    it('⛔ rides out EventBridge throttling instead of failing the deploy that ran the sync', () => {
        // Sandbox Up deploys a dozen stacks at once and each one runs `sync`, which reads one tag set per rule.
        // EventBridge's control plane answered `ThrottlingException: Rate exceeded` (run 38317348271), and the
        // SDK's default three attempts failed the ingredient-parser deploy and skipped the recipe deploys behind it.
        expect(eventBridgeConfigs).toEqual([{ retryMode: 'adaptive', maxAttempts: 10 }]);
    });

    it('enables and disables a rule by NAME, on the default bus', async () => {
        eventBridgeSend.mockResolvedValue({});
        const events = await adapter();

        await events.enableRule('kitchensink-a');
        await events.disableRule('kitchensink-b');

        expect(sent()).toEqual([
            { command: 'EnableRuleCommand', input: { Name: 'kitchensink-a' } },
            { command: 'DisableRuleCommand', input: { Name: 'kitchensink-b' } },
        ]);
    });
});
