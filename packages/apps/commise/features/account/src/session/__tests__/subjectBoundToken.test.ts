/**
 * Unit tests for the token proxy that binds a service client to the cook it was built for (ADR-0054).
 *
 * The property under test: a request is minted only for the cook who made it. A client survives a change of cook (a
 * query retry, an outbox drain or a mutation already in flight still holds it), and the token is read at send time, so
 * without the proxy cook A's work is sent with cook B's token. The proxy reads the identity client's LIVE session, both
 * before the mint and after it, and refuses with a `SessionSubjectChangedError` whenever that session is not the cook's.
 *
 * Each case drives the session through a mutable stand-in for `useClerk()`, and the mint is a spy, so a case can move
 * the session WHILE a token is being minted, which is the interleaving a check made only before the mint cannot see.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    isSessionSubjectChangedError,
    isTokenMintFailedError,
    SessionSubjectChangedError,
    subjectBoundToken,
    TokenMintFailedError,
    type SessionSubjectSource,
} from '../subjectBoundToken.js';

/** A mutable identity client whose live session belongs to `userId`, or to nobody. */
function identity(userId: string | null | undefined): { session: SessionSubjectSource['session'] } {
    return { session: userId === undefined ? undefined : userId === null ? null : { user: { id: userId } } };
}

describe('subjectBoundToken — a client built for a cook', () => {
    it('mints for that cook while their session is live, passing forceRefresh through', async () => {
        const mint = vi.fn(async () => 'tok-A');
        const token = subjectBoundToken('user_A', identity('user_A'), mint);

        await expect(token(true)).resolves.toBe('tok-A');
        expect(mint).toHaveBeenCalledWith(true);
    });

    it('refuses, and mints nothing, when the live session is another cook’s', async () => {
        const mint = vi.fn(async () => 'tok-B');
        const token = subjectBoundToken('user_A', identity('user_B'), mint);

        await expect(token(false)).rejects.toBeInstanceOf(SessionSubjectChangedError);
        expect(mint).not.toHaveBeenCalled();
    });

    it('refuses a token minted while the session moved to another cook', async () => {
        const client = identity('user_A');
        const mint = vi.fn(async () => {
            client.session = { user: { id: 'user_B' } };

            return 'tok-B';
        });

        await expect(subjectBoundToken('user_A', client, mint)(false)).rejects.toBeInstanceOf(
            SessionSubjectChangedError,
        );
    });

    it('refuses once the cook’s session has ended', async () => {
        const client = identity('user_A');
        const mint = vi.fn(async () => {
            client.session = null;

            return 'tok-A';
        });

        await expect(subjectBoundToken('user_A', client, mint)(false)).rejects.toBeInstanceOf(
            SessionSubjectChangedError,
        );
    });

    // Web: the SSR state names the cook before clerk-js has loaded a session, and the mint is what waits for the load.
    it('lets the mint wait for a session that has not loaded yet, then checks the one that loaded', async () => {
        const client = identity(undefined);
        const mint = vi.fn(async () => {
            client.session = { user: { id: 'user_A' } };

            return 'tok-A';
        });

        await expect(subjectBoundToken('user_A', client, mint)(false)).resolves.toBe('tok-A');
    });

    it('refuses when the session that loaded is another cook’s', async () => {
        const client = identity(undefined);
        const mint = vi.fn(async () => {
            client.session = { user: { id: 'user_B' } };

            return 'tok-B';
        });

        await expect(subjectBoundToken('user_A', client, mint)(false)).rejects.toBeInstanceOf(
            SessionSubjectChangedError,
        );
    });

    it('refuses when no session has loaded by the time the token is minted', async () => {
        const token = subjectBoundToken(
            'user_A',
            identity(undefined),
            vi.fn(async () => ''),
        );

        await expect(token(false)).rejects.toBeInstanceOf(SessionSubjectChangedError);
    });

    /**
     * REWRITTEN for plan 2026-10-13-004. A mint that fails (Clerk could not refresh its token offline, the web's typed
     * `RecipeAuthNotReadyError` while Clerk hydrates) used to reach the outbox's sender as a plain error with no status,
     * which it must read as an UNKNOWN outcome — parked for the cook, and for a create never sent again. Nothing was
     * sent: the token is minted BEFORE the request. The proxy now names that fact with its own error, keeping the
     * original as `cause`, so "not ready" stays distinguishable from "another cook" and from "the server said no".
     */
    it('⛔ wraps a mint failure in TokenMintFailedError, keeping the original as its cause', async () => {
        const notReady = new Error('Clerk returned no session token');
        const token = subjectBoundToken(
            'user_A',
            identity(undefined),
            vi.fn(async () => Promise.reject(notReady)),
        );

        const failure = await token(false).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isTokenMintFailedError(failure)).toBe(true);
        expect(failure).toBeInstanceOf(TokenMintFailedError);
        expect((failure as TokenMintFailedError).cause).toBe(notReady);
        expect(isSessionSubjectChangedError(failure)).toBe(false);
    });

    it('wraps a mint failure that is not an Error too (a thrown string)', async () => {
        const token = subjectBoundToken(
            'user_A',
            identity('user_A'),
            vi.fn(async () => Promise.reject('offline')),
        );

        const failure = await token(false).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isTokenMintFailedError(failure)).toBe(true);
        expect((failure as TokenMintFailedError).cause).toBe('offline');
    });

    it('⛔ a session change keeps its own error: it is another cook`s refusal, not a failed mint', async () => {
        const client = identity('user_A');
        const mint = vi.fn(async () => {
            client.session = { user: { id: 'user_B' } };

            return 'tok-B';
        });

        const failure = await subjectBoundToken(
            'user_A',
            client,
            mint,
        )(false).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(failure).toBeInstanceOf(SessionSubjectChangedError);
        expect(isTokenMintFailedError(failure)).toBe(false);
    });
});

