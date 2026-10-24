/**
 * Shared assertions for a web page that sits in the design system's `PushedPageFrame`
 * (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §6).
 *
 * Such a page carries its Back twice on purpose: once in the pinned bar, which is `nav:hidden` (shown below 840), and once
 * as the header's eyebrow, which is `hidden nav:inline-flex` (shown from 840). jsdom applies no stylesheet, so both are in
 * its tree and the breakpoint can only be asserted through the classes that carry it. A browser shows exactly one at each
 * width; the Playwright specs assert that.
 */
import { screen } from '@testing-library/react';
import { expect } from 'vitest';

/** The two Back controls of a framed page, after their structure and breakpoint classes have been asserted. */
export interface FramedBack {
    /** The bar's Back. */
    readonly bar: HTMLElement;
    /** The header's eyebrow Back. */
    readonly eyebrow: HTMLElement;
}

const classesOf = (element: Element): string[] => element.className.split(/\s+/u);

/**
 * Asserts the page has one Back in the pinned bar (gone from 840) and one in the header (hidden below 840), both named
 * `name`, and returns them.
 *
 * @param name - The Back's accessible name ("Back to recipe").
 * @returns The two controls.
 */
export function expectOneBackInBarAndOneInHeader(name: string): FramedBack {
    const all = screen.getAllByRole('link', { name, hidden: true });
    const bar = all.filter((link) => link.closest('[data-condensed]') !== null);
    const eyebrow = all.filter((link) => link.closest('[data-condensed]') === null);

    expect(bar).toHaveLength(1);
    expect(eyebrow).toHaveLength(1);
    expect(classesOf((bar[0] as HTMLElement).closest('[data-condensed]') as Element)).toContain('nav:hidden');
    expect(classesOf(eyebrow[0] as HTMLElement)).toEqual(expect.arrayContaining(['hidden', 'nav:inline-flex']));

    return { bar: bar[0] as HTMLElement, eyebrow: eyebrow[0] as HTMLElement };
}
