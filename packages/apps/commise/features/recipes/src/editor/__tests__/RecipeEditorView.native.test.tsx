/**
 * The native one-page editor (build spec §7, §7.12): the same model as the web leaf (`useEditorPage`), drawn natively —
 * the four sections under one scroller, the section index, the action bar outside the scroller, the notices, the
 * discard confirm, and the conflict view. The editor's lifecycle is a fake result.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useContext, type ReactElement } from 'react';
import { AccessibilityInfo, Text, type LayoutChangeEvent } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeEditorResult } from '../../__fixtures__/editorResult.js';
import { makeFilledRecipeFormValues, withLineKeys } from '../../__fixtures__/index.js';
import { titleFieldId } from '../../form/fieldIds.js';
import { Input } from '@commise/ui/input';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { RecipeFormErrors } from '../../form/validate.js';
import type { UseRecipeEditorResult } from '../../hooks/useRecipeEditor.js';
import { SectionPresenceContext } from '../sectionPresence.js';
import type { RecipeEditorViewProps } from '../frameProps.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeEditorView } from '../RecipeEditorView.native.js';

const { keyboard, win, reveal } = vi.hoisted(() => ({
    keyboard: { shown: false },
    win: { width: undefined as number | undefined },
    // The scroller the editor hands the field reveal on its latest render.
    reveal: {
        scroller: undefined as { readonly current: unknown } | undefined,
        // The reveal host the editor drew with on its latest render: the test reports the visible area through it.
        host: undefined as { readonly onViewportLayout: (event: LayoutChangeEvent) => void } | undefined,
    },
}));

// The real field reveal, with the scroller it is handed recorded: react-native-web lays nothing out, so the reveal's
// own measuring never runs here, and what the editor wires into it is what this file can see.
vi.mock('@commise/ui/field-reveal', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/ui/field-reveal')>();

    return {
        ...actual,
        useFieldRevealHost: (scroller: Parameters<typeof actual.useFieldRevealHost>[0]) => {
            reveal.scroller = scroller;
            // react-native-web's scroller never answers a native measure, so the host is handed one that has nothing to
            // measure: a target is then shown at once, which is what these cases are about.
            const host = actual.useFieldRevealHost({
                current:
                    scroller.current === null ? null : { getNativeScrollRef: () => null, scrollTo: () => undefined },
            });
            reveal.host = host;

            return host;
        },
    };
});

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        // A window width a test sets; unset, the real one.
        useWindowDimensions: () =>
            win.width === undefined
                ? actual.useWindowDimensions()
                : { ...actual.useWindowDimensions(), width: win.width },
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
    win.width = undefined;
    reveal.scroller = undefined;
    reveal.host = undefined;
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

/** Says whether its section is the one the cook is in, as a leaf reads it. */
function PresenceProbe({ name }: { readonly name: string }): ReactElement {
    return <Text>{`${name}: ${useContext(SectionPresenceContext) ? 'here' : 'away'}`}</Text>;
}

/** Whether the action bar lies inside the box that holds every section: the scroller's content. */
function barInContent(): boolean {
    const last = screen.getByRole('heading', { name: 'Photos & publish' });
    let box: HTMLElement | null = screen.getByRole('heading', { name: 'Details' });

    while (box !== null && !box.contains(last)) {
        box = box.parentElement;
    }

    return box?.contains(screen.getByRole('group', { name: 'Recipe actions' })) === true;
}

