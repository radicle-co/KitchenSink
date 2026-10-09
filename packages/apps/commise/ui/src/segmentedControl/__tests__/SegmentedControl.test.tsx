import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { SegmentedControl } from '../SegmentedControl.js';

/**
 * SegmentedControl (web) — spec §1.11: a `pearl` track, the selected segment `paper` with `shadow-sm` and an `ink` 600
 * label, the others `inkMuted`; 44 px tall; every segment the same width (`room`). A route is a `nav` of links, a view a
 * Radix `RadioGroup`.
 */

afterEach(cleanup);

const tokensOf = (element: Element): readonly string[] => element.className.split(/\s+/u);

const PLACES = [
    { id: 'mine', label: 'My recipes', href: '/en/recipes' },
    { id: 'collections', label: 'Collections', href: '/en/recipes/collections' },
] as const;

describe('SegmentedControl (web) — route', () => {
    it('is a nav of links named by its label, the current one aria-current="page"', () => {
        render(<SegmentedControl form="route" label="Recipes" segments={PLACES} current="mine" onSelect={vi.fn()} />);

        const nav = screen.getByRole('navigation', { name: 'Recipes' });
        const mine = within(nav).getByRole('link', { name: 'My recipes' });

        expect(mine.getAttribute('aria-current')).toBe('page');
        expect(mine.getAttribute('href')).toBe('/en/recipes');
        expect(within(nav).getByRole('link', { name: 'Collections' }).hasAttribute('aria-current')).toBe(false);
    });

    it('hands a plain click to onSelect and cancels the link’s own navigation', () => {
        const onSelect = vi.fn();
        render(<SegmentedControl form="route" label="Recipes" segments={PLACES} current="mine" onSelect={onSelect} />);

        const clicked = fireEvent.click(screen.getByRole('link', { name: 'Collections' }));

        expect(onSelect).toHaveBeenCalledWith('collections');
        expect(clicked).toBe(false);
    });

    it('leaves a modified click (a new tab) to the browser', () => {
        const onSelect = vi.fn();
        render(<SegmentedControl form="route" label="Recipes" segments={PLACES} current="mine" onSelect={onSelect} />);

        const clicked = fireEvent.click(screen.getByRole('link', { name: 'Collections' }), { metaKey: true });

        expect(onSelect).not.toHaveBeenCalled();
        expect(clicked).toBe(true);
    });

    it('draws a segment with no href as a button that still says it is current', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(
            <SegmentedControl
                form="route"
                label="Recipes"
                segments={[
                    { id: 'mine', label: 'My recipes' },
                    { id: 'collections', label: 'Collections' },
                ]}
                current="mine"
                onSelect={onSelect}
            />,
        );

        expect(screen.getByRole('button', { name: 'My recipes' }).getAttribute('aria-current')).toBe('page');

        await user.click(screen.getByRole('button', { name: 'Collections' }));

        expect(onSelect).toHaveBeenCalledWith('collections');
    });

    it('paints the current segment paper with a shadow and an ink 600 label, the rest inkMuted, on a pearl track', () => {
        render(<SegmentedControl form="route" label="Recipes" segments={PLACES} current="mine" onSelect={vi.fn()} />);

        expect(tokensOf(screen.getByRole('link', { name: 'My recipes' }))).toEqual(
            expect.arrayContaining(['bg-paper', 'shadow-sm', 'text-ink', 'font-semibold']),
        );
        expect(tokensOf(screen.getByRole('link', { name: 'Collections' }))).toEqual(
            expect.arrayContaining(['text-ink-muted', 'hover:text-ink']),
        );
        expect(tokensOf(screen.getByRole('link', { name: 'Collections' }))).not.toContain('bg-paper');
        expect(tokensOf(screen.getByRole('navigation', { name: 'Recipes' }).firstElementChild as Element)).toEqual(
            expect.arrayContaining(['bg-surface-muted', 'min-h-11', 'rounded-full']),
        );
    });

    it('gives every segment the same share of the track, and the focusRing', () => {
        render(<SegmentedControl form="route" label="Recipes" segments={PLACES} current="mine" onSelect={vi.fn()} />);

        for (const name of ['My recipes', 'Collections']) {
            expect(tokensOf(screen.getByRole('link', { name }))).toEqual(
                expect.arrayContaining(['flex-1', 'basis-0', 'focus-visible:ring-focus-ring']),
            );
        }
    });
});

const VIEWS = [
    { id: 'list', label: 'List view', icon: 'menu' },
    { id: 'grid', label: 'Grid view', icon: 'house' },
] as const;

function ViewSwitch() {
    const [value, setValue] = useState('list');

    return <SegmentedControl form="view" label="Layout" segments={VIEWS} value={value} onChange={setValue} />;
}

describe('SegmentedControl (web) — view', () => {
    it('is a radio group named by its label, the value checked', () => {
        render(<ViewSwitch />);

        const group = screen.getByRole('radiogroup', { name: 'Layout' });

        expect(within(group).getByRole('radio', { name: 'List view' }).getAttribute('aria-checked')).toBe('true');
        expect(within(group).getByRole('radio', { name: 'Grid view' }).getAttribute('aria-checked')).toBe('false');
    });

    it('switches on click and with the arrow keys', async () => {
        const user = userEvent.setup();
        render(<ViewSwitch />);

        await user.click(screen.getByRole('radio', { name: 'Grid view' }));
        expect(screen.getByRole('radio', { name: 'Grid view' }).getAttribute('aria-checked')).toBe('true');

        await user.keyboard('{ArrowLeft>}');
        await waitFor(() =>
            expect(screen.getByRole('radio', { name: 'List view' }).getAttribute('aria-checked')).toBe('true'),
        );
        await user.keyboard('{/ArrowLeft}');
    });

    it('draws a segment’s glyph before its label', () => {
        render(<ViewSwitch />);

        expect(screen.getByRole('radio', { name: 'List view' }).querySelector('svg.lucide-menu')).not.toBeNull();
    });

    it('paints the checked segment as the current one', () => {
        render(<ViewSwitch />);

        expect(tokensOf(screen.getByRole('radio', { name: 'List view' }))).toEqual(
            expect.arrayContaining(['bg-paper', 'shadow-sm', 'text-ink']),
        );
        expect(tokensOf(screen.getByRole('radio', { name: 'Grid view' }))).toContain('text-ink-muted');
    });
});
