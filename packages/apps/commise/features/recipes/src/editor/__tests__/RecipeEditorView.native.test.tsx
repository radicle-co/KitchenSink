/**
 * The native one-page editor (build spec §7, §7.12): the same model as the web leaf (`useEditorPage`), drawn natively —
 * the four sections under one scroller, the section index, the action bar outside the scroller, the notices, the
 * discard confirm, and the conflict view. The editor's lifecycle is a fake result.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useContext, type ReactElement } from 'react';
import { Text } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeEditorResult } from '../../__fixtures__/editorResult.js';
import { makeFilledRecipeFormValues, withLineKeys } from '../../__fixtures__/index.js';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { UseRecipeEditorResult } from '../../hooks/useRecipeEditor.js';
import { SectionPresenceContext } from '../sectionPresence.js';
import type { RecipeEditorViewProps } from '../frameProps.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeEditorView } from '../RecipeEditorView.native.js';

const { keyboard } = vi.hoisted(() => ({ keyboard: { shown: false } }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        // The on-screen keyboard, as `useKeyboardShown` reads it: a test sets `keyboard.shown` before rendering.
        Keyboard: {
            ...actual.Keyboard,
            isVisible: () => keyboard.shown,
            metrics: () => (keyboard.shown ? { screenX: 0, screenY: 500, width: 390, height: 300 } : undefined),
            addListener: () => ({ remove: () => undefined }),
        },
    };
});

afterEach(() => {
    cleanup();
    keyboard.shown = false;
});

/** Says whether its section is the one the cook is in, as a leaf reads it. */
function PresenceProbe({ name }: { readonly name: string }): ReactElement {
    return <Text>{`${name}: ${useContext(SectionPresenceContext) ? 'here' : 'away'}`}</Text>;
}

function view(editor: UseRecipeEditorResult, over: Partial<RecipeEditorViewProps> = {}): ReactElement {
    return (
        <LocaleProvider locale="en">
            <RecipeEditorView
                editor={editor}
                mode="create"
                keep="disk"
                guided={false}
                pendingEntryText=""
                sections={{
                    details: <></>,
                    ingredients: <></>,
                    steps: <></>,
                    photos: <></>,
                }}
                onClose={vi.fn()}
                onPreview={vi.fn()}
                onOpenMyRecipes={vi.fn()}
                {...over}
            />
        </LocaleProvider>
    );
}

