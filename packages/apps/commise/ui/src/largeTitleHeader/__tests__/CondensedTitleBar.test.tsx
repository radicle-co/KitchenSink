/**
 * The web CondensedTitleBar (buildSpec §3.3; `docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §4-§6): a fixed bar below
 * 840 on the floating layer. A given `back` or `menu` is ALWAYS rendered, named, focusable and clickable, in every
 * combination of the two display facts (`surfaceShown`, `titleShown`); only the material and the title fade. The title is
 * repeated for sight only.
 *
 * ⚠️ This file REWRITES the old "is inert and transparent while hidden" test. That contract is the defect the pinned bar
 * removes: an `inert` bar left web pages below 840 with no Back in the band above the title.
 *
 * jsdom applies no stylesheet, so what a class does (`pointer-events-none` on the band, `pointer-events-auto` on the
 * controls) is asserted as the class, and `inert` / `aria-hidden` as the attribute.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { CondensedTitleBar } from '../CondensedTitleBar.js';

afterEach(cleanup);

const back = (onPress = vi.fn()) => ({ label: 'Back to Collections', parent: 'Collections', onPress });
const FLAGS = [
    { surfaceShown: false, titleShown: false },
    { surfaceShown: true, titleShown: false },
    { surfaceShown: false, titleShown: true },
    { surfaceShown: true, titleShown: true },
] as const;

describe('CondensedTitleBar (web)', () => {
    // The geometry is asserted in a browser (Playwright: the Back's box against the H1's left edge); this pins the classes
    // that carry it, since jsdom lays nothing out: the bar pads by `<main>`'s gutter and the glyph starts at the control's edge.
    it('puts the chevron on the content gutter: 16 px, 24 px from medium, glyph at the control’s own edge', () => {
        const { container } = render(<CondensedTitleBar surfaceShown={false} titleShown={false} back={back()} />);
        const bar = container.firstElementChild as HTMLElement;
        const control = screen.getByRole('button', { name: 'Back to Collections' });

        expect(bar.className).toContain('pl-4');
        expect(bar.className).toContain('medium:pl-6');
        expect(bar.className).not.toMatch(/(^|\s)px-/u);
        expect(control.className).toContain('justify-start');
        expect(control.className).not.toContain('justify-center');
    });

    it.each(FLAGS)('keeps Back rendered, focusable and clickable with %o', (flags) => {
        const onPress = vi.fn();
        const { container } = render(<CondensedTitleBar title="Weeknight dinners" {...flags} back={back(onPress)} />);
        const bar = container.firstElementChild as HTMLElement;
        const control = screen.getByRole('button', { name: 'Back to Collections' });

        expect(bar.hasAttribute('inert')).toBe(false);
        expect(bar.getAttribute('aria-hidden')).toBeNull();
        expect(control.className).toContain('pointer-events-auto');
        fireEvent.click(control);
        expect(onPress).toHaveBeenCalledOnce();
    });

    it.each(FLAGS)('renders exactly one element named Back, hidden or not, with %o', (flags) => {
        render(<CondensedTitleBar title="Weeknight dinners" {...flags} back={back()} />);

        expect(screen.getAllByRole('button', { name: 'Back to Collections', hidden: true })).toHaveLength(1);
    });

    it.each(FLAGS)('keeps the menu rendered with %o', (flags) => {
        render(<CondensedTitleBar title="Dinners" {...flags} menu={<button type="button">More actions</button>} />);

        expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
    });

    it('lets an empty band pass clicks through, below 840 only', () => {
        const { container } = render(<CondensedTitleBar title="Weeknight dinners" surfaceShown titleShown />);
        const bar = container.firstElementChild as HTMLElement;

        expect(bar.className).toContain('pointer-events-none');
        expect(bar.className).toContain('nav:hidden');
    });

    it('repeats the title hidden from assistive tech, shown by titleShown alone', () => {
        const { rerender } = render(<CondensedTitleBar title="Weeknight dinners" surfaceShown={false} titleShown />);
        const shown = screen.getByText('Weeknight dinners');

        expect(shown.getAttribute('aria-hidden')).toBe('true');
        expect(shown.className).toContain('opacity-100');

        rerender(<CondensedTitleBar title="Weeknight dinners" surfaceShown titleShown={false} />);

        expect(screen.getByText('Weeknight dinners').className).toContain('opacity-0');
    });

    it('fades the title and the material, and not under reduced motion', () => {
        render(<CondensedTitleBar title="Weeknight dinners" surfaceShown titleShown />);

        expect(screen.getByText('Weeknight dinners').className).toContain('motion-reduce:transition-none');
    });

    it('shows the material with surfaceShown and none without it, whatever the title does', () => {
        const { container, rerender } = render(
            <CondensedTitleBar title="Weeknight dinners" surfaceShown titleShown={false} />,
        );

        expect(container.querySelector('[data-material="bar"]')).not.toBeNull();

        rerender(<CondensedTitleBar title="Weeknight dinners" surfaceShown={false} titleShown />);

        expect(container.querySelector('[data-material="none"]')).not.toBeNull();
    });

    it('draws no title while the page does not know it yet (loading)', () => {
        const { container } = render(<CondensedTitleBar surfaceShown={false} titleShown={false} back={back()} />);

        expect(container.querySelector('p')).toBeNull();
    });

    it('pads its top by the safe-area inset where the viewport covers it', () => {
        const { container } = render(<CondensedTitleBar title="Weeknight dinners" surfaceShown titleShown />);

        expect((container.firstElementChild as HTMLElement).className).toContain('env(safe-area-inset-top)');
    });

    it('takes its height from the one --pinned-bar-block property, never a rem literal of its own', () => {
        const { container } = render(<CondensedTitleBar title="Weeknight dinners" surfaceShown titleShown />);
        const { className } = container.firstElementChild as HTMLElement;

        expect(className).toContain('h-[var(--pinned-bar-block)]');
        expect(className).not.toContain('3.5rem');
    });

    it('names the parent beside the chevron from tablet width, for sight only: the accessible name stays whole', () => {
        render(<CondensedTitleBar surfaceShown titleShown back={back()} />);
        const control = screen.getByRole('button', { name: 'Back to Collections' });
        const parent = Array.from(control.querySelectorAll('span')).find((node) => node.textContent === 'Collections');

        expect(parent, 'the parent’s name is drawn inside the control').toBeDefined();
        // Hidden below `medium` (600), where only the chevron shows; shown from it, as native does.
        expect(parent?.className).toContain('hidden');
        expect(parent?.className).toContain('medium:inline');
        expect(parent?.getAttribute('aria-hidden')).toBe('true');
        // The control grows with its name, so it is a minimum, not a fixed square.
        expect(control.className).toContain('min-w-11');
        expect(control.className).not.toMatch(/(^|\s)size-11(\s|$)/u);
    });

    it('hands its element to barRef, so the frame can measure the rendered height', () => {
        const barRef = vi.fn();
        const { container } = render(<CondensedTitleBar surfaceShown titleShown barRef={barRef} />);

        expect(barRef).toHaveBeenCalledWith(container.firstElementChild);
    });
});
