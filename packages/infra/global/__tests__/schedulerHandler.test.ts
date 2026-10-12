// @vitest-environment node
/**
 * The Lambda entrypoint:
 *
 * - parses its event into one of three commands and refuses anything else — above all a `start` with no PR, which
 *   used to mean "start every cluster" (ADR-0060);
 * - fails its invocation when a run records an error, so Lambda's `Errors` metric (and the scheduler's failed-run
 *   alarm) sees a refused start instead of a success (Oct 6–7 2026);
 * - adapts EventBridge to the scheduler's port: only SCHEDULED rules, every page, with their tags.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    isSchedulerRunFailedError,
    type SchedulerClients,
    type SchedulerSummary,
} from '../lib/sandbox-scheduler/scheduler.js';
import { isInvalidSchedulerRequestError } from '../lib/sandbox-scheduler/invalidSchedulerRequestError.js';

const { runSchedulerAction, eventBridgeSend } = vi.hoisted(() => ({
    runSchedulerAction: vi.fn(),
    eventBridgeSend: vi.fn(),
}));

vi.mock('../lib/sandbox-scheduler/scheduler.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/sandbox-scheduler/scheduler.js')>()),
    runSchedulerAction,
}));

vi.mock('@aws-sdk/client-eventbridge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@aws-sdk/client-eventbridge')>();

    return {
        ...actual,
        EventBridgeClient: class {
            public send = eventBridgeSend;
        },
    };
});

const { handler } = await import('../src/sandbox-scheduler/handler.js');

const summary = (errors: string[]): SchedulerSummary => ({
    action: 'start',
    rds: { acted: [], skipped: [] },
    ecs: { acted: [], skipped: [] },
    nat: { acted: [], skipped: [] },
    rules: { acted: [], skipped: [] },
    warnings: [],
    errors,
});

beforeEach(() => {
    runSchedulerAction.mockReset();
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
