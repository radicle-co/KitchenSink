/**
 * U11 — the escalation payload and its fingerprint (R28, R31).
 *
 * ⛔ THE PAYLOAD HAS NOWHERE TO PUT TEXT, and that is the design rather than an omission. A backstop reads
 * rows the user wrote: recipe lines, ingredient phrases, display names, food names. Every one of those is
 * content this repository takes care never to copy where erasure cannot reach — and a Sentry event is
 * exactly such a place. So there is no `message`, no `detail`, no `sample`, no open bag. A contributor who
 * wants "just the line that failed" has to change the type, in a diff a reviewer sees.
 */
import { describe, expect, it } from 'vitest';

import { escalationFingerprint } from '../escalationFingerprint.js';
import type { EscalationPayload } from '../escalationPayload.js';

const PAYLOAD: EscalationPayload = {
    service: 'recipe-workers',
    stage: 'prod',
    queueName: 'parse',
    condition: 'lost',
    owedCount: 7,
    oldestOwedSeconds: 900,
    transportVisible: 0,
    transportInFlight: 0,
    transportDeadLettered: 0,
};

describe('EscalationPayload', () => {
    /**
     * ⚠️ THE COMPILE-TIME HALF LIVES IN `src/`, NOT HERE, and that is a correction rather than a preference:
     * this package's `tsconfig.json` includes `src/**` only, so a `@ts-expect-error` written in this file is
     * never evaluated by `npm run typecheck` — it would have read as a guarantee while proving nothing.
     * `escalationPayload.ts` carries a `WithoutIndexSignature` assertion instead, which tsc does check, and
     * which is honest about its own limit: it catches an index-signature escape hatch, and no type can tell
     * a named `sourceLine: string` from `queueName: string`. That one is caught by review, which is why this
     * is a closed interface rather than an open bag — a named field is a diff someone sees.
     *
     * What remains testable at RUNTIME is the shape of a real payload, which is what this asserts.
     */
    it('carries only counts and identifiers — no object, array or nested bag', () => {
        for (const [field, value] of Object.entries(PAYLOAD)) {
            expect(['string', 'number'], field).toContain(typeof value);
        }
    });
});

describe('escalationFingerprint', () => {
    /**
     * ⛔ Sentry groups by stack trace when nothing else is supplied, and EVERY escalation this backstop
     * raises comes from the same line of the same file — so left alone, "the parse queue is stuck in prod"
     * and "identity owes forty closures in sandbox" would be one issue, and the second would be hidden as a
     * duplicate of the first.
     */
    it('⛔ is STABLE for the same condition across runs', () => {
        const later: EscalationPayload = { ...PAYLOAD, owedCount: 41, oldestOwedSeconds: 4_000 };

        expect(escalationFingerprint(later)).toEqual(escalationFingerprint(PAYLOAD));
    });

    it('⛔ DIFFERS per queue, per stage, per service and per condition', () => {
        const base = escalationFingerprint(PAYLOAD);

        expect(escalationFingerprint({ ...PAYLOAD, queueName: 'verification' })).not.toEqual(base);
        expect(escalationFingerprint({ ...PAYLOAD, stage: 'sandbox' })).not.toEqual(base);
        expect(escalationFingerprint({ ...PAYLOAD, service: 'identity-webhooks' })).not.toEqual(base);
        expect(escalationFingerprint({ ...PAYLOAD, condition: 'delayed' })).not.toEqual(base);
    });

    /**
     * ⚠️ It excludes every MEASURE deliberately. A check that ran twice ten minutes apart sees different
     * counts; folding those in would open a NEW issue on every run — the same unusable outcome as grouping
     * everything together, reached from the other side.
     */
    it('excludes the measures, so a changing backlog does not open a new issue each run', () => {
        // ⚠️ Asserted as "no measure appears", not as "no digit appears" — a digit check passes by accident
        // on this payload (`prod` has none) and would start failing on a `pr-91` stage, which SHOULD be in
        // the fingerprint. The question is which FIELDS reached it.
        const rendered = escalationFingerprint({ ...PAYLOAD, owedCount: 12_345, oldestOwedSeconds: 67_890 }).join('|');

        expect(rendered).not.toContain('12345');
        expect(rendered).not.toContain('67890');
    });
});
