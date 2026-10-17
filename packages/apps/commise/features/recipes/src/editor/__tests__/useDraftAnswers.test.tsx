/**
 * The outbox's answers reach the device draft while the editor is CLOSED (slice 7 blueprint). The cook leaves the editor
 * and the outbox drains later; without this observer the draft would stay under its local ref at the version it was
 * edited from, and the reopened editor would resend a create (a duplicate recipe) or name a stale version.
 */
import { renderHook } from '@testing-library/react';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import type { SettlementEvent } from '@kitchensink/sync';
import { describe, expect, it, vi } from 'vitest';

import type { EditorWriteAnswer } from '../../hooks/useRecipeEditor.js';
import type { DraftStore } from '../draftStore.js';
import { useDraftAnswers } from '../useDraftAnswers.js';

function harness() {
    const listeners = new Set<(event: SettlementEvent<EditorWriteAnswer>) => void>();
    const drafts = { adopt: vi.fn(async () => undefined) } as unknown as DraftStore & {
        adopt: ReturnType<typeof vi.fn>;
    };

    const subscribe = (listener: (event: SettlementEvent<EditorWriteAnswer>) => void) => {
        listeners.add(listener);

        return () => listeners.delete(listener);
    };

    const view = renderHook(() => useDraftAnswers({ subscribe }, drafts));

    const publish = (event: SettlementEvent<EditorWriteAnswer>) => {
        for (const listener of [...listeners]) {
            listener(event);
        }
    };

    return { ...view, drafts, publish, listeners };
}

describe('useDraftAnswers', () => {
    it('adopts every synced recipe write into the draft store: a create moves the draft to its id', () => {
        const { drafts, publish } = harness();

        publish({
            seq: 4,
            entity: 'recipe',
            localId: 'local:recipe:a',
            intentKind: 'create',
            outcome: 'synced',
            serverId: 'rec_9',
            answer: { kind: 'recipeWritten', detail: makeRecipeDetail({ id: 'rec_9', currentVersion: 1 }) },
        });

        expect(drafts.adopt).toHaveBeenCalledWith('local:recipe:a', { serverId: 'rec_9', version: 1 });
    });

    it('ignores refusals, other entities and answers that carry no recipe', () => {
        const { drafts, publish } = harness();

        publish({ seq: 1, entity: 'recipe', localId: 'rec_1', intentKind: 'update', outcome: 'parked', status: 409 });
        publish({
            seq: 2,
            entity: 'collection',
            localId: 'col_1',
            intentKind: 'update',
            outcome: 'synced',
            serverId: 'col_1',
        });
        publish({
            seq: 3,
            entity: 'recipe',
            localId: 'rec_1',
            intentKind: 'delete',
            outcome: 'synced',
            serverId: 'rec_1',
        });

        expect(drafts.adopt).not.toHaveBeenCalled();
    });

    it('unsubscribes on unmount', () => {
        const { unmount, listeners } = harness();

        unmount();

        expect(listeners.size).toBe(0);
    });
});
