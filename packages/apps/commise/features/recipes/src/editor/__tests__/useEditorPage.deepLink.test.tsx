// @vitest-environment jsdom
/**
 * Where a deep link takes the cook (`editorArrival.ts`): a link to an ingredient line the draft holds puts that ROW's top
 * at the start of the viewport (`scrollToStart`), so an inline editor opened below it shows whole, Done and Cancel
 * included. Where the host finds no row by id (native), it falls back to the smallest scroll that shows the row
 * (`revealSpan`), then to the section. A line the draft does not hold, or a section-only link, goes to the section.
 *
 * The scroll host is faked: the real hosts cannot see the page's own ordering of the calls.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
    scrollToSection: undefined as unknown as ReturnType<typeof vi.fn>,
    scrollToStart: undefined as unknown as ReturnType<typeof vi.fn>,
    revealSpan: undefined as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('@commise/ui/scroll-host', () => ({
    useScrollHost: () => ({
        current: undefined,
        onCurrentChange: () => () => undefined,
        scrollToSection: host.scrollToSection,
        scrollToField: () => true,
        scrollToStart: host.scrollToStart,
        revealSpan: host.revealSpan,
    }),
}));

import { makeEditorResult } from '../../__fixtures__/editorResult.js';
import { ingredientRowId } from '../../form/fieldIds.js';
import { seedLineKey } from '../../form/lineKey.js';
import type { ResolvedArrival } from '../editorArrival.js';
import { useEditorPage } from '../useEditorPage.js';

beforeEach(() => {
    host.scrollToSection = vi.fn();
    host.scrollToStart = vi.fn(() => true);
    host.revealSpan = vi.fn(() => true);
});

afterEach(cleanup);

const ROW = seedLineKey(3, 1);

function mountArriving(arrival: ResolvedArrival): void {
    const Page = (): ReactElement => {
        useEditorPage({
            editor: makeEditorResult(),
            mode: 'edit',
            keep: 'tabSession',
            pendingEntryText: '',
            pendingEntryFieldId: undefined,
            sections: { details: null, ingredients: null, steps: null, photos: null },
            arrival,
            onClose: () => undefined,
            onPreview: () => undefined,
            onOpenMyRecipes: () => undefined,
            requestLeave: (go) => go(),
            photosAtRisk: false,
        });

        return <></>;
    };

    render(
        <LocaleProvider locale="en">
            <Page />
        </LocaleProvider>,
    );
}

describe('useEditorPage — a deep link to an ingredient line', () => {
    it('puts the row’s top at the start of the viewport, and moves nothing else', () => {
        mountArriving({ section: 'ingredients', line: { kind: 'found', key: ROW } });

        expect(host.scrollToStart).toHaveBeenCalledExactlyOnceWith(ingredientRowId(ROW));
        expect(host.revealSpan).not.toHaveBeenCalled();
        expect(host.scrollToSection).not.toHaveBeenCalled();
    });

    // The host answers `false` only when it finds no such row (web), and then no other scroll could show it either.
    it('falls back to the section when the host does not have the row', () => {
        host.scrollToStart = vi.fn(() => false);
        mountArriving({ section: 'ingredients', line: { kind: 'found', key: ROW } });

        expect(host.scrollToSection).toHaveBeenCalledExactlyOnceWith('ingredients');
        expect(host.revealSpan).not.toHaveBeenCalled();
    });

    it('goes to the section for a line the draft does not hold', () => {
        mountArriving({ section: 'ingredients', line: { kind: 'missing' } });

        expect(host.scrollToSection).toHaveBeenCalledExactlyOnceWith('ingredients');
        expect(host.scrollToStart).not.toHaveBeenCalled();
    });

    it('goes to the section for a section-only link', () => {
        mountArriving({ section: 'steps' });

        expect(host.scrollToSection).toHaveBeenCalledExactlyOnceWith('steps');
        expect(host.scrollToStart).not.toHaveBeenCalled();
    });
});
