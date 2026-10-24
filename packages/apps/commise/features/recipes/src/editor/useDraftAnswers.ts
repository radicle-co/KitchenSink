'use client';

/**
 * @module @commise/features-recipes/editor — the outbox's recipe answers, recorded in the device draft whether or not an
 * editor is open.
 *
 * The cook can leave the editor while its write is still queued; the outbox drains later. The answer then has no editor
 * to hear it, and without this observer the draft would stay under its local ref (a reopened editor would send a second
 * create) or at the version it was edited from. Mount it once per signed-in session, beside the app's `SyncProvider`.
 * `DraftStore.adopt` never lowers a version, so the open editor's own adoption and this one cannot fight.
 *
 * @pattern Observer over the outbox's settlement bus, writing into the draft Memento
 */
import { useEffect } from 'react';

import type { SettlementEvent } from '@kitchensink/sync';

import type { EditorWriteAnswer } from '../hooks/useRecipeEditor.js';
import type { DraftStore } from './draftStore.js';

/** The part of the outbox this observer reads. */
export interface DraftAnswerSource {
    readonly subscribe: (listener: (event: SettlementEvent<EditorWriteAnswer>) => void) => () => void;
}

/**
 * Record every synced recipe write's answer in the device draft store.
 *
 * @param source - The outbox's settlement bus (the app's `SyncQueue`).
 * @param drafts - The signed-in cook's draft store, or `undefined` while nobody is signed in.
 * @sideEffect Subscribes, and writes the draft store.
 */
export function useDraftAnswers(source: DraftAnswerSource, drafts: DraftStore | undefined): void {
    const { subscribe } = source;

    useEffect(() => {
        if (drafts === undefined) {
            return undefined;
        }

        return subscribe((event) => {
            if (event.entity !== 'recipe' || event.outcome !== 'synced' || event.answer?.kind !== 'recipeWritten') {
                return;
            }

            const { detail } = event.answer;

            void drafts.adopt(event.localId, { serverId: detail.id, version: detail.currentVersion });
        });
    }, [drafts, subscribe]);
}
