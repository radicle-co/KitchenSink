import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render as renderUnhosted, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import type { ReactElement } from 'react';

import { ScrollHost } from '../../scrollHost/ScrollHost.js';
import { SectionSwitch } from '../SectionSwitch.js';

/**
 * The web `SectionSwitch` (build spec §6.2): a `nav` named "Recipe sections" of real `#id` links, the current one
 * marked `aria-current="location"`, and one optional trailing control. A press jumps through the screen's ONE scroll
 * host (`useScrollHost().scrollToSection`, blueprint A7): the section's heading under the sticky chrome — instantly
 * under reduced motion — focus on it, and the hash recorded without a history entry. The switch holds no jump of its
 * own, so these tests render it inside a real `ScrollHost`.
 *
 * ⚠️ REWRITTEN when the switch's own `jumpToSection` was deleted for the host's: the behaviour asserted is the same,
 * now reached through the host.
 *
 * ⚠️ REWRITTEN AGAIN (code-reviewer High 4, 2026-10-09): the host records the hash with a `null` state, not the current
 * `history.state`. Passing the state carried Next's internal `__NA` flag, so Next skipped its router sync, never learned
 * the hash, and its next commit rewrote the URL without it. The press must therefore leave the state `null`; the host's
 * own test (`ScrollHost.test.tsx`) pins the same contract from the other side.
 */

/** The switch inside its screen's scroll host, as every page mounts it. */
const render = (ui: ReactElement): ReturnType<typeof renderUnhosted> => renderUnhosted(<ScrollHost>{ui}</ScrollHost>);

const SECTIONS = [
    { id: 'ingredients', label: 'Ingredients' },
    { id: 'steps', label: 'Steps' },
    { id: 'nutrition', label: 'Nutrition' },
] as const;

let reduceMotion = false;

beforeEach(() => {
    reduceMotion = false;
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') && reduceMotion }));
    Element.prototype.scrollIntoView = vi.fn();
    document.body.insertAdjacentHTML('beforeend', '<h2 id="steps" tabindex="-1">Steps</h2>');
});

afterEach(() => {
    cleanup();
    document.getElementById('steps')?.remove();
    vi.unstubAllGlobals();
});

describe('SectionSwitch (web)', () => {
    it('is a navigation of links to each section', () => {
        render(<SectionSwitch label="Recipe sections" sections={SECTIONS} />);

        const nav = screen.getByRole('navigation', { name: 'Recipe sections' });

        expect(within(nav).getByRole('link', { name: 'Steps' }).getAttribute('href')).toBe('#steps');
        expect(within(nav).getAllByRole('link')).toHaveLength(3);
    });

    it('marks the current section, and only it', () => {
        render(<SectionSwitch label="Recipe sections" sections={SECTIONS} currentId="steps" />);

        expect(screen.getByRole('link', { name: 'Steps' }).getAttribute('aria-current')).toBe('location');
        expect(screen.getByRole('link', { name: 'Ingredients' }).getAttribute('aria-current')).toBeNull();
    });

    it('a press scrolls the heading into view smoothly, focuses it, and replaces the hash', () => {
        window.history.replaceState({ __NA: true }, '');
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const onJump = vi.fn();
        render(<SectionSwitch label="Recipe sections" sections={SECTIONS} onJump={onJump} />);

        fireEvent.click(screen.getByRole('link', { name: 'Steps' }));

        const heading = document.getElementById('steps');
        expect(heading?.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
        expect(document.activeElement).toBe(heading);
        expect(replaceState).toHaveBeenCalledWith(null, '', '#steps');
        expect(onJump).toHaveBeenCalledWith('steps');
    });

    it('jumps instantly under reduced motion', () => {
        reduceMotion = true;
        render(<SectionSwitch label="Recipe sections" sections={SECTIONS} />);

        fireEvent.click(screen.getByRole('link', { name: 'Steps' }));

        expect(document.getElementById('steps')?.scrollIntoView).toHaveBeenCalledWith({
            behavior: 'auto',
            block: 'start',
        });
    });

    it('needs a scroll host: a switch with no scroller to move is a wiring defect, not a dead link', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => renderUnhosted(<SectionSwitch label="Recipe sections" sections={SECTIONS} />)).toThrow(
            /ScrollHost/,
        );
    });

    it('holds one trailing control after the links', () => {
        render(
            <SectionSwitch
                label="Recipe sections"
                sections={SECTIONS}
                trailing={
                    <button type="button" role="switch" aria-checked={false}>
                        Screen on
                    </button>
                }
            />,
        );

        const nav = screen.getByRole('navigation', { name: 'Recipe sections' });

        expect(within(nav.parentElement as HTMLElement).getByRole('switch', { name: 'Screen on' })).not.toBeNull();
    });

    /**
     * F14 (`evaluateFinal.md`): at 320 the links shrank under the trailing toggle, which covered "Nutrition" (SC 2.5.8),
     * and +35% strings pushed the bar 47 px past the page (SC 1.4.10). The links scroll INSIDE the bar, each at its
     * label's width, and the trailing toggle stays pinned at the end, outside the scroller.
     */
    it('scrolls its links inside the bar, never squeezing them, and pins the trailing control outside the scroller', () => {
        render(
            <SectionSwitch
                label="Recipe sections"
                sections={SECTIONS}
                trailing={
                    <button type="button" role="switch" aria-checked={false}>
                        Screen on
                    </button>
                }
            />,
        );

        const nav = screen.getByRole('navigation', { name: 'Recipe sections' });
        const toggle = screen.getByRole('switch', { name: 'Screen on' });

        expect(nav.className.split(' ')).toEqual(expect.arrayContaining(['min-w-0', 'flex-1', 'overflow-x-auto']));

        for (const link of within(nav).getAllByRole('link')) {
            expect((link.closest('li') as HTMLElement).className.split(' ')).toContain('shrink-0');
        }

        expect(nav.contains(toggle)).toBe(false);
        expect((toggle.parentElement as HTMLElement).className.split(' ')).toContain('shrink-0');
    });

    // A link the bar's own scroll has half hidden is scrolled whole into the bar when it takes focus; a browser only
    // scrolls a focused element that is entirely out of view (F14).
    it('scrolls a focused link whole into the bar', () => {
        render(<SectionSwitch label="Recipe sections" sections={SECTIONS} />);
        const link = screen.getByRole('link', { name: 'Nutrition' });
        const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
        scrollIntoView.mockClear();

        link.focus();

        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
        expect(scrollIntoView.mock.contexts[0]).toBe(link);
    });
});