describe('subjectBoundToken — a client built for no cook', () => {
    // Mobile resolves the cook a render after mount, and work started in that window must still reach the first cook.
    it('mints for the first session, and is then that cook’s', async () => {
        const client = identity('user_A');
        const token = subjectBoundToken(
            undefined,
            client,
            vi.fn(async () => 'tok'),
        );

        await expect(token(false)).resolves.toBe('tok');
        client.session = { user: { id: 'user_B' } };

        await expect(token(false)).rejects.toBeInstanceOf(SessionSubjectChangedError);
    });

    it('passes the mint’s own answer through while nobody is signed in, and stays unclaimed', async () => {
        const client = identity(null);
        const token = subjectBoundToken(
            undefined,
            client,
            vi.fn(async () => ''),
        );

        await expect(token(false)).resolves.toBe('');
        client.session = { user: { id: 'user_B' } };

        await expect(token(false)).resolves.toBe('');
    });

    it('refuses a token minted while the session moved between cooks', async () => {
        const client = identity('user_A');
        const mint = vi.fn(async () => {
            client.session = { user: { id: 'user_B' } };

            return 'tok-B';
        });

        await expect(subjectBoundToken(undefined, client, mint)(false)).rejects.toBeInstanceOf(
            SessionSubjectChangedError,
        );
    });
});

describe('SessionSubjectChangedError', () => {
    it('is an Error with its own name and guard, and names no user', () => {
        const error = new SessionSubjectChangedError();

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('SessionSubjectChangedError');
        expect(isSessionSubjectChangedError(error)).toBe(true);
        expect(isSessionSubjectChangedError(new Error('other'))).toBe(false);
        expect(error.message).not.toMatch(/user_/u);
    });
});

describe('TokenMintFailedError', () => {
    it('is an Error with its own name and guard, carries the cause, and names no user', () => {
        const cause = new Error('offline');
        const error = new TokenMintFailedError(cause);

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('TokenMintFailedError');
        expect(error.cause).toBe(cause);
        expect(isTokenMintFailedError(error)).toBe(true);
        expect(isTokenMintFailedError(new Error('other'))).toBe(false);
        expect(isTokenMintFailedError(new SessionSubjectChangedError())).toBe(false);
        expect(error.message).not.toMatch(/user_/u);
    });
});