function view(editor: UseRecipeEditorResult, over: Partial<RecipeEditorViewProps> = {}): ReactElement {
    return (
        <LocaleProvider locale="en">
            <RecipeEditorView
                editor={editor}
                mode="create"
                keep="disk"
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

describe('the content gutter (buildSpec §1.2)', () => {
    /** The first ancestor of the Details heading that pads its content, i.e. the scroller's content container. */
    const paddingOf = (): string => {
        let node: HTMLElement | null = screen.getByRole('heading', { name: 'Details' });

        while (node !== null && Number.parseFloat(getComputedStyle(node).paddingLeft) === 0) {
            node = node.parentElement;
        }

        return node === null ? '' : getComputedStyle(node).paddingLeft;
    };

    it.each([
        { width: 390, gutter: '16px' },
        { width: 700, gutter: '24px' },
        { width: 1000, gutter: '32px' },
    ])('pads the content $gutter at a $width pt window', ({ width, gutter }) => {
        win.width = width;
        render(view(makeEditorResult()));

        expect(paddingOf()).toBe(gutter);
    });
});

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

    it('a refused write says the changes are kept, with ONE action, Try again', () => {
        const retry = vi.fn();
        render(view(makeEditorResult({ parked: { failure: 'terminal', kind: 'update' }, retry })));

        const alert = screen.getByRole('alert');
        expect(within(alert).getByText(/We couldn't save your latest changes\./)).toBeTruthy();

        const buttons = within(alert).getAllByRole('button');
        expect(buttons.map((button) => button.textContent)).toEqual(['Try again']);

        fireEvent.click(buttons[0]!);
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('a write that is only retrying shows no alert: the status says it', () => {
        render(view(makeEditorResult({ parked: { failure: 'transient', kind: 'update' } })));

        expect(screen.queryByRole('alert')).toBeNull();
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

        // Two places by design (A-010b): the action bar's polite line, and the Ready line in Photos & publish.
        const bar = screen.getByRole('group', { name: 'Recipe actions' }).parentElement;
        expect(within(bar as HTMLElement).getByText('Fix 1 thing to publish')).toBeTruthy();
    });

    // §7.8 and `specSharedSystem.md` §16.3: a refused Publish takes the screen-reader cursor to the first invalid
    // FIELD, and to the section's heading where the refusal names no single field.
    describe('where a refused Publish sends the screen-reader cursor', () => {
        const refusing = (errors: RecipeFormErrors): Partial<UseRecipeEditorResult> => ({
            publish: () => ({ kind: 'refused', errors, section: 'details' }),
        });
        const cursorTargets = (): unknown[] =>
            vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.map(([node]) => node);

        /** Report the visible area, as the scroller's layout does on a device. */
        const layOut = (): void => {
            act(() => {
                reveal.host?.onViewportLayout({
                    nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 400 } },
                } as LayoutChangeEvent);
            });
        };

        /** Press Publish inside `act`, as the editor's state updates and effects (the cursor move) run within it. */
        const publish = async (): Promise<void> => {
            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
                await Promise.resolve();
            });
        };

        it('goes to the title when the title is what was refused', async () => {
            render(
                view(makeEditorResult(refusing({ title: 'titleRequired' })), {
                    sections: {
                        details: <Input id={titleFieldId} label="Title" value="" onChangeText={vi.fn()} />,
                        ingredients: <></>,
                        steps: <></>,
                        photos: <></>,
                    },
                }),
            );
            layOut();

            await publish();

            expect(cursorTargets()).toEqual([screen.getByRole('textbox', { name: 'Title' })]);
        });

        it('goes to the section heading when the refusal names no single field', async () => {
            render(view(makeEditorResult(refusing({ servings: 'servingsPositive' }))));
            layOut();

            await publish();

            expect(cursorTargets()).toEqual([screen.getByRole('heading', { name: 'Details' })]);
        });

        it('goes there again on a second refusal', async () => {
            render(view(makeEditorResult(refusing({ servings: 'servingsPositive' }))));
            layOut();

            await publish();
            await publish();

            expect(cursorTargets()).toHaveLength(2);
        });
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

    /**
     * A-006: with the keyboard up the bar is the scroller's last item, not a pinned strip above the keys (§7.1 "the
     * section bar hides and the ActionBar unpins"): about 330 dp is left for the form, and a pinned bar took more.
     */
    it('⛔ unpins the action bar into the scroller while the keyboard is open (phones)', () => {
        render(view(makeEditorResult()));
        expect(barInContent()).toBe(false);
        cleanup();

        keyboard.shown = true;
        render(view(makeEditorResult()));

        expect(barInContent()).toBe(true);
        expect(screen.getAllByRole('group', { name: 'Recipe actions' })).toHaveLength(1);
    });

    it('keeps the action bar pinned on a wide layout with the keyboard open: the rail sits beside the form there', () => {
        win.width = 1100;
        keyboard.shown = true;
        render(view(makeEditorResult()));

        expect(barInContent()).toBe(false);
    });

    /**
     * E1: an ingredient list that opens behind the bar or the keyboard is revealed over the screen's ONE scroller. The
     * scroller mounts after the editor's first render, so the reveal must be handed the scroller the host holds NOW. A
     * reveal handed the first render's empty handle measures nothing and never scrolls: the list opens below the fold.
     */
    it('⛔ hands the field reveal the scroller once it has mounted, the one that holds the sections', () => {
        render(view(makeEditorResult()));

        const scroller = reveal.scroller?.current;

        expect(scroller).toBeInstanceOf(HTMLElement);
        expect((scroller as HTMLElement).contains(screen.getByRole('heading', { name: 'Photos & publish' }))).toBe(
            true,
        );
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
/**
 * A-010b (build spec §7.7 item 3): the Ready line is always in Photos & publish — "Ready to publish." for a recipe
 * Publish would accept, "Fix {n} things to publish" (a button to the first section that needs it) otherwise.
 */
describe('the Ready line in Photos & publish (A-010b)', () => {
    it('says "Ready to publish." for a recipe Publish would accept', () => {
        render(view(makeEditorResult({ values: makeFilledRecipeFormValues() })));

        expect(screen.getByText('Ready to publish.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Fix / })).toBeNull();
    });

    it('is there before Publish is ever pressed for an empty new recipe: a button saying what to fix', () => {
        render(view(makeEditorResult()));

        expect(screen.getByRole('button', { name: /^Fix \d+ things? to publish$/u })).toBeTruthy();
        expect(screen.queryByText('Ready to publish.')).toBeNull();
    });

    it('shows no line for a published recipe: its primary is Save changes', () => {
        render(
            view(makeEditorResult({ lifecycle: 'published', values: makeFilledRecipeFormValues() }), { mode: 'edit' }),
        );

        expect(screen.queryByText('Ready to publish.')).toBeNull();
        expect(screen.queryByRole('button', { name: /^Fix / })).toBeNull();
    });
});

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

/**
 * A confirmed Discard that waits for the recipe's create to answer (finding 2 of the 2026-10-10 review): the confirm
 * stays open and busy, saying so in words, and Keep editing takes the discard back.
 */
describe('a Discard that waits for its create', () => {
    it('keeps the confirm open, busy, saying "Discarding…"; Keep editing takes it back', () => {
        const cancelDiscard = vi.fn();
        const discard = vi.fn();
        render(
            view(makeEditorResult({ values: makeFilledRecipeFormValues(), discarding: true, cancelDiscard, discard })),
        );

        // The native dialog is announced as an interrupting `alert`, its title a heading (`ConfirmDialog.native`).
        const dialog = screen.getByRole('alert');
        expect(within(dialog).getByRole('heading', { name: 'Discard this draft?' })).toBeTruthy();
        expect(within(dialog).getByText('Discarding…')).toBeTruthy();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
        expect(discard).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(cancelDiscard).toHaveBeenCalledTimes(1);
    });
});

/**
 * A Discard storage refused (GATE round 3, Minor 2): nothing was removed and the draft is still there. The confirm
 * stays open saying so, Discard tries again, and Keep editing dismisses it.
 */
describe('a Discard storage refused', () => {
    it('keeps the confirm open saying nothing was removed; Discard tries again, Keep editing dismisses it', () => {
        const cancelDiscard = vi.fn();
        const discard = vi.fn();
        render(
            view(
                makeEditorResult({ values: makeFilledRecipeFormValues(), discardFailed: true, cancelDiscard, discard }),
            ),
        );

        const dialog = screen.getByRole('alert');
        expect(within(dialog).getByRole('heading', { name: 'Discard this draft?' })).toBeTruthy();
        expect(
            within(dialog).getByText("We couldn't discard. Nothing was removed, so you can try again."),
        ).toBeTruthy();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
        expect(discard).toHaveBeenCalledTimes(1);

        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(cancelDiscard).toHaveBeenCalledTimes(1);
    });
});
