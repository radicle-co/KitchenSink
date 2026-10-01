/**
 * THE RULE, enumerated — every level against every client state, so the ruling is a table a reader can
 * check rather than a sentence they must obey.
 *
 * ⛔ WHY IT IS A VALUE AND NOT A COMMENT. This decision existed twice in the tree and the two copies
 * DISAGREED. `recipe-workers/src/common/observability.ts:9-13` ruled "`error` goes to Sentry INSTEAD of
 * stdout; `info` and `warn` stay on stdout, because CloudWatch is the durable record", written with
 * ADR-0042's log drain in hand. `identity/src/observability/sentryLogging.ts` ruled "nothing is written to
 * stdout" — and since `Sentry.logger.*` with no client returns before emitting anything, that second rule
 * DELETES every line on any run without a DSN. This table is the first rule, and the only one.
 */
import { describe, expect, it } from 'vitest';

import { LOG_LEVELS, routeLogRecord } from '../logRouting.js';

describe('routeLogRecord', () => {
    it.each([
        ['error', true, { sentry: true, stdout: false }],
        ['error', false, { sentry: false, stdout: true }],
        ['warn', true, { sentry: false, stdout: true }],
        ['warn', false, { sentry: false, stdout: true }],
        ['info', true, { sentry: false, stdout: true }],
        ['info', false, { sentry: false, stdout: true }],
        ['debug', true, { sentry: false, stdout: true }],
        ['debug', false, { sentry: false, stdout: true }],
    ] as const)('routes %s with client=%s', (level, clientPresent, expected) => {
        expect(routeLogRecord(level, clientPresent)).toEqual(expected);
    });

    it('⛔ NEVER drops a record — every row writes somewhere, which is the property that bit identity', () => {
        for (const level of LOG_LEVELS) {
            for (const clientPresent of [true, false]) {
                const destination = routeLogRecord(level, clientPresent);

                expect(destination.sentry || destination.stdout).toBe(true);
            }
        }
    });

    it('⛔ NEVER writes twice — the ADR-0042 drain would count one failure as two', () => {
        for (const level of LOG_LEVELS) {
            for (const clientPresent of [true, false]) {
                const destination = routeLogRecord(level, clientPresent);

                expect(destination.sentry && destination.stdout).toBe(false);
            }
        }
    });

    /**
     * ⚠️ `error` is the ONLY level that can reach Sentry, and the table above is the flip point: if U23
     * ever alerts on `warn`-level LOGS in a per-service project, this is the one line that changes. Until
     * then it would be volume against an org already shedding 1,680 events to rate limits in 30 days.
     */
    it('diverts only `error`, and only with a client', () => {
        const diverted = LOG_LEVELS.filter((level) => routeLogRecord(level, true).sentry);

        expect(diverted).toEqual(['error']);
        expect(LOG_LEVELS.filter((level) => routeLogRecord(level, false).sentry)).toEqual([]);
    });
});
