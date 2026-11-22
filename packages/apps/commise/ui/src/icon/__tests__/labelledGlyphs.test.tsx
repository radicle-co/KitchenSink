import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionMenu } from '../../actionMenu/ActionMenu.js';
import { ConfirmDialog } from '../../confirmDialog/ConfirmDialog.js';
import { StateNotice } from '../../stateNotice/StateNotice.js';
import { ChoiceRow } from '../../choiceRow/ChoiceRow.js';
import { KeepAwakeToggle } from '../../keepAwake/KeepAwakeToggle.js';
import type { ScrollHostApi, ScrollTarget } from '../../scrollHost/props.js';
import { ScrollHostContext } from '../../scrollHost/scrollHostContext.js';
import { SectionIndex } from '../../sectionIndex/SectionIndex.js';
import { SegmentedControl } from '../../segmentedControl/SegmentedControl.js';
import { StatusBadge } from '../../statusBadge/StatusBadge.js';

/**
 * Web: the glyph of a labelled control is drawn in `rem`, as its label's text is, so browser text size moves both; an
 * icon-only segment keeps a fixed pixel size. jsdom resolves no `rem`, so this pins the declared size: 1 rem is 16 px
 * at 1x, so the 1x pixel size is the one the glyph had.
 */

beforeEach(() => {
    // The toggle draws nothing without the Wake Lock API.
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'wakeLock', { value: { request: vi.fn() }, configurable: true });
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'wakeLock');
});

/** A host whose every call is inert: the index only needs one above it. */
const inertHost: ScrollHostApi = {
    condensed: false,
    scrollingDown: false,
    atTop: true,
    current: undefined,
    onCurrentChange: () => () => undefined,
    viewportsDown: 0,
    pageViewports: 1,
    scrollToTop: () => undefined,
    scrollToSection: () => undefined,
    scrollToField: () => false,
    revealSpan: () => false,
    scrollToStart: () => false,
    showIfHidden: () => false,
    headingLayout: () => undefined,
    sectionLayout: () => () => undefined,
    handle: createRef<ScrollTarget | null>(),
};

if (typeof Element !== 'undefined') {
    // jsdom implements neither pointer capture nor scrollIntoView, which Radix's menu calls on open.
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

const noop = (): void => undefined;

/** The declared widths of every glyph in the container. */
const widthsIn = (root: ParentNode): readonly string[] =>
    [...root.querySelectorAll<SVGElement>('svg.lucide')].map((svg) => svg.style.width);

describe('a glyph in a labelled control is in rem', () => {
    it('StatusBadge: 1rem', () => {
        const { container } = render(<StatusBadge status="draft">Draft</StatusBadge>);

        expect(widthsIn(container)).toEqual(['1rem']);
    });

    it('KeepAwakeToggle: 1.25rem', () => {
        const { container } = render(<KeepAwakeToggle on onChange={noop} label="Screen on" />);

        expect(widthsIn(container)).toEqual(['1.25rem']);
    });

    it('ChoiceRow check: 1.25rem', () => {
        const { container } = render(
            <ChoiceRow chosen busy={false} refused={false} accessibilityLabel="Easy, chosen" onPress={noop}>
                Easy
            </ChoiceRow>,
        );

        expect(widthsIn(container)).toEqual(['1.25rem']);
    });

    it('SegmentedControl glyph beside a visible label: 1.25rem', () => {
        const { container } = render(
            <SegmentedControl
                form="view"
                label="View"
                value="list"
                onChange={vi.fn()}
                segments={[{ id: 'list', label: 'List', icon: 'list' }]}
            />,
        );

        expect(widthsIn(container)).toEqual(['1.25rem']);
    });

    it('ActionMenu item glyph: 1.25rem, while the "..." trigger stays a fixed glyph', async () => {
        const user = userEvent.setup();
        render(
            <ActionMenu
                triggerLabel="Actions"
                title="Saffron"
                closeLabel="Close actions"
                items={[{ id: 'retry', label: 'Try again', icon: 'refreshCw', onSelect: noop }]}
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Actions' });

        expect(widthsIn(trigger)).toEqual(['']);

        await user.click(trigger);

        expect(widthsIn(screen.getByRole('menuitem', { name: 'Try again' }))).toEqual(['1.25rem']);
    });

    it('ConfirmDialog keep action glyph: 1.25rem', () => {
        render(
            <ConfirmDialog
                open
                title="Discard?"
                body="Leaving discards them."
                confirm={{ label: 'Discard', icon: 'trash' }}
                keep={{ label: 'Keep editing', icon: 'pencilLine' }}
                onConfirm={noop}
                onKeep={noop}
            />,
        );

        expect(widthsIn(screen.getByRole('button', { name: 'Keep editing' }))).toEqual(['1.25rem']);
    });

    it('StateNotice link action glyph: 1.25rem quiet, 1rem ghost', () => {
        render(
            <StateNotice
                title="Failed."
                primary={{ label: 'Try again', icon: 'refreshCw', onPress: noop, href: '/retry' }}
                secondary={{ label: 'Back', icon: 'chevronLeft', onPress: noop, href: '/back' }}
            />,
        );

        expect(widthsIn(screen.getByRole('link', { name: 'Try again' }))).toEqual(['1.25rem']);
        expect(widthsIn(screen.getByRole('link', { name: 'Back' }))).toEqual(['1rem']);
    });

    it('SectionIndex: every glyph beside a label, in the rail, strip and bar', () => {
        const { container } = render(
            <ScrollHostContext.Provider value={inertHost}>
                <SectionIndex
                    label="Recipe sections"
                    sheetTitle="Sections"
                    sheetCloseLabel="Close sections"
                    barName="Sections"
                    items={[
                        { id: 'details', label: 'Details', tone: 'complete' },
                        { id: 'steps', label: 'Steps', tone: 'fix', reason: 'Fix 1 thing', count: 1 },
                    ]}
                    currentId="steps"
                />
            </ScrollHostContext.Provider>,
        );
        const widths = widthsIn(container);

        expect(widths.length).toBeGreaterThan(0);
        expect(widths.filter((width) => width === '')).toEqual([]);
    });
});

describe('an icon-only segment keeps a fixed pixel glyph', () => {
    it('SegmentedControl with its labels hidden: no rem size', () => {
        const { container } = render(
            <SegmentedControl
                form="view"
                label="View"
                value="list"
                labelVisibility="hidden"
                onChange={vi.fn()}
                segments={[{ id: 'list', label: 'List', icon: 'list' }]}
            />,
        );

        expect(widthsIn(container)).toEqual(['']);
    });
});
