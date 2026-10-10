// @vitest-environment jsdom
/**
 * The web one-page editor (build spec §7.1–§7.10): the frame, the section index from the one validator, the save
 * status, the action bar's primary by lifecycle, the refused Publish, the parked-write alerts, the resume notice, the
 * discard confirm and the conflict view. The editor's lifecycle is a fake result; this suite is about what the page
 * shows and which command each control issues.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { focusManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useContext, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeEditorResult } from '../../__fixtures__/editorResult.js';
import { makeFilledRecipeFormValues, withLineKeys } from '../../__fixtures__/index.js';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { UseRecipeEditorResult } from '../../hooks/useRecipeEditor.js';
import { SectionPresenceContext } from '../sectionPresence.js';
import { EDITOR_TOP_CHROME_IDS, type RecipeEditorViewProps } from '../frameProps.js';
import { RecipeEditorView } from '../RecipeEditorView.js';

afterEach(cleanup);

/** Says whether its section is the one the cook is in, as a leaf reads it. */
function PresenceProbe({ name }: { readonly name: string }): ReactElement {
    return <p>{`${name}: ${useContext(SectionPresenceContext) ? 'here' : 'away'}`}</p>;
}

function view(editor: UseRecipeEditorResult, over: Partial<RecipeEditorViewProps> = {}): ReactElement {
    return (
        <LocaleProvider locale="en">
            <RecipeEditorView
                editor={editor}
                mode="create"
                keep="tabSession"
                guided={false}
                pendingEntryText=""
                sections={{
                    details: <p>details body</p>,
                    ingredients: <p>ingredients body</p>,
                    steps: <p>steps body</p>,
                    photos: <p>photos body</p>,
                }}
                onClose={vi.fn()}
                onPreview={vi.fn()}
                onOpenMyRecipes={vi.fn()}
                {...over}
            />
        </LocaleProvider>
    );
}

describe('the frame', () => {
    it('is titled by what the cook is doing, never by the recipe`s own title (H1)', () => {
        const { rerender } = render(view(makeEditorResult()));

        expect(screen.getByRole('heading', { level: 1, name: 'New recipe' })).toBeTruthy();

        rerender(view(makeEditorResult({ values: makeFilledRecipeFormValues() }), { mode: 'edit' }));
        expect(screen.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeTruthy();
    });

    it('holds the four sections in order, each an H2 a jump can focus, with its body', () => {
        render(view(makeEditorResult()));

        const headings = screen.getAllByRole('heading', { level: 2 });

        expect(headings.map((heading) => heading.textContent)).toEqual([
            'Details',
            'Ingredients',
            'Steps',
            'Photos & publish',
        ]);
        expect(headings.map((heading) => [heading.id, heading.getAttribute('tabindex')])).toEqual([
            ['details', '-1'],
            ['ingredients', '-1'],
            ['steps', '-1'],
            ['photos', '-1'],
        ]);
        expect(screen.getByText('steps body')).toBeTruthy();
    });

    it('puts a section`s heading action in its heading row', () => {
        render(view(makeEditorResult(), { headingActions: { steps: <button type="button">Paste steps</button> } }));

        const steps = screen.getByRole('region', { name: 'Steps' });
        expect(within(steps).getByRole('button', { name: 'Paste steps' })).toBeTruthy();
    });

    it('names the section index "Recipe sections" from the one validator', () => {
        render(view(makeEditorResult()));

        expect(screen.getAllByRole('navigation', { name: 'Recipe sections', hidden: true }).length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: 'Sections. Current: Details.', hidden: true })).toBeTruthy();
    });

    it('× never asks: it checkpoints the exit, then leaves', () => {
        const checkpoint = vi.fn();
        const onClose = vi.fn();
        render(view(makeEditorResult({ checkpoint }), { onClose }));

        fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));

        expect(checkpoint).toHaveBeenCalledWith('editorExit');
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(checkpoint.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0] ?? 0);
    });

    it('checkpoints when the tab is hidden (TanStack`s focus, which the web drives from visibilitychange)', () => {
        const checkpoint = vi.fn();
        render(view(makeEditorResult({ checkpoint })));

        act(() => {
            focusManager.setFocused(false);
        });
        focusManager.setFocused(undefined);

        expect(checkpoint).toHaveBeenCalledWith('appHidden');
    });

    /**
     * The editor's `checkpoint` is a new function every render, and a checkpoint itself causes renders (the device save,
     * the lane). Hiding is ONE event: a render while still hidden must not checkpoint again, or the page spins in a
     * render–checkpoint loop the moment the cook switches tabs (found in the browser, where it froze the page).
     */
    it('checkpoints once per hiding, however often the page renders while hidden', () => {
        const first = vi.fn();
        const { rerender } = render(view(makeEditorResult({ checkpoint: first })));

        act(() => {
            focusManager.setFocused(false);
        });
        const second = vi.fn();
        rerender(view(makeEditorResult({ checkpoint: second })));
        focusManager.setFocused(undefined);

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
    });
});

