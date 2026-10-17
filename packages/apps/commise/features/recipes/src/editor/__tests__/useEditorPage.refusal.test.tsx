// @vitest-environment jsdom
/**
 * Where a refused Publish takes the cook (`docs/design/uiOverhaul/buildSpec.md` §7.8; `specSharedSystem.md` §16.3): to
 * the section first, then to the first invalid field when the refusal has one. A refusal with no single field (the
 * servings, the times) has only the section's heading to point at, and on native the heading's screen-reader focus is
 * asked for by `refusalHeadings`, a count per section that advances once per such refusal.
 *
 * The scroll host is faked: this crosses the page's own ordering, which the real hosts cannot see (the web hash depends
 * on the section jump coming first).
 */
import { LocaleProvider } from '@commise/i18n/react';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
    scrollToSection: undefined as unknown as ReturnType<typeof vi.fn>,
    scrollToField: undefined as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('@commise/ui/scroll-host', () => ({
    useScrollHost: () => ({
        current: undefined,
        onCurrentChange: () => () => undefined,
        scrollToSection: host.scrollToSection,
        scrollToField: host.scrollToField,
    }),
}));

import { makeEditorResult } from '../../__fixtures__/editorResult.js';
import type { RecipeFormErrors } from '../../form/validate.js';
import type { EditorPage } from '../useEditorPage.js';
import { useEditorPage } from '../useEditorPage.js';
import type { EditorSectionId } from '../sections.js';

beforeEach(() => {
    host.scrollToSection = vi.fn();
    host.scrollToField = vi.fn(() => true);
});

afterEach(cleanup);

/** Render the page, with a Publish that refuses with `errors` in `section`; returns the latest page. */
function mountRefusing(errors: RecipeFormErrors, section: EditorSectionId | undefined) {
    const seen: { page?: EditorPage } = {};
    const editor = makeEditorResult({ publish: () => ({ kind: 'refused', errors, section }) });

    const Page = (): ReactElement => {
        const page = useEditorPage({
            editor,
            mode: 'create',
            keep: 'tabSession',
            pendingEntryText: '',
            sections: { details: null, ingredients: null, steps: null, photos: null },
            onClose: () => undefined,
            onPreview: () => undefined,
            onOpenMyRecipes: () => undefined,
        });

        // The test drives the page from outside: it reads the page the latest render drew.
        seen.page = page;

        return <></>;
    };

    render(
        <LocaleProvider locale="en">
            <Page />
        </LocaleProvider>,
    );

    return {
        page: (): EditorPage => {
            if (seen.page === undefined) {
                throw new Error('no page');
            }

            return seen.page;
        },
        press: () => {
            act(() => {
                seen.page?.finish();
            });
        },
    };
}

describe('useEditorPage — a refused Publish', () => {
    it('takes the cook to the section first, then to the field', () => {
        const { press } = mountRefusing({ title: 'titleRequired' }, 'details');

        press();

        expect(host.scrollToSection).toHaveBeenCalledExactlyOnceWith('details');
        expect(host.scrollToField).toHaveBeenCalledOnce();
        expect(host.scrollToSection.mock.invocationCallOrder[0]).toBeLessThan(
            host.scrollToField.mock.invocationCallOrder[0] ?? 0,
        );
    });

    it('counts a heading refusal for a section whose refusal has no single field', () => {
        const { page, press } = mountRefusing({ servings: 'servingsPositive' }, 'details');
        expect(page().refusalHeadings).toEqual({});

        press();

        expect(host.scrollToField).not.toHaveBeenCalled();
        expect(page().refusalHeadings).toEqual({ details: 1 });

        press();

        expect(page().refusalHeadings).toEqual({ details: 2 });
    });

    it('counts nothing for a refusal that names a field: the field takes the cook, not the heading', () => {
        const { page, press } = mountRefusing({ title: 'titleRequired' }, 'details');

        press();

        expect(page().refusalHeadings).toEqual({});
    });

    it('counts nothing for a refusal with no section', () => {
        const { page, press } = mountRefusing({}, undefined);

        press();

        expect(host.scrollToSection).not.toHaveBeenCalled();
        expect(page().refusalHeadings).toEqual({});
    });

    it('counts nothing when Publish is not refused', () => {
        const seen: { page?: EditorPage } = {};
        const editor = makeEditorResult({ publish: () => ({ kind: 'send' }) });

        const Page = (): ReactElement => {
            seen.page = useEditorPage({
                editor,
                mode: 'create',
                keep: 'tabSession',
                pendingEntryText: '',
                sections: { details: null, ingredients: null, steps: null, photos: null },
                onClose: () => undefined,
                onPreview: () => undefined,
                onOpenMyRecipes: () => undefined,
            });

            return <></>;
        };

        render(
            <LocaleProvider locale="en">
                <Page />
            </LocaleProvider>,
        );
        act(() => {
            seen.page?.finish();
        });

        expect(seen.page?.refusalHeadings).toEqual({});
    });
});
