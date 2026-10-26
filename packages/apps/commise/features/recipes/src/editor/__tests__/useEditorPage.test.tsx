// @vitest-environment jsdom
/**
 * The editor page's section-change checkpoint (blueprint A3), under the REAL web `ScrollHost`: the page reads the host's
 * section-change event, so this crosses that boundary rather than faking it. The first section the spy reports is where
 * the page opened, so it is not a change; every later change from one section to another is a checkpoint, once.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { ScrollHost } from '@commise/ui/scroll-host';
import { focusManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeEditorResult } from '../../__fixtures__/editorResult.js';
import type { ReportedTrigger } from '../../hooks/useRecipeEditor.js';
import type { RecipeFormErrors } from '../../form/validate.js';
import { EDITOR_SECTIONS, firstSectionWithErrors } from '../sections.js';
import { useEditorPage } from '../useEditorPage.js';

/** Each section's top in the document; the page is long enough for every one to reach the line. */
const TOPS: Readonly<Record<string, number>> = { details: 0, ingredients: 1000, steps: 2000, photos: 3000 };

beforeEach(() => {
    vi.stubGlobal(
        'IntersectionObserver',
        class {
            observe(): void {}
            disconnect(): void {}
        },
    );
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 6000 });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
});

function Page({ checkpoint }: { readonly checkpoint: (trigger: ReportedTrigger) => void }): ReactElement {
    useEditorPage({
        editor: makeEditorResult({ checkpoint }),
        mode: 'create',
        keep: 'tabSession',
        pendingEntryText: '',
        pendingEntryFieldId: undefined,
        sections: { details: null, ingredients: null, steps: null, photos: null },
        onClose: () => undefined,
        onPreview: () => undefined,
        onOpenMyRecipes: () => undefined,
    });

    return <></>;
}

function renderPage(): ReturnType<typeof vi.fn<(trigger: ReportedTrigger) => void>> {
    const checkpoint = vi.fn<(trigger: ReportedTrigger) => void>();

    render(
        <LocaleProvider locale="en">
            <ScrollHost sections={EDITOR_SECTIONS}>
                {EDITOR_SECTIONS.map((id) => (
                    <section key={id} id={id} />
                ))}
                <Page checkpoint={checkpoint} />
            </ScrollHost>
        </LocaleProvider>,
    );

    for (const id of EDITOR_SECTIONS) {
        const node = document.getElementById(id);

        if (node === null) {
            throw new Error(`no section ${id}`);
        }

        node.getBoundingClientRect = () => ({ top: (TOPS[id] ?? 0) - window.scrollY }) as DOMRect;
    }

    return checkpoint;
}

