'use client';

/**
 * @module @commise/features-recipes/session — `RecipeServicesTree`, an orchestration component: the part of the
 * recipe provider tree that does not depend on `@commise/query` (the draft observer, then the recipe client, the food
 * client and the cook's marks).
 *
 * Web's `RecipeProviders` and mobile's `RecipeServiceGate` mounted the same nest and differed only in the device
 * store, so the order lives here once. The host keeps what is query-bound or platform-bound: the `QueryClient`, the
 * offline-read notice, `SyncProvider` and `RecipeWriteCacheObserver` (all `@commise/query`, which this package may not
 * import), the Clerk mint, and the origins.
 *
 * ⛔ THE HOST MOUNTS THIS INSIDE ITS `SyncProvider`. A queued write outlives the screen that made it, so the queue's
 * owner sits above every feature; the sender reads the client through a closure and needs no provider beneath it. The
 * hosts' order tests (`RecipeProviders.order.test.tsx`, `RecipeServiceGate.order.native.test.tsx`) hold that half.
 *
 * ⚠️ `useQueue` is a HOOK passed as a prop, on purpose: the draft observer must read the host's outbox, which lives in
 * `SyncProvider`'s context in `@commise/query`. Passing the hook (`useSyncQueue`) keeps the dependency pointing the
 * only legal way. It must be a module-level function, stable for the tree's life, or the rules of hooks break.
 *
 * @pattern Composition root (Facade) over the recipe subtree's providers, with the outbox as an injected Port
 */
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import type { OutboxStore } from '@kitchensink/sync';
import type { FC, ReactNode } from 'react';

import { CookMarksProvider } from '../detail/CookMarksProvider.js';
import { editorDraftsFor } from '../editor/cookDrafts.js';
import { useKeptSessionScope } from './kept/useKeptSessionScope.js';
import type { KeptSessionStore } from './kept/keptSessionStore.js';
import { useDraftAnswers, type DraftAnswerSource } from '../editor/useDraftAnswers.js';
import type { RecipeServiceClients } from './useRecipeServiceClients.js';

/** Props for {@link RecipeServicesTree}. */
export interface RecipeServicesTreeProps {
    /** The recipe and food clients built for this cook (`useRecipeServiceClients`). */
    readonly clients: RecipeServiceClients;
    /** The app's one device key/value store: the same object its `SyncProvider` and session end use. */
    readonly store: OutboxStore;
    /** The app's one kept cooking-session store (ADR-0094 section 1), scoped here to the cook. */
    readonly kept: KeptSessionStore;
    /**
     * Clerk's raw `userId`: `undefined` while it loads, `null` once nobody is signed in, else the cook. Never a
     * placeholder. The kept store needs all three (ADR-0094 section 5); everything else here takes it collapsed with
     * `?? undefined`.
     */
    readonly subject: string | null | undefined;
    /** Reads the outbox's settlement bus (`@commise/query/sync`'s `useSyncQueue`). A stable module-level hook. */
    readonly useQueue: () => DraftAnswerSource;
    readonly children: ReactNode;
}

/** The recipe, food and cook-marks providers, with the outbox's recipe answers recorded in the cook's drafts. */
export const RecipeServicesTree: FC<RecipeServicesTreeProps> = ({
    clients,
    store,
    kept,
    subject,
    useQueue,
    children,
}) => {
    // R7b: another cook's record is removed only once auth has resolved, and a sign-out removes them all.
    useKeptSessionScope(kept, subject);
    const cook = subject ?? undefined;

    // Records the outbox's recipe answers in the device draft whether or not an editor is open (slice 7): a cook can
    // leave the editor while its write is still queued.
    useDraftAnswers(useQueue(), editorDraftsFor(store, cook));

    return (
        <RecipeServiceProvider client={clients.recipe}>
            <FoodServiceProvider client={clients.food} subject={cook}>
                {/* Blueprint A13: the cook's checks and current step, kept for the cook who made them and removed at
                    the end of their session — the ADR-0054 rule, applied to marks. */}
                <CookMarksProvider subject={cook}>{children}</CookMarksProvider>
            </FoodServiceProvider>
        </RecipeServiceProvider>
    );
};
