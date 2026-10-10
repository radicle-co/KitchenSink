/**
 * The web `SectionIndex` (build spec §7.2, §7.10): one data model drawn as a rail (`@wide`), a strip (`@regular`) and a
 * bar that opens a sheet (`@narrow`).
 *
 * ⚠️ jsdom evaluates no container query, so all three presentations are in the DOM here and every test scopes itself
 * to one with `within`: the two `nav`s share their name by design (only one is ever displayed), rail first. Which one
 * shows at which width is CSS, read by the browser; this suite pins the class that decides it, not the result.
 *
 * The jump goes through the screen's `ScrollHost`, injected through its context with a spy, so the ORDER of the sheet
 * closing, the jump and `onJump` is observable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';

import type { ScrollHostApi, ScrollTarget } from '../../scrollHost/props.js';
import { ScrollHostContext } from '../../scrollHost/scrollHostContext.js';
import type { SectionIndexItem, SectionIndexProps } from '../props.js';
import { SectionIndex } from '../SectionIndex.js';

afterEach(cleanup);

const ITEMS: readonly SectionIndexItem[] = [
    { id: 'details', label: 'Details', tone: 'complete' },
    {
        id: 'ingredients',
        label: 'Ingredients',
        tone: 'attention',
        reason: '2 need a match',
        count: 2,
        hint: 'Add what goes in',
    },
    { id: 'steps', label: 'Steps', tone: 'muted', reason: 'Not started' },
    { id: 'photos', label: 'Photos & publish', shortLabel: 'Photos', tone: 'fix', reason: 'Fix 1 thing', count: 1 },
];

const NAV = 'Recipe sections';
const BAR_NAME = 'Sections. Current: Ingredients. 3 need attention.';

/** A host whose `scrollToSection` is a spy; everything else is inert. */
function fakeHost(scrollToSection: (id: string) => void): ScrollHostApi {
    return {
        condensed: false,
        scrollingDown: false,
        atTop: true,
        current: undefined,
        onCurrentChange: () => () => undefined,
        viewportsDown: 0,
        pageViewports: 1,
        scrollToTop: () => undefined,
        scrollToSection,
        headingLayout: () => undefined,
        sectionLayout: () => () => undefined,
        handle: createRef<ScrollTarget | null>(),
    };
}

function renderIndex(overrides: Partial<SectionIndexProps> = {}, scrollToSection = vi.fn()) {
    const onJump = vi.fn();
    const utils = render(
        <ScrollHostContext.Provider value={fakeHost(scrollToSection)}>
            <SectionIndex
                label={NAV}
                sheetTitle="Sections"
                sheetCloseLabel="Close sections"
                items={ITEMS}
                currentId="ingredients"
                barName={BAR_NAME}
                barCount="⚠ 3"
                onJump={onJump}
                {...overrides}
            />
        </ScrollHostContext.Provider>,
    );

    return { ...utils, onJump, scrollToSection };
}

/** The rail and the strip: the two `nav`s, in DOM order. */
function navs(): { readonly rail: HTMLElement; readonly strip: HTMLElement } {
    const [rail, strip] = screen.getAllByRole('navigation', { name: NAV });

    if (rail === undefined || strip === undefined) {
        throw new Error('Expected the rail and the strip.');
    }

    return { rail, strip };
}

/** The text an element's `aria-describedby` points at, joined. Throws when a target does not resolve. */
function descriptionOf(element: HTMLElement): string {
    const ids = (element.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '');

    return ids
        .map((id) => {
            const target = document.getElementById(id);

            if (target === null) {
                throw new Error(`aria-describedby target #${id} does not exist`);
            }

            return target.textContent;
        })
        .join(' ');
}

/** The classes of the status line a piece of reason text sits in (the element its row's description points at). */
function toneOf(text: HTMLElement): string[] {
    return (text.closest('[id]')?.className ?? '').split(' ');
}

function hasGlyph(element: HTMLElement, glyph: 'check' | 'triangle-alert'): boolean {
    return element.querySelector(`svg.lucide-${glyph}`) !== null;
}