async function scrollTo(y: number): Promise<void> {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
    act(() => {
        window.dispatchEvent(new Event('scroll'));
    });
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

const sectionChanges = (checkpoint: ReturnType<typeof renderPage>): number =>
    checkpoint.mock.calls.filter(([trigger]) => trigger === 'sectionChange').length;

describe('useEditorPage — the section-change checkpoint', () => {
    it('does not count the section the page opened at', async () => {
        const checkpoint = renderPage();

        await scrollTo(10);
        await scrollTo(50);

        expect(sectionChanges(checkpoint)).toBe(0);
    });

    it('checkpoints once per change from one section to another', async () => {
        const checkpoint = renderPage();

        await scrollTo(10);
        await scrollTo(1100);
        expect(sectionChanges(checkpoint)).toBe(1);

        await scrollTo(1200);
        expect(sectionChanges(checkpoint)).toBe(1);

        await scrollTo(2100);
        await scrollTo(100);
        expect(sectionChanges(checkpoint)).toBe(3);
    });
});

/**
 * The app going to the background is a checkpoint (blueprint A3): an EVENT, heard from TanStack's `focusManager`, which
 * each platform drives (staff-code-quality, 2026-10-09: it ran from an effect on a `focused` snapshot). An editor that
 * mounts while the app is already in the background has not been left, so it raises nothing then.
 */
describe('useEditorPage — the app going to the background', () => {
    afterEach(() => {
        focusManager.setFocused(undefined);
    });

    it('checkpoints each time the app goes to the background, and not when it comes back', () => {
        const checkpoint = renderPage();

        act(() => {
            focusManager.setFocused(false);
        });
        act(() => {
            focusManager.setFocused(true);
        });
        act(() => {
            focusManager.setFocused(false);
        });

        expect(checkpoint.mock.calls.filter(([trigger]) => trigger === 'appHidden')).toHaveLength(2);
    });

    it('⛔ raises nothing for an editor that opens while the app is already in the background', () => {
        focusManager.setFocused(false);

        const checkpoint = renderPage();

        expect(checkpoint).not.toHaveBeenCalledWith('appHidden');
    });
});

/**
 * E7 (build spec §7.8, WCAG 3.3.1): "Focus moves to the first invalid field, scrolled under the chrome." A refused
 * Publish took the cook to the section's HEADING; the field the error is about now takes focus, under the real web
 * `ScrollHost`, which finds it by id.
 */
describe('useEditorPage — a refused Publish focuses the first invalid field (E7)', () => {
    /** An editor whose Publish is refused with `errors`. */
    function refusing(errors: RecipeFormErrors) {
        const refused = {
            kind: 'refused',
            errors,
            section: firstSectionWithErrors(errors),
        } as const;

        return makeEditorResult({ publish: () => refused });
    }

    /** Render the page; the returned `press` is the primary (Publish), pressed. */
    function renderRefused(errors: RecipeFormErrors, over: { readonly onRefused?: () => void } = {}): () => void {
        const Probe = (): ReactElement => {
            const page = useEditorPage({
                editor: refusing(errors),
                mode: 'create',
                keep: 'tabSession',
                pendingEntryText: '',
                pendingEntryFieldId: undefined,
                sections: { details: null, ingredients: null, steps: null, photos: null },
                onClose: () => undefined,
                onPreview: () => undefined,
                onOpenMyRecipes: () => undefined,
                ...(over.onRefused === undefined ? {} : { onRefused: over.onRefused }),
            });

            return (
                <button type="button" onClick={page.finish}>
                    Publish
                </button>
            );
        };

        render(
            <LocaleProvider locale="en">
                <ScrollHost sections={EDITOR_SECTIONS}>
                    {EDITOR_SECTIONS.map((id) => (
                        <section key={id} id={id} tabIndex={-1}>
                            {id === 'details' ? <input id="recipe-title" aria-label="Title" /> : null}
                            {id === 'ingredients' ? <input id="recipe-ingredient-add" aria-label="Add" /> : null}
                        </section>
                    ))}
                    <Probe />
                </ScrollHost>
            </LocaleProvider>,
        );

        for (const node of document.querySelectorAll('section, input')) {
            (node as HTMLElement).scrollIntoView = vi.fn();
        }

        return () => fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    }

    it('moves focus to the title field, not the Details heading, when the title is refused', () => {
        const finish = renderRefused({ title: 'titleRequired' });

        act(() => finish());

        expect(document.activeElement?.id).toBe('recipe-title');
    });

    it('moves focus to the add field when the list of ingredients is empty', () => {
        const finish = renderRefused({ ingredients: 'ingredientsEmpty' });

        act(() => finish());

        expect(document.activeElement?.id).toBe('recipe-ingredient-add');
    });

    it('falls back to the section heading when the refused error has no single field', () => {
        const finish = renderRefused({ servings: 'servingsPositive' });

        act(() => finish());

        expect(document.activeElement?.id).toBe('details');
    });

    it('still tells the host about the refusal, as the ingredients field`s own focus needs', () => {
        const onRefused = vi.fn();
        const finish = renderRefused({ title: 'titleRequired' }, { onRefused });

        act(() => finish());

        expect(onRefused).toHaveBeenCalledTimes(1);
    });
});

/**
 * R23 (`ingredientMatching.md`, "Save"): publishing with paste lines that have no food yet is ALLOWED, but the cook is
 * asked first. The interception lives where every route to Publish passes — `finish` — so the primary, the resume
 * notice's Save and any later route cannot skip it. A published recipe's Save changes is not a publish and never asks.
 */
describe('useEditorPage — Publish asks about lines that have no food yet (R23)', () => {
    const FACTS = { openNames: ['milk'], checkingNames: [], counted: 3, total: 4 };

    function renderAsking(over: {
        readonly facts?: typeof FACTS | undefined;
        readonly lifecycle?: 'unsaved' | 'published';
        readonly publish?: () => { kind: 'send' };
        readonly saveChanges?: () => { kind: 'send' };
        readonly chooseNow?: () => void;
    }) {
        const publish = over.publish ?? vi.fn(() => ({ kind: 'send' as const }));
        const saveChanges = over.saveChanges ?? vi.fn(() => ({ kind: 'send' as const }));
        const chooseNow = over.chooseNow ?? vi.fn();

        const Probe = (): ReactElement => {
            const page = useEditorPage({
                editor: makeEditorResult({
                    publish,
                    saveChanges,
                    lifecycle: over.lifecycle ?? 'unsaved',
                }),
                mode: 'create',
                keep: 'tabSession',
                pendingEntryText: '',
                pendingEntryFieldId: undefined,
                sections: { details: null, ingredients: null, steps: null, photos: null },
                onClose: () => undefined,
                onPreview: () => undefined,
                onOpenMyRecipes: () => undefined,
                openChoices: { facts: 'facts' in over ? over.facts : FACTS, chooseNow },
            });

            return (
                <>
                    <button type="button" onClick={page.finish}>
                        Primary
                    </button>
                    <button type="button" onClick={page.openChoices.publishAnyway}>
                        Publish anyway
                    </button>
                    <button type="button" onClick={page.openChoices.chooseNow}>
                        Choose now
                    </button>
                    <button type="button" onClick={() => page.openChoices.setOpen(false)}>
                        Dismiss
                    </button>
                    <output>{page.openChoices.open ? 'asking' : 'quiet'}</output>
                    <output aria-label="Facts">{JSON.stringify(page.openChoices.facts ?? null)}</output>
                </>
            );
        };

        render(
            <LocaleProvider locale="en">
                <ScrollHost sections={EDITOR_SECTIONS}>
                    {EDITOR_SECTIONS.map((id) => (
                        <section key={id} id={id} tabIndex={-1} />
                    ))}
                    <Probe />
                </ScrollHost>
            </LocaleProvider>,
        );

        for (const node of document.querySelectorAll('section')) {
            (node as HTMLElement).scrollIntoView = vi.fn();
        }

        return {
            publish,
            saveChanges,
            chooseNow,
            press: (name = 'Primary') => fireEvent.click(screen.getByRole('button', { name })),
        };
    }

    it('⛔ asks instead of publishing while a line needs a pick', () => {
        const view = renderAsking({});

        view.press();

        expect(view.publish).not.toHaveBeenCalled();
        expect(screen.getAllByRole('status')[0]?.textContent).toBe('asking');
    });

    it('publishes at once when no line needs a pick', () => {
        const view = renderAsking({ facts: undefined });

        view.press();

        expect(view.publish).toHaveBeenCalledTimes(1);
        expect(screen.getAllByRole('status')[0]?.textContent).toBe('quiet');
    });

    it('Publish anyway closes the ask and publishes', () => {
        const view = renderAsking({});

        view.press();
        view.press('Publish anyway');

        expect(view.publish).toHaveBeenCalledTimes(1);
        expect(screen.getAllByRole('status')[0]?.textContent).toBe('quiet');
    });

    it('Choose now closes the ask, opens the first open line, and takes the cook to the Ingredients section', () => {
        const view = renderAsking({});

        view.press();
        view.press('Choose now');

        expect(view.publish).not.toHaveBeenCalled();
        expect(view.chooseNow).toHaveBeenCalledTimes(1);
        expect(screen.getAllByRole('status')[0]?.textContent).toBe('quiet');
        expect((document.getElementById('ingredients') as HTMLElement).scrollIntoView).toHaveBeenCalled();
    });

    it('closing the ask any other way publishes nothing', () => {
        const view = renderAsking({});

        view.press();
        view.press('Dismiss');

        expect(view.publish).not.toHaveBeenCalled();
        expect(screen.getAllByRole('status')[0]?.textContent).toBe('quiet');
    });

    it('⛔ a published recipe’s Save changes is not a publish: it never asks', () => {
        const view = renderAsking({ lifecycle: 'published' });

        view.press();

        expect(view.saveChanges).toHaveBeenCalledTimes(1);
        expect(view.publish).not.toHaveBeenCalled();
    });

    it('keeps the facts a closing sheet still shows, once the lines are chosen', () => {
        const view = renderAsking({});

        view.press();

        expect(JSON.parse(screen.getByLabelText('Facts').textContent ?? 'null')).toEqual(FACTS);
    });
});
