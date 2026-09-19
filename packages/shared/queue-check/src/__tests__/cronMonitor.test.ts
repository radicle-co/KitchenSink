import { describe, expect, it } from 'vitest';

import { checksIn, monitorSlug } from '../cronMonitor.js';
import type { EscalationPayload } from '../escalationPayload.js';
import { escalationLevel, escalationTitle } from '../escalationPayload.js';

/**
 * ⛔ THE CHECK-IN IS THE ONLY PART OF A BACKSTOP THAT DETECTS ITS OWN DEATH.
 *
 * Everything else here reports what the check FOUND. A check that stops running finds nothing, reports
 * nothing, and is indistinguishable from a healthy system — which is the failure mode a backstop exists to
 * remove, reintroduced one level up. A cron monitor inverts that: silence becomes the alert.
 */
describe('which stages check in', () => {
    it('⛔ checks in on prod and sandbox — the two stages whose silence means something', () => {
        expect(checksIn('prod')).toBe(true);
        expect(checksIn('sandbox')).toBe(true);
    });

    /**
     * ⛔ A PREVIEW MUST NOT CHECK IN, and this is not a cost decision. A `pr-{N}` stage is torn down when its
     * PR closes (ADR-0005), so a monitor it created would be missing a check-in forever afterwards — a
     * permanently firing alert for a stage that no longer exists, one per PR. The monitor set would fill with
     * dead entries and the live ones would be unreadable among them.
     *
     * ⚠️ A preview still ESCALATES. It is the CHECK-IN that is withheld, not the finding: a preview that
     * discovers stuck work says so, it just does not promise to keep saying it.
     */
    it('⛔ does NOT check in on a preview, which would leave a firing monitor behind at teardown', () => {
        expect(checksIn('pr-91')).toBe(false);
        expect(checksIn('pr-1')).toBe(false);
    });

    it('does not check in from a developer machine or a named non-deployed stage', () => {
        expect(checksIn('local')).toBe(false);
        expect(checksIn('dev')).toBe(false);
        expect(checksIn('test')).toBe(false);
        expect(checksIn('')).toBe(false);
    });
});

describe('the monitor slug', () => {
    /**
     * ⛔ THE STAGE IS IN THE SLUG. One monitor shared by prod and sandbox would be checked in by whichever
     * stage was still healthy, so a dead prod check would be masked by a live sandbox one — the monitor would
     * report green for exactly the outage it was installed to catch.
     */
    it('⛔ separates prod from sandbox, so one stage cannot check in for the other', () => {
        expect(monitorSlug('recipe-workers', 'prod')).not.toBe(monitorSlug('recipe-workers', 'sandbox'));
    });

    it('separates one service from another', () => {
        expect(monitorSlug('recipe-workers', 'prod')).not.toBe(monitorSlug('identity-webhooks', 'prod'));
    });

    /**
     * Sentry derives a monitor's identity from this string, so it is a stable name rather than a display
     * label: it must be lowercase, and it must not change shape when a service name does.
     */
    it('is a stable lowercase slug', () => {
        expect(monitorSlug('recipe-workers', 'prod')).toBe('recipe-workers-queue-check-prod');
        expect(monitorSlug('food-service', 'sandbox')).toBe('food-service-queue-check-sandbox');
    });
});

/** A payload whose every field is a count or an identifier. */
function payload(overrides: Partial<EscalationPayload> = {}): EscalationPayload {
    return {
        service: 'recipe-workers',
        stage: 'prod',
        queueName: 'parse-lines',
        condition: 'lost',
        owedCount: 3,
        oldestOwedSeconds: 900,
        transportVisible: 0,
        transportInFlight: 0,
        transportDeadLettered: 0,
        ...overrides,
    };
}

describe('how an escalation is graded and titled', () => {
    /**
     * ⛔ `delayed` IS THE ONE CONDITION THAT IS NOT A FAULT. "Slow is not lost": work behind a moving queue is
     * late, and paging on late work is how a reader learns to ignore the channel. Every other condition means
     * something has stopped.
     */
    it('⛔ grades a delay as a warning and everything else as an error', () => {
        expect(escalationLevel(payload({ condition: 'delayed' }))).toBe('warning');
        expect(escalationLevel(payload({ condition: 'lost' }))).toBe('error');
        expect(escalationLevel(payload({ condition: 'stuck' }))).toBe('error');
        expect(escalationLevel(payload({ condition: 'exhausted' }))).toBe('error');
        expect(escalationLevel(payload({ condition: 'dead-lettered' }))).toBe('error');
    });

    /**
     * ⛔ THE TITLE IS BUILT FROM TWO CLOSED VOCABULARIES AND NOTHING ELSE. It is the one field of an
     * escalation that a human reads as prose, which makes it the obvious place for somebody to append "the
     * line that failed" — so it is derived here, from the payload, rather than composed at three call sites.
     */
    it('⛔ names only the queue and the condition — no count, no id, no text', () => {
        expect(escalationTitle(payload({ queueName: 'verifications', condition: 'stuck' }))).toBe(
            'verifications: stuck',
        );
    });
});