describe('SectionIndex (web)', () => {
    describe('presentations', () => {
        it('shows the rail only at @wide, the strip only at @regular, the bar only below it', () => {
            renderIndex();
            const { rail, strip } = navs();
            const bar = screen.getByRole('button', { name: BAR_NAME }).parentElement as HTMLElement;

            expect(rail.className.split(' ')).toEqual(expect.arrayContaining(['hidden', '@wide/main:flex']));
            expect(strip.className.split(' ')).toEqual(
                expect.arrayContaining(['hidden', '@regular/main:block', '@wide/main:hidden']),
            );
            expect(bar.className.split(' ')).toEqual(expect.arrayContaining(['@regular/main:hidden']));
        });

        it('never repeats an element id across the three presentations, and every description resolves', () => {
            const { container } = renderIndex();
            const ids = [...container.querySelectorAll('[id]')].map((element) => element.id);

            expect(ids.length).toBeGreaterThan(0);
            expect(new Set(ids).size).toBe(ids.length);

            for (const described of container.querySelectorAll<HTMLElement>('[aria-describedby]')) {
                expect(() => descriptionOf(described)).not.toThrow();
            }
        });
    });

    describe('rail', () => {
        it('is an ordered list of links to each section, each named by its label alone', () => {
            renderIndex();
            const { rail } = navs();
            const list = within(rail).getByRole('list');

            expect(list.tagName).toBe('OL');
            expect(
                within(list)
                    .getAllByRole('link')
                    .map((link) => link.getAttribute('href')),
            ).toEqual(['#details', '#ingredients', '#steps', '#photos']);
            // The reason, the hint and the count sit inside the row but never join its name.
            expect(within(rail).getByRole('link', { name: 'Ingredients' })).toBeDefined();
            expect(within(rail).getByRole('link', { name: 'Photos & publish' })).toBeDefined();
        });

        it('describes each row by its reason and hint, in the tone’s role colour, with the tone’s glyph', () => {
            renderIndex();
            const { rail } = navs();
            const details = within(rail).getByRole('link', { name: 'Details' });
            const ingredients = within(rail).getByRole('link', { name: 'Ingredients' });
            const steps = within(rail).getByRole('link', { name: 'Steps' });
            const photos = within(rail).getByRole('link', { name: 'Photos & publish' });

            expect(hasGlyph(details, 'check')).toBe(true);
            expect(details.getAttribute('aria-describedby')).toBeNull();

            expect(descriptionOf(ingredients)).toBe('2 need a match Add what goes in');
            expect(hasGlyph(ingredients, 'triangle-alert')).toBe(true);
            expect(toneOf(within(ingredients).getByText('2 need a match'))).toContain('text-attention');
            expect(within(ingredients).getByText('Add what goes in')).toBeDefined();

            expect(descriptionOf(steps)).toBe('Not started');
            expect(hasGlyph(steps, 'check') || hasGlyph(steps, 'triangle-alert')).toBe(false);
            expect(toneOf(within(steps).getByText('Not started'))).toContain('text-ink-muted');

            expect(descriptionOf(photos)).toBe('Fix 1 thing');
            expect(hasGlyph(photos, 'triangle-alert')).toBe(true);
            expect(toneOf(within(photos).getByText('Fix 1 thing'))).toContain('text-danger-text');
        });

        it('gives a quiet complete row its spoken status, out of sight, linked as its description', () => {
            renderIndex({ items: [{ id: 'details', label: 'Details', tone: 'complete', spokenStatus: 'Complete' }] });

            for (const link of screen.getAllByRole('link', { name: 'Details', hidden: true })) {
                const describedBy = link.getAttribute('aria-describedby') ?? '';

                expect(describedBy).not.toBe('');
                expect(document.getElementById(describedBy)?.textContent).toBe('Complete');
                expect(document.getElementById(describedBy)?.className).toContain('sr-only');
            }
        });

        it('shows a complete row’s reason in ink', () => {
            renderIndex({
                items: [{ id: 'photos', label: 'Photos & publish', tone: 'complete', reason: 'Ready to publish' }],
            });
            const { rail } = navs();
            const reason = within(rail).getByText('Ready to publish');

            expect(toneOf(reason)).toContain('text-ink');
            expect(hasGlyph(within(rail).getByRole('link', { name: 'Photos & publish' }), 'check')).toBe(true);
        });

        it('marks the current row, and only it, with aria-current and the here bar', () => {
            renderIndex();
            const { rail } = navs();
            const current = within(rail).getByRole('link', { name: 'Ingredients' });

            expect(current.getAttribute('aria-current')).toBe('location');
            expect(current.querySelector('.bg-here-bar')).not.toBeNull();

            for (const name of ['Details', 'Steps', 'Photos & publish']) {
                const other = within(rail).getByRole('link', { name });
                expect(other.getAttribute('aria-current')).toBeNull();
                expect(other.querySelector('.bg-here-bar')).toBeNull();
            }
        });

        it('holds the footer at its foot, and the rows are at least 48 px', () => {
            renderIndex({ railFooter: <p>612 cal per serving</p> });
            const { rail, strip } = navs();

            expect(within(rail).getByText('612 cal per serving')).toBeDefined();
            expect(within(strip).queryByText('612 cal per serving')).toBeNull();
            expect(within(rail).getByRole('link', { name: 'Steps' }).className).toContain('min-h-12');
        });

        it('jumps through the scroll host and reports the jump, keeping the link from navigating', () => {
            const { scrollToSection, onJump } = renderIndex();
            const { rail } = navs();

            const notPrevented = fireEvent.click(within(rail).getByRole('link', { name: 'Steps' }));

            expect(notPrevented).toBe(false);
            expect(scrollToSection).toHaveBeenCalledWith('steps');
            expect(onJump).toHaveBeenCalledWith('steps');
            expect(scrollToSection.mock.invocationCallOrder[0]).toBeLessThan(onJump.mock.invocationCallOrder[0] ?? 0);
        });
    });

    /**
     * The strip and the phone bar stick under the header, so a page keeping popups clear of its chrome must find them.
     * `stickyId` names each, apart, because only one shows at a width and an id names one element.
     */
    describe('sticky boxes', () => {
        it('names the strip and the phone bar from `stickyId`, so the page can measure them', () => {
            renderIndex({ stickyId: 'index' });
            const { strip } = navs();
            const bar = screen.getByRole('button', { name: BAR_NAME });

            expect(strip.id).toBe('index-strip');
            expect(bar.closest('#index-bar')).not.toBeNull();
        });

        it('draws neither while the page says its bars are past the limit, and keeps the rail', () => {
            renderIndex({ narrowHidden: true });

            expect(screen.getAllByRole('navigation', { name: NAV })).toHaveLength(1);
            expect(screen.queryByRole('button', { name: BAR_NAME })).toBeNull();
        });

        it('names nothing without one', () => {
            renderIndex();

            expect(navs().strip.id).toBe('');
            expect(document.getElementById('undefined-bar')).toBeNull();
        });
    });

    describe('strip', () => {
        it('shows the short label but names the link by the full label, with the count and glyph beside it', () => {
            renderIndex();
            const { strip } = navs();
            const photos = within(strip).getByRole('link', { name: 'Photos & publish' });
            const ingredients = within(strip).getByRole('link', { name: 'Ingredients' });

            expect(within(photos).getByText('Photos')).toBeDefined();
            expect(within(photos).getByText('1')).toBeDefined();
            expect(hasGlyph(photos, 'triangle-alert')).toBe(true);
            expect(within(ingredients).getByText('2')).toBeDefined();
            expect(hasGlyph(within(strip).getByRole('link', { name: 'Details' }), 'check')).toBe(true);
            // Muted shows nothing in the strip.
            const steps = within(strip).getByRole('link', { name: 'Steps' });
            expect(hasGlyph(steps, 'check') || hasGlyph(steps, 'triangle-alert')).toBe(false);
        });

        it('carries each reason as screen-reader text linked by aria-describedby, and no hint', () => {
            renderIndex();
            const { strip } = navs();

            expect(descriptionOf(within(strip).getByRole('link', { name: 'Ingredients' }))).toBe('2 need a match');
            expect(within(strip).getByText('2 need a match').className).toContain('sr-only');
            expect(within(strip).queryByText('Add what goes in')).toBeNull();
        });

        it('marks only the current item, and its items are 44 px tall', () => {
            renderIndex({ currentId: 'steps' });
            const { strip } = navs();

            expect(within(strip).getByRole('link', { name: 'Steps' }).getAttribute('aria-current')).toBe('location');
            expect(within(strip).getByRole('link', { name: 'Ingredients' }).getAttribute('aria-current')).toBeNull();
            expect(within(strip).getByRole('link', { name: 'Steps' }).className).toContain('min-h-11');
        });

        it('jumps through the scroll host', () => {
            const { scrollToSection, onJump } = renderIndex();

            expect(fireEvent.click(within(navs().strip).getByRole('link', { name: 'Details' }))).toBe(false);
            expect(scrollToSection).toHaveBeenCalledWith('details');
            expect(onJump).toHaveBeenCalledWith('details');
        });
    });

    describe('bar and sheet', () => {
        it('is one button that names the whole index and opens a dialog', () => {
            renderIndex({ barSuffix: ' · 1 of 4 done' });
            const bar = screen.getByRole('button', { name: BAR_NAME });

            expect(bar.getAttribute('aria-expanded')).toBe('false');
            expect(bar.getAttribute('aria-haspopup')).toBe('dialog');
            expect(within(bar).getByText('Ingredients')).toBeDefined();
            expect(within(bar).getByText('· 1 of 4 done', { exact: false })).toBeDefined();
            expect(within(bar).getByText('⚠ 3').getAttribute('aria-hidden')).toBe('true');
        });

        it('shows the first section when no section is current', () => {
            renderIndex({ currentId: undefined });

            expect(within(screen.getByRole('button', { name: BAR_NAME })).getByText('Details')).toBeDefined();
        });

        it('draws a hidden four-segment progress line in the tones’ roles', () => {
            renderIndex();
            const line = screen.getByRole('button', { name: BAR_NAME }).nextElementSibling as HTMLElement;
            const segments = [...line.children].map((segment) => segment.className);

            expect(line.getAttribute('aria-hidden')).toBe('true');
            expect(segments).toHaveLength(4);
            expect(segments[0]).toContain('bg-action');
            expect(segments[1]).toContain('bg-attention-tint');
            expect(segments[1]).toContain('border-attention');
            expect(segments[2]).toContain('bg-surface-muted');
            expect(segments[3]).toContain('bg-attention-tint');
        });

        it('opens the sheet with every section, the current one marked, each described by its reason', async () => {
            const user = userEvent.setup();
            renderIndex();
            const bar = screen.getByRole('button', { name: BAR_NAME });

            await user.click(bar);

            const sheet = screen.getByRole('dialog', { name: 'Sections' });
            // With the sheet open all four id-bearing presentations are in the DOM at once.
            const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
            expect(new Set(ids).size).toBe(ids.length);
            expect(bar.getAttribute('aria-expanded')).toBe('true');
            expect(within(sheet).getAllByRole('link')).toHaveLength(4);
            const ingredients = within(sheet).getByRole('link', { name: 'Ingredients' });
            expect(ingredients.getAttribute('aria-current')).toBe('location');
            expect(descriptionOf(ingredients)).toBe('2 need a match Add what goes in');
            expect(within(sheet).getByRole('link', { name: 'Steps' }).getAttribute('aria-current')).toBeNull();
            expect(within(sheet).getByRole('link', { name: 'Steps' }).className).toContain('min-h-14');
        });

        it('closes the sheet BEFORE it jumps, then reports the jump', async () => {
            const user = userEvent.setup();
            const seen: string[] = [];
            document.body.insertAdjacentHTML('beforeend', '<h2 id="steps" tabindex="-1">Steps</h2>');
            // The real host focuses the heading; the sheet must not take that focus back to the bar afterwards.
            const scrollToSection = vi.fn((id: string) => {
                seen.push(`jump ${id}, sheet ${screen.queryByRole('dialog') === null ? 'closed' : 'open'}`);
                document.getElementById(id)?.focus();
            });
            const { onJump } = renderIndex({}, scrollToSection);
            onJump.mockImplementation((id: string) => seen.push(`onJump ${id}`));

            await user.click(screen.getByRole('button', { name: BAR_NAME }));
            await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Steps' }));

            expect(seen).toEqual(['jump steps, sheet closed', 'onJump steps']);
            expect(screen.getByRole('button', { name: BAR_NAME }).getAttribute('aria-expanded')).toBe('false');
            expect(document.activeElement).toBe(document.getElementById('steps'));
            document.getElementById('steps')?.remove();
        });

        it('closes on Escape without jumping', async () => {
            const user = userEvent.setup();
            const { scrollToSection, onJump } = renderIndex();

            await user.click(screen.getByRole('button', { name: BAR_NAME }));
            await user.keyboard('{Escape}');

            expect(screen.queryByRole('dialog')).toBeNull();
            expect(scrollToSection).not.toHaveBeenCalled();
            expect(onJump).not.toHaveBeenCalled();
        });
    });
});
