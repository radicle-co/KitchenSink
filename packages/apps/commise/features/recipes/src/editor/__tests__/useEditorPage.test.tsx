// @vitest-environment jsdom
/**
 * The editor page's section-change checkpoint (blueprint A3), under the REAL web `ScrollHost`: the page reads the host's
 * section-change event, so this crosses that boundary rather than faking it. The first section the spy reports is where
 * the page opened, so it is not a change; every later change from one section to another is a checkpoint, once.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { ScrollHost } from '@commise/ui/scroll-host';
import { focusManager } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeEditorResult } from '../../__fixtures__/editorResult.js';
import type { ReportedTrigger } from '../../hooks/useRecipeEditor.js';
import { EDITOR_SECTIONS } from '../sections.js';
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
        guided: false,
        pendingEntryText: '',
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
