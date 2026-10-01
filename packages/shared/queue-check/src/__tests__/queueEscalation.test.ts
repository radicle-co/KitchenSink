import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EscalationPayload } from '../escalationPayload.js';
import { createQueueEscalation, type EscalationScope } from '../queueEscalation.js';

/**
 * ⛔ THE SDK IS A PORT, so this suite needs no Sentry at all and no module mock.
 *
 * That is the whole reason the three service copies collapsed into one factory: each claimed the SDK was
 * what differed, and `captureMessage`, `withScope` and `captureCheckIn` are measurably the SAME FUNCTION
 * OBJECTS in `@sentry/aws-serverless`, `@sentry/nestjs` and `@sentry/core`. Three copies of this file mocked
 * three module specifiers to exercise one behaviour.
 */
const captureCheckIn = vi.fn();
const captureMessage = vi.fn();
const withScope = vi.fn();

const QUEUE_CHECK_INTERVAL_MINUTES = 5;
const subject = createQueueEscalation(
    { withScope, captureMessage, captureCheckIn },
    { service: 'recipe-workers', intervalMinutes: QUEUE_CHECK_INTERVAL_MINUTES },
);
const { checkInQueueCheck, escalate } = subject;

/** A recorded scope, so the assertions below read what the adapter set rather than that it set something. */
interface RecordedScope {
    fingerprint?: readonly string[];
    level?: string;
    context?: Record<string, unknown>;
    tags?: Record<string, string>;
}

function runWithScope(): RecordedScope {
    const recorded: RecordedScope = {};

    withScope.mockImplementation((callback: (scope: EscalationScope) => void) => {
        callback({
            setFingerprint: (value: readonly string[]) => {
                recorded.fingerprint = value;
            },
            setLevel: (value: string) => {
                recorded.level = value;
            },
            setContext: (_name: string, value: Record<string, unknown>) => {
                recorded.context = value;
            },
            setTags: (value: Record<string, string>) => {
                recorded.tags = value;
            },
        });
    });

    return recorded;
}

function payload(overrides: Partial<EscalationPayload> = {}): EscalationPayload {
    return {
        service: 'recipe-workers',
        stage: 'prod',
        queueName: 'parse-lines',
        condition: 'lost',
        owedCount: 4,
        oldestOwedSeconds: 1800,
        transportVisible: 0,
        transportInFlight: 0,
        transportDeadLettered: 0,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('raising an escalation', () => {
    /**
     * ⛔ THE FINGERPRINT IS EXPLICIT, and without it the backstop is close to useless. Sentry groups by stack
     * trace when nothing else is supplied, and every escalation this module raises comes from the SAME line
     * of the SAME file — so left alone, "the parse queue is lost" and "the archive queue is stuck" would be
     * one issue, and the second would be silently filed as a duplicate of the first.
     */
    it('⛔ fingerprints by the payload, so two different findings are two different issues', () => {
        const first = runWithScope();
        escalate(payload({ queueName: 'parse-lines' }));
        const parse = first.fingerprint;

        const second = runWithScope();
        escalate(payload({ queueName: 'archives', condition: 'stuck' }));

        expect(parse).toBeDefined();
        expect(second.fingerprint).not.toEqual(parse);
    });

    it('grades a delay as a warning and a loss as an error', () => {
        const delayed = runWithScope();
        escalate(payload({ condition: 'delayed' }));

        expect(delayed.level).toBe('warning');

        const lost = runWithScope();
        escalate(payload({ condition: 'lost' }));

        expect(lost.level).toBe('error');
    });

    it('tags the service, stage, queue and condition so an issue can be filtered without opening it', () => {
        const recorded = runWithScope();
        escalate(payload({ stage: 'sandbox', queueName: 'archives', condition: 'exhausted' }));

        expect(recorded.tags).toEqual({
            service: 'recipe-workers',
            stage: 'sandbox',
            queue: 'archives',
            condition: 'exhausted',
        });
    });

    /**
     * ⛔ NOTHING A USER WROTE MAY REACH SENTRY. A Sentry event sits outside every erasure path in this
     * repository, and this backstop reads rows full of recipe lines and ingredient phrases. The payload TYPE
     * has nowhere to put text — but the adapter could still invent some, so what it actually emits is
     * decomposed here rather than trusted.
     */
    it('⛔ emits only numbers and closed-vocabulary identifiers', () => {
        const recorded = runWithScope();
        escalate(payload());

        const emitted = [
            ...Object.values(recorded.context ?? {}),
            ...Object.values(recorded.tags ?? {}),
            ...(captureMessage.mock.calls[0] ?? []),
        ];
        const vocabulary = new Set(['recipe-workers', 'prod', 'parse-lines', 'lost', 'parse-lines: lost', 'error']);

        for (const value of emitted) {
            if (typeof value === 'string') {
                expect(vocabulary.has(value)).toBe(true);
            } else {
                expect(typeof value).toBe('number');
            }
        }
    });
});

describe('the cron check-in', () => {
    it('checks in OK under the stage-specific slug', () => {
        checkInQueueCheck('prod');

        expect(captureCheckIn).toHaveBeenCalledTimes(1);
        expect(captureCheckIn.mock.calls[0]?.[0]).toEqual({
            monitorSlug: 'recipe-workers-queue-check-prod',
            status: 'ok',
        });
    });

    /**
     * ⛔ THE MONITOR IS CREATED BY THE CHECK-IN. A monitor somebody has to remember to create by hand in the
     * Sentry UI is a monitor that does not exist for the first stage nobody remembered — and "the monitor was
     * never set up" is indistinguishable, from the outside, from "the check is running fine".
     */
    it('⛔ upserts the monitor schedule, so nobody has to create it by hand', () => {
        checkInQueueCheck('sandbox');

        expect(captureCheckIn.mock.calls[0]?.[1]).toEqual(
            expect.objectContaining({
                schedule: { type: 'interval', value: QUEUE_CHECK_INTERVAL_MINUTES, unit: 'minute' },
                failureIssueThreshold: 2,
                recoveryThreshold: 1,
            }),
        );
    });

    it('⛔ does not check in from a preview, whose monitor would outlive its stack', () => {
        checkInQueueCheck('pr-91');

        expect(captureCheckIn).not.toHaveBeenCalled();
    });
});