describe('the native editor', () => {
    it('heads the screen with the task, and holds the four section headings in order', () => {
        render(view(makeEditorResult()));

        const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
        expect(headings).toEqual(['New recipe', 'Details', 'Ingredients', 'Steps', 'Photos & publish']);
    });

    it('says where the draft is kept: on this device', () => {
        render(view(makeEditorResult({ saveStatus: { kind: 'keptOnDevice', store: 'disk', awaiting: 'checkpoint' } })));

        expect(screen.getByText('Saved on this device')).toBeTruthy();
    });

    it('× checkpoints the exit, then leaves, without asking', () => {
        const checkpoint = vi.fn();
        const onClose = vi.fn();
        render(view(makeEditorResult({ checkpoint }), { onClose }));

        fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));

        expect(checkpoint).toHaveBeenCalledWith('editorExit');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Publish waits while pasted lines are still joining the recipe (§7.5.4), and sends nothing', () => {
        const publish = vi.fn(() => ({ kind: 'send' }) as const);
        render(view(makeEditorResult({ publish }), { pastePending: true }));

        const primary = screen.getByRole('button', { name: 'Publish' });
        fireEvent.click(primary);

        expect(primary.getAttribute('aria-disabled')).toBe('true');
        expect(publish).not.toHaveBeenCalled();
    });

    it('Publish goes through the gate with the entry`s uncommitted text', () => {
        const publish = vi.fn(() => ({ kind: 'send' }) as const);
        render(view(makeEditorResult({ publish }), { pendingEntryText: 'salt' }));

        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

        expect(publish).toHaveBeenCalledWith('salt');
    });

    it('a published recipe gets Save changes, disabled with nothing to save', () => {
        render(view(makeEditorResult({ lifecycle: 'published' }), { mode: 'edit' }));

        const button = screen.getByRole('button', { name: 'Save changes' });
        expect(button.getAttribute('aria-disabled')).toBe('true');
    });

    it('an unknown create`s alert offers Check My recipes first, then Save again', () => {
        const onOpenMyRecipes = vi.fn();
        render(view(makeEditorResult({ parked: { failure: 'unknown', kind: 'create' } }), { onOpenMyRecipes }));

        const alert = screen.getByRole('alert');
        const buttons = within(alert).getAllByRole('button');
        expect(buttons.map((button) => button.textContent)).toEqual(['Check My recipes', 'Save again']);

        fireEvent.click(buttons[0]!);
        expect(onOpenMyRecipes).toHaveBeenCalledTimes(1);
    });

    it('shows the resume notice for a published recipe`s device changes', () => {
        render(
            view(
                makeEditorResult({
                    lifecycle: 'published',
                    hasUnsavedChanges: true,
                    resume: { savedAt: '2026-10-08T09:00:00.000Z' },
                }),
                { mode: 'edit' },
            ),
        );

        expect(screen.getByText(/You have changes from .* that aren't saved to your recipe\./)).toBeTruthy();
    });

    it('a refused Publish says how many things to fix', () => {
        const values = makeFilledRecipeFormValues({ title: '' });
        render(view(makeEditorResult({ values, publishAttempted: true })));

        expect(screen.getByText('Fix 1 thing to publish')).toBeTruthy();
    });

    it('a never-published draft`s conflict replaces the form, in the draft`s words', () => {
        const editor = makeEditorResult({
            state: {
                status: 'conflict',
                theirs: {} as never,
                draft: makeFilledRecipeFormValues(),
                mergeSelections: {},
                server: { versionNumber: 4, updatedAt: '2026-10-09T10:00:00.000Z', snapshot: {} as never },
                mineSnapshot: {} as never,
                diff: { rows: [], isEmpty: false } as never,
                versionsBehind: 4,
                neverPublished: true,
                isResolving: false,
            },
        });
        render(view(editor));

        expect(screen.queryByRole('heading', { name: 'Details' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'This draft changed somewhere else' })).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    /**
     * Keyboard open (build spec §7.1): the section bar hides, so the header alone holds the top edge, and comes back
     * when the keyboard closes. The bar is the index's narrow presentation, a button named for the current section.
     */
    it('hides the section bar while the keyboard is open', () => {
        render(view(makeEditorResult()));
        expect(screen.getByRole('button', { name: /^Sections\. Current:/u })).toBeTruthy();
        cleanup();

        keyboard.shown = true;
        render(view(makeEditorResult()));

        expect(screen.queryByRole('button', { name: /^Sections\. Current:/u })).toBeNull();
        expect(screen.getByRole('button', { name: 'Close editor' })).toBeTruthy();
    });

    it('draws nothing once the editor has handed off', () => {
        const { container } = render(view(makeEditorResult({ state: { status: 'done' } })));

        expect(container.textContent).toBe('');
    });
});

/**
 * Each section tells the leaves inside it whether it is the section the cook is in (`SectionPresenceContext`), so an
 * event that lands in a section the cook is not in is a state, not an interruption (E2). The page opens in Details.
 */
describe('the note about lines with no match (owner D20)', () => {
    const SENTENCE = 'Ready to publish. 1 ingredient has no match, so its nutrition is left out.';
    const withUnmatched = () =>
        makeFilledRecipeFormValues({
            ingredients: withLineKeys([
                {
                    isUserEntered: false,
                    ingredientId: '00000000-0000-4000-8000-000000000001',
                    name: 'Oil',
                    quantity: 2,
                },
                {
                    isUserEntered: false,
                    ingredientId: '00000000-0000-4000-8000-000000000002',
                    name: 'Kale',
                    quantity: 1,
                    resolutionStatus: FoodResolutionStatus.NOT_FOUND,
                },
            ]),
        });

    it('says so in the action bar and, as a quiet note, in Photos & publish, with Publish still enabled', () => {
        render(
            view(makeEditorResult({ values: withUnmatched() }), {
                sections: { details: <></>, ingredients: <></>, steps: <></>, photos: <Text>photos body</Text> },
            }),
        );

        // Two places, one sentence: the bar's ready text, and the note ahead of the section's own controls.
        const [first, second] = screen.getAllByText(SENTENCE);

        expect(screen.getAllByText(SENTENCE)).toHaveLength(2);
        expect(
            [first, second].some(
                (note) =>
                    note !== undefined &&
                    (note.compareDocumentPosition(screen.getByText('photos body')) &
                        Node.DOCUMENT_POSITION_FOLLOWING) !==
                        0,
            ),
        ).toBe(true);
        expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')).toBe(false);
    });

    it('says nothing while the recipe is not ready: the fix line speaks instead', () => {
        render(view(makeEditorResult({ values: { ...withUnmatched(), title: '' } })));

        expect(screen.queryByText(/has no match/u)).toBeNull();
    });

    it('says nothing when every line has its match', () => {
        render(view(makeEditorResult({ values: makeFilledRecipeFormValues() })));

        expect(screen.queryByText(/no match/u)).toBeNull();
    });
});

describe('section presence', () => {
    it('only the current section is here', () => {
        render(
            view(makeEditorResult(), {
                sections: {
                    details: <PresenceProbe name="details" />,
                    ingredients: <PresenceProbe name="ingredients" />,
                    steps: <PresenceProbe name="steps" />,
                    photos: <PresenceProbe name="photos" />,
                },
            }),
        );

        expect(screen.getByText('details: here')).toBeTruthy();
        expect(screen.getByText('ingredients: away')).toBeTruthy();
        expect(screen.getByText('steps: away')).toBeTruthy();
    });
});
