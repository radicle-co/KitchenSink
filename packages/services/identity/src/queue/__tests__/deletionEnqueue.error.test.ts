/**
 * The deletion-queue failure type and its ONE announcement path.
 *
 * The behaviour under test is the difference between "somebody could find this in a log" and "somebody is
 * told": a failed enqueue means the database has closed an account that Clerk is still minting JWTs for, so it
 * must page. Both call sites used `logger.warn`, which nothing alerts on.
 *
 * @module
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureException = vi.fn();
const logged: Array<{ level: string; message: string; attributes: unknown }> = [];

vi.mock('@sentry/nestjs', () => ({
    captureException: (...args: unknown[]) => captureException(...args),
    logger: {
        info: (message: string, attributes: unknown) => logged.push({ level: 'info', message, attributes }),
        warn: (message: string, attributes: unknown) => logged.push({ level: 'warn', message, attributes }),
        error: (message: string, attributes: unknown) => logged.push({ level: 'error', message, attributes }),
    },
}));

const { DeletionEnqueueError, isDeletionEnqueueError, reportDeletionEnqueueFailure } =
    await import('../deletionEnqueue.error.js');

describe('DeletionEnqueueError', () => {
    it('is recognised by its guard', () => {
        expect(isDeletionEnqueueError(new DeletionEnqueueError('nope'))).toBe(true);
    });

    it('is not confused with a plain Error', () => {
        expect(isDeletionEnqueueError(new Error('nope'))).toBe(false);
    });

    it('is not confused with a non-error value', () => {
        expect(isDeletionEnqueueError('nope')).toBe(false);
    });

    // `Object.setPrototypeOf` is the reason this holds after transpilation — the repo's custom-error convention.
    it('survives instanceof across the prototype chain', () => {
        const error = new DeletionEnqueueError('nope');

        expect(error).toBeInstanceOf(DeletionEnqueueError);
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('DeletionEnqueueError');
    });

    // The AWS error (an `AccessDenied`, in the case that actually happened) must remain visible.
    it('preserves the underlying cause', () => {
        const cause = new Error('AccessDenied');

        expect(new DeletionEnqueueError('wrapped', { cause }).cause).toBe(cause);
    });
});

describe('reportDeletionEnqueueFailure', () => {
    beforeEach(() => {
        captureException.mockClear();
        logged.length = 0;
    });

    const input = {
        event: 'closure' as const,
        userId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        identityId: 'user_2abcDEF',
        error: new Error('AccessDenied'),
    };

    // ⛔ THE POINT OF THE WHOLE CHANGE: a filterable, paging tag — not a warn.
    it('captures a Sentry exception under a distinct, alertable tag', () => {
        reportDeletionEnqueueFailure(input);

        expect(captureException).toHaveBeenCalledWith(
            input.error,
            expect.objectContaining({
                tags: { 'deletion.enqueue': 'failed', 'deletion.event': 'closure' },
            }),
        );
    });

    it('carries the ids as context so the divergent account can be found', () => {
        reportDeletionEnqueueFailure(input);

        expect(captureException.mock.calls[0]?.[1]).toMatchObject({
            contexts: {
                deletion: { event: 'closure', userId: input.userId, identityId: input.identityId },
            },
        });
    });

    it('logs at ERROR, never warn — a warn is what let this go unnoticed', () => {
        reportDeletionEnqueueFailure(input);

        expect(logged.map((entry) => entry.level)).toEqual(['error']);
    });

    it('names the consequence in the message, not just the mechanism', () => {
        reportDeletionEnqueueFailure(input);

        expect(logged[0]?.message).toContain('not queued');
    });

    it('reports the reactivation direction too, which is the silent lockout case', () => {
        reportDeletionEnqueueFailure({ ...input, event: 'reactivation' });

        expect(captureException.mock.calls[0]?.[1]).toMatchObject({
            tags: { 'deletion.enqueue': 'failed', 'deletion.event': 'reactivation' },
        });
    });
});