describe('the save status (§7.3)', () => {
    it.each([
        [{ kind: 'unsaved' } as const, undefined],
        [{ kind: 'saved' } as const, 'Saved'],
        [{ kind: 'syncing' } as const, 'Saved in this tab'],
        [{ kind: 'keptOnDevice', store: 'tabSession', awaiting: 'saveChanges' } as const, 'Changes kept in this tab'],
    ])('%j reads %j in the header', (saveStatus, text) => {
        render(view(makeEditorResult({ saveStatus })));

        const header = screen.getByRole('banner');

        if (text === undefined) {
            expect(within(header).queryByText(/Saved|Saving|Changes/)).toBeNull();
        } else {
            expect(within(header).getByText(text)).toBeTruthy();
        }
    });

    it('announces a failure once, politely', () => {
        render(view(makeEditorResult({ saveStatus: { kind: 'syncFailed', failure: 'unknown' } })));

        const live = screen.getAllByRole('status').map((node) => node.textContent);
        expect(live).toContain("Couldn't confirm your save");
    });
});

describe('the action bar', () => {
    it('offers Preview and Publish for a recipe not yet published', () => {
        const onPreview = vi.fn();
        render(view(makeEditorResult(), { onPreview }));

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        expect(onPreview).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    });

    it('offers Save changes for a published recipe, disabled while there is nothing to save', () => {
        const saveChanges = vi.fn(() => ({ kind: 'send' }) as const);
        const { rerender } = render(view(makeEditorResult({ lifecycle: 'published', saveChanges }), { mode: 'edit' }));

        const disabled = screen.getByRole('button', { name: 'Save changes' });
        expect(disabled.getAttribute('aria-disabled') === 'true' || disabled.hasAttribute('disabled')).toBe(true);

        rerender(
            view(makeEditorResult({ lifecycle: 'published', saveChanges, hasUnsavedChanges: true }), { mode: 'edit' }),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        expect(saveChanges).toHaveBeenCalledWith('');
    });

    it('Publish waits while pasted lines are still joining the recipe (§7.5.4), and sends nothing', () => {
        const publish = vi.fn(() => ({ kind: 'send' }) as const);
        render(view(makeEditorResult({ publish }), { pastePending: true }));

        const primary = screen.getByRole('button', { name: 'Publish' });
        fireEvent.click(primary);

        expect(primary.getAttribute('aria-disabled') === 'true' || primary.hasAttribute('disabled')).toBe(true);
        expect(publish).not.toHaveBeenCalled();
    });

    it('a Publish passes the entry`s uncommitted text to the gate', () => {
        const publish = vi.fn(() => ({ kind: 'send' }) as const);
        render(view(makeEditorResult({ publish }), { pendingEntryText: 'flour' }));

        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

        expect(publish).toHaveBeenCalledWith('flour');
    });

    it('a refused Publish says how many things to fix, and the index switches those sections to Fix', () => {
        const values = makeFilledRecipeFormValues({ title: '', steps: [] });
        const onRefused = vi.fn();
        const refused = {
            kind: 'refused',
            errors: { title: 'titleRequired', steps: 'stepsRequired' },
            section: 'details',
        } as const;
        const publish = vi.fn(() => refused);
        const { rerender } = render(view(makeEditorResult({ values, publish }), { onRefused }));

        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        expect(onRefused).toHaveBeenCalledWith(refused);

        rerender(view(makeEditorResult({ values, publish, publishAttempted: true }), { onRefused }));

        expect(screen.getByText('Fix 2 things to publish')).toBeTruthy();
        expect(screen.getAllByText('Fix 1 thing', { exact: true }).length).toBeGreaterThan(0);
    });

    it('a Publish waiting for its answer shows the primary busy', () => {
        render(view(makeEditorResult({ state: { status: 'finishing' } })));

        expect(screen.getByRole('button', { name: 'Publish' }).getAttribute('aria-busy')).toBe('true');
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
        render(view(makeEditorResult({ values: withUnmatched() })));

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

describe('a parked write (ADR-0057: the cook decides)', () => {
    it('an unknown create warns of a second copy, offers My recipes first, and Save again', () => {
        const retry = vi.fn();
        const onOpenMyRecipes = vi.fn();
        render(
            view(
                makeEditorResult({
                    parked: { failure: 'unknown', kind: 'create' },
                    saveStatus: { kind: 'syncFailed', failure: 'unknown' },
                    retry,
                }),
                { onOpenMyRecipes },
            ),
        );

        const alert = screen.getByRole('alert');
        expect(within(alert).getByText(/you may get two copies/)).toBeTruthy();

        const buttons = within(alert).getAllByRole('button');
        expect(buttons.map((button) => button.textContent)).toEqual(['Check My recipes', 'Save again']);

        fireEvent.click(buttons[1]!);
        fireEvent.click(buttons[0]!);
        expect(retry).toHaveBeenCalledTimes(1);
        expect(onOpenMyRecipes).toHaveBeenCalledTimes(1);
    });

    it('a refused write says the changes are kept in this tab, with Try again', () => {
        const retry = vi.fn();
        render(view(makeEditorResult({ parked: { failure: 'terminal', kind: 'update' }, retry })));

        const alert = screen.getByRole('alert');
        expect(within(alert).getByText("We couldn't save your latest changes. They're kept in this tab.")).toBeTruthy();

        fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('a write that is only retrying shows no alert: the status says it', () => {
        render(view(makeEditorResult({ parked: { failure: 'transient', kind: 'update' } })));

        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('the resume notice (a published recipe`s device changes, §7.3)', () => {
    it('says when the changes are from, and offers Save changes and Discard (confirmed)', () => {
        const saveChanges = vi.fn(() => ({ kind: 'send' }) as const);
        const discard = vi.fn();
        render(
            view(
                makeEditorResult({
                    lifecycle: 'published',
                    hasUnsavedChanges: true,
                    resume: { savedAt: '2026-10-08T09:00:00.000Z' },
                    saveChanges,
                    discard,
                }),
                { mode: 'edit' },
            ),
        );

        const notice = screen.getByRole('region', { name: /You have changes from/ });
        fireEvent.click(within(notice).getByRole('button', { name: 'Save changes' }));
        expect(saveChanges).toHaveBeenCalledWith('');

        fireEvent.click(within(notice).getByRole('button', { name: 'Discard' }));
        const dialog = screen.getByRole('alertdialog', { name: 'Discard your changes?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
        expect(discard).toHaveBeenCalledTimes(1);
    });
});

describe('discard (⋯, §7.3)', () => {
    it('asks before discarding a draft, and Keep editing keeps it', async () => {
        const discard = vi.fn();
        render(view(makeEditorResult({ lifecycle: 'neverPublished', recipeId: 'rec_1', discard }), { mode: 'edit' }));

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'More editor actions' }));
        await user.click(await screen.findByRole('menuitem', { name: 'Discard draft' }));

        const dialog = await screen.findByRole('alertdialog', { name: 'Discard this draft?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(discard).not.toHaveBeenCalled();
    });
});

describe('the conflict view', () => {
    it('replaces the form while a conflict is open, in the never-published draft`s words', () => {
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

        expect(screen.queryByRole('heading', { level: 2, name: 'Details' })).toBeNull();
        // The state's `neverPublished` reaches the view: no "evicted" warning, no version numbers.
        expect(screen.getByRole('heading', { name: 'This draft changed somewhere else' })).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

/**
 * The action bar's pinning (build spec §7.1, `compactHeightLayout.md` A1): sticky at the foot of the page, unless the
 * header and the bar together are taller than half the viewport — a sideways phone with its keyboard open, or 200% text
 * on a small one. Then it scrolls with the page, as its last content. jsdom lays nothing out, so the test plays the
 * browser: the header's and the bar's heights, the viewport's, and a `ResizeObserver` that reports when told.
 */
describe('the action bar unpins past half the viewport (A1)', () => {
    const observers = new Set<() => void>();

    class ResizeObserverStub {
        private readonly report: () => void;

        constructor(callback: ResizeObserverCallback) {
            this.report = () => callback([], this);
        }

        observe(): void {
            observers.add(this.report);
        }

        unobserve(): void {
            observers.delete(this.report);
        }

        disconnect(): void {
            observers.delete(this.report);
        }
    }

    const layOut = (geometry: { readonly header: number; readonly bar: number; readonly viewport: number }): void => {
        vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(geometry.viewport);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            if (this.tagName === 'HEADER') {
                return new DOMRect(0, 0, 390, geometry.header);
            }

            return this.querySelector('[role="group"][aria-label="Recipe actions"]') !== null &&
                this.contains(screen.getByRole('button', { name: 'Publish' }))
                ? new DOMRect(0, 0, 390, geometry.bar)
                : new DOMRect();
        });
    };

    const reportSizes = (): void => {
        act(() => {
            for (const report of observers) {
                report();
            }
        });
    };

    const bar = (): HTMLElement => {
        const node = screen.getByRole('group', { name: 'Recipe actions' }).parentElement;

        if (node === null) {
            throw new Error('the action bar has no wrapper');
        }

        return node;
    };

    afterEach(() => {
        observers.clear();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('is sticky before anything is measured, so the server render and the first client render agree', () => {
        vi.stubGlobal('ResizeObserver', ResizeObserverStub);
        render(view(makeEditorResult()));

        expect(bar().className).toContain('sticky');
    });

    it('stays sticky on a 390 × 844 phone', () => {
        vi.stubGlobal('ResizeObserver', ResizeObserverStub);
        layOut({ header: 56, bar: 72, viewport: 844 });
        render(view(makeEditorResult()));
        reportSizes();

        expect(bar().className).toContain('sticky');
    });

    it('scrolls with the page when the header and the bar take more than half the viewport, and comes back', () => {
        vi.stubGlobal('ResizeObserver', ResizeObserverStub);
        layOut({ header: 56, bar: 121, viewport: 300 });
        render(view(makeEditorResult()));
        reportSizes();

        expect(bar().className).not.toContain('sticky');
        // The bar never moves in the page, so a focused control keeps its focus across the change.
        expect(screen.getAllByRole('button', { name: 'Publish' })).toHaveLength(1);
        // The section bar hides too (build spec §7.1), so the header alone holds the top edge; the rail stays.
        expect(screen.queryByRole('button', { name: /^Sections\. Current:/u })).toBeNull();
        expect(screen.getAllByRole('navigation', { name: 'Recipe sections' })).toHaveLength(1);

        vi.restoreAllMocks();
        layOut({ header: 56, bar: 121, viewport: 844 });
        reportSizes();

        expect(bar().className).toContain('sticky');
        expect(screen.getByRole('button', { name: /^Sections\. Current:/u })).toBeTruthy();
    });
});

/**
 * Popups keep clear of the sticky chrome (`rowEditorOpenDecisions.md` V3-1), and below 960 px that chrome is the
 * header AND the section index's strip or bar stuck under it. The inset reader reads `EDITOR_TOP_CHROME_IDS`, so each
 * sticky top box on the page must carry one of those ids — or a list opening upward slides under the section bar.
 */
describe('the sticky top chrome the popups keep clear of', () => {
    it('names the header, the strip and the phone bar with the ids the inset reader reads', () => {
        render(view(makeEditorResult()));

        const header = screen.getByRole('heading', { level: 1, name: 'New recipe' }).closest('header');
        // The rail and the strip share the index's name; the strip is the second, the one that sticks under the header.
        const [, strip] = screen.getAllByRole('navigation', { name: 'Recipe sections' });
        const bar = screen.getByRole('button', { name: /^Sections\. Current:/u }).parentElement;

        expect([header?.id, strip?.id, bar?.id].sort()).toEqual([...EDITOR_TOP_CHROME_IDS].sort());
    });
});

/**
 * Each section tells the leaves inside it whether it is the section the cook is in (`SectionPresenceContext`), so an
 * event that lands in a section the cook is not in is a state, not an interruption (E2). The page opens in Details.
 */
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
 * The browser's own unsaved-changes prompt (finding 1 of the 2026-10-09 review). On web the draft and the outbox journal
 * live in the tab's session storage (D7), so closing the tab loses whatever the server does not hold — for a recipe
 * never published as much as for a published one. REWRITTEN from the guard's old rule, armed only for a published
 * recipe's changes awaiting Save changes.
 */
describe('the unload prompt (web, D7)', () => {
    /** Whether a `beforeunload` now would ask: the listener cancels the event. */
    function asks(): boolean {
        const event = new Event('beforeunload', { cancelable: true });

        window.dispatchEvent(event);

        return event.defaultPrevented;
    }

    it('asks for a never-published draft whose checkpoint has not reached the server', () => {
        render(
            view(
                makeEditorResult({
                    lifecycle: 'neverPublished',
                    values: makeFilledRecipeFormValues(),
                    saveStatus: { kind: 'keptOnDevice', store: 'tabSession', awaiting: 'checkpoint' },
                }),
            ),
        );

        expect(asks()).toBe(true);
    });

    it('asks while a write is still on its way', () => {
        render(view(makeEditorResult({ values: makeFilledRecipeFormValues(), saveStatus: { kind: 'syncing' } })));

        expect(asks()).toBe(true);
    });

    it('does not ask once the server holds the draft, nor for a new recipe nobody typed in', () => {
        const { rerender } = render(
            view(makeEditorResult({ values: makeFilledRecipeFormValues(), saveStatus: { kind: 'saved' } })),
        );

        expect(asks()).toBe(false);

        rerender(view(makeEditorResult()));
        expect(asks()).toBe(false);
    });
});
