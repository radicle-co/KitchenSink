/**
 * The read-state rules of cooking mode, written once for both screens: which of loading, a notice or the session a read
 * draws, and what each notice says and offers. Every case is asserted on the whole notice (title, body, actions), so a
 * rule that drifts on one platform's screen has nowhere to hide.
 */
import { resolveMessages } from '@commise/i18n';
import { RecipeStatus } from '@kitchensink/recipe-core';
import { describe, expect, it, vi } from 'vitest';

import { cookingEntryOf } from '../cookingEntry.js';
import { cookingEntryViewOf, type CookingEntryViewInput } from '../cookingEntryView.js';
import type { CookingRecipe, CookingScreenRead } from '../cookingViewProps.js';
import type { LoadingPhase } from '../loadingPhase.js';
import { cookingMessages } from '../messages.js';

const copy = resolveMessages(cookingMessages, 'en');

const recipe = (instruction: string, status: CookingRecipe['status'] = RecipeStatus.PUBLISHED): CookingRecipe => ({
    id: 'r1',
    title: 'Roast',
    status,
    steps: [{ stepNumber: 1, instruction }],
});

function view(read: CookingScreenRead, phase: LoadingPhase = 'blank') {
    const handlers = { onLeave: vi.fn(), onEdit: vi.fn(), onHome: vi.fn() };
    const input: CookingEntryViewInput = { state: cookingEntryOf(read).state, phase, read, copy, ...handlers };

    return { result: cookingEntryViewOf(input), ...handlers };
}

describe('cookingEntryViewOf', () => {
    it.each([
        ['blank', 'blank'],
        ['skeleton', 'skeleton'],
        ['label', 'label'],
    ] as const)('draws the loading frame in the %s phase', (phase, drawn) => {
        expect(view({ kind: 'pending', retry: vi.fn() }, phase).result).toEqual({ kind: 'loading', phase: drawn });
    });

    it('turns a slow pending read into the load-error notice with Try again, and a way back', () => {
        const retry = vi.fn();
        const { result, onLeave } = view({ kind: 'pending', retry }, 'slow');

        expect(result).toEqual({
            kind: 'notice',
            notice: {
                title: copy.error.title,
                body: copy.error.body,
                primary: { label: copy.error.retry, icon: 'refreshCw', onPress: retry },
                secondary: { label: copy.error.back, icon: 'chevronLeft', onPress: onLeave },
            },
        });
    });

    it('keeps a slow draft redirect on the label frame, because it has no read to retry', () => {
        const draft = { kind: 'ready', recipe: recipe('Stir.', RecipeStatus.DRAFT), viewerIsOwner: true } as const;

        expect(view(draft, 'slow').result).toEqual({ kind: 'loading', phase: 'label' });
    });

    it.each([
        [false, copy.error.body],
        [true, copy.error.offlineBody],
    ])('says the load error with offline=%s, and offers Try again', (offline, body) => {
        const retry = vi.fn();
        const { result, onLeave } = view({ kind: 'failed', offline, retry });

        expect(result).toEqual({
            kind: 'notice',
            notice: {
                title: copy.error.title,
                body,
                primary: { label: copy.error.retry, icon: 'refreshCw', onPress: retry },
                secondary: { label: copy.error.back, icon: 'chevronLeft', onPress: onLeave },
            },
        });
    });

    it('says recipe gone with Go to Home only, and never why', () => {
        const { result, onHome } = view({ kind: 'gone' });

        expect(result).toEqual({
            kind: 'notice',
            notice: { title: copy.gone.title, secondary: { label: copy.gone.home, icon: 'house', onPress: onHome } },
        });
    });

    it('tells the owner of a recipe with no steps how to add some, with Edit recipe', () => {
        const { result, onEdit, onLeave } = view({ kind: 'ready', recipe: recipe('  '), viewerIsOwner: true });

        expect(result).toEqual({
            kind: 'notice',
            notice: {
                title: copy.empty.title,
                body: copy.empty.body,
                primary: { label: copy.empty.edit, icon: 'pencilLine', onPress: onEdit },
                secondary: { label: copy.empty.back, icon: 'chevronLeft', onPress: onLeave },
            },
        });
    });

    it('tells another cook its cook has added none, with no Edit recipe', () => {
        const { result, onLeave } = view({ kind: 'ready', recipe: recipe('  '), viewerIsOwner: false });

        expect(result).toEqual({
            kind: 'notice',
            notice: {
                title: copy.empty.title,
                body: copy.empty.bodyOther,
                secondary: { label: copy.empty.back, icon: 'chevronLeft', onPress: onLeave },
            },
        });
    });

    it('mounts the session for a recipe with steps', () => {
        const ready = { kind: 'ready', recipe: recipe('Stir.'), viewerIsOwner: false } as const;

        expect(view(ready).result).toEqual({ kind: 'session', recipe: ready.recipe });
    });
});
