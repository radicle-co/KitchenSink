/**
 * @module @commise/query/session-scope — the app's query cache belongs to one cook at a time.
 *
 * ⚠️ DELIBERATE — see `docs/architecture/decisions/0054-session-seam.md`. When the signed-in cook changes from a cook to
 * anyone else (signed out, or another cook), every read in the cache is cancelled and emptied, and every write held in
 * memory is dropped, so the next person on the device never reads the last cook's recipes or foods and never sends
 * their queued work. A cook signing in from signed out removes nothing: a page that read the public catalog before the
 * identity client named the cook keeps its answer.
 *
 * Writes queued through `SyncProvider` are not here: they are in the cook's own persisted outbox, which is namespaced by
 * the cook and drains when that cook signs in again.
 *
 * The cook the cache currently holds is recorded against the `QueryClient` itself rather than in React state or a
 * ref: the decision is about the cache, it needs no re-render, and an effect cleanup cannot make it, because React's
 * StrictMode runs every cleanup once on mount in development and that would discard what the server render hydrated.
 *
 * @pattern Observer — reacts to a change of the signed-in cook by ending the cache's scope
 */
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** The cook each live cache holds, as last seen by the boundary. Absent until the boundary first mounts. */
const scopes = new WeakMap<QueryClient, string | undefined>();

/**
 * Forget everything the cache holds: empty every read (which cancels a read in flight), and drop every write held in
 * memory.
 *
 * A read that is still mounted (a direct switch between two signed-in cooks leaves the screen in place) is RESET, not
 * removed: an observer keeps showing the answer of a query removed from under it until something re-renders it, and a
 * reset both clears that answer and asks again with the new cook's client. Every other read is removed.
 *
 * @param queryClient - The app's client.
 * @sideEffect Aborts requests, starts the mounted reads again, and empties both caches of everything else.
 */
function endScope(queryClient: QueryClient): void {
    void queryClient.resetQueries();
    queryClient.removeQueries({ type: 'inactive' });
    queryClient.getMutationCache().clear();
}

/**
 * Bind the app's query cache to the signed-in cook. Mount it once, in each app's composition root.
 *
 * It takes the client rather than reading it from context, because the web root builds its `QueryClientProvider` and
 * so renders above it.
 *
 * @param queryClient - The app's client, the one its `QueryClientProvider` holds.
 * @param subject - The signed-in cook's user id (Clerk `userId`), or `undefined` while nobody is signed in.
 * @sideEffect Empties the query and mutation caches when the cook changes from a cook to anyone else.
 */
export function useQuerySessionScope(queryClient: QueryClient, subject: string | undefined): void {
    useEffect(() => {
        const held = scopes.get(queryClient);

        if (held !== undefined && held !== subject) {
            endScope(queryClient);
        }

        scopes.set(queryClient, subject);
    }, [queryClient, subject]);
}
