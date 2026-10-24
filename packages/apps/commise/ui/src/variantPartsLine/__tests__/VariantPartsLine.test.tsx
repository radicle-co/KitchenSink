/**
 * VariantPartsLine (web) — a variant's parts on one line with a middle dot between them
 * (`docs/design/ingredientSpecialization.md` §S4).
 *
 * The rules each prevent a class of defect on every surface at once: the parts keep wire order, no comma shows on
 * screen while a screen reader hears commas, a dot never starts a line, a measurement token never breaks at its
 * hyphen, each part is marked English, and nothing is ever truncated.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { VariantPartsLineProps } from '../props.js';
import { VariantPartsLine } from '../VariantPartsLine.js';

afterEach(cleanup);

/** Brisket's parts in wire order. Sorted, they would read differently, so a sort cannot pass unseen. */
const BRISKET = ['flat half', 'separable lean and fat', '1/8-inch trim', 'select', 'braised'] as const;

/** Render one line and return its root element. */
function renderLine(props: VariantPartsLineProps): HTMLElement {
    const line = render(<VariantPartsLine {...props} />).container.firstElementChild;

    if (!(line instanceof HTMLElement)) {
        throw new Error('the line rendered no element');
    }

    return line;
}

/** The text a sighted reader sees: every node except the visually hidden ones. Pure over the DOM it reads. */
function visibleText(element: Element): string {
    return [...element.childNodes]
        .map((node) => {
            if (node instanceof Element) {
                return node.classList.contains('sr-only') ? '' : visibleText(node);
            }

            return node.textContent ?? '';
        })
        .join('');
}

/** Whether a class list truncates or clamps text. Pure. */
function truncates(className: string): boolean {
    return /(?:^|\s)(?:truncate|line-clamp-\S+|text-ellipsis|overflow-hidden|max-h-\S+)(?=\s|$)/u.test(className);
}

describe('VariantPartsLine (web)', () => {
    it('shows every part in wire order with a middle dot between them, and no comma', () => {
        const shown = visibleText(renderLine({ parts: BRISKET, tone: 'secondary' }));

        // Positive control: the visible text is the parts, in order, dot-separated.
        expect(shown).toBe('flat half\u00A0· separable lean and fat\u00A0· 1/8-inch trim\u00A0· select\u00A0· braised');
        expect(shown).not.toContain(',');
    });

    it('puts a no-break space before every dot, inside the hidden span, so a dot never starts a line', () => {
        const dots = renderLine({ parts: BRISKET, tone: 'secondary' }).querySelectorAll('[aria-hidden="true"]');

        expect(dots).toHaveLength(BRISKET.length - 1);

        for (const dot of dots) {
            expect(dot.textContent).toBe('\u00A0\u00B7');
            // The dot takes the text colour: `mist` is 1.90:1 and the dot does the separating.
            expect(dot.className).toBe('');
        }
    });

    it('is heard with commas between the parts', () => {
        render(
            <div role="option" aria-selected="false">
                <VariantPartsLine parts={BRISKET} tone="primary" />
            </div>,
        );

        // A browser lays the hidden comma out as a block and hears `flat half , select` (measured in Chromium,
        // 2026-09-30); jsdom does no layout. The space before a comma is not audible, so it is folded away here.
        const heard = (name: string): boolean =>
            name.replace(/\s+,/gu, ',') === 'flat half, separable lean and fat, 1/8-inch trim, select, braised';

        expect(screen.getByRole('option', { name: heard })).toBeDefined();
    });

    it('shows one part with no separator, and hides no comma for it', () => {
        const line = renderLine({ parts: ['whole'], tone: 'secondary' });

        expect(line.textContent).toBe('whole');
        expect(line.querySelector('[aria-hidden="true"]')).toBeNull();
        expect(line.querySelector('.sr-only')).toBeNull();
    });

    it('shows an unknown attribute’s label in its wire position', () => {
        expect(visibleText(renderLine({ parts: ['flat half', 'dry-aged 28 days', 'select'], tone: 'secondary' }))).toBe(
            'flat half\u00A0· dry-aged 28 days\u00A0· select',
        );
    });

    it('keeps a measurement token on one line and lets every other word wrap', () => {
        const unbreakable = [
            ...renderLine({ parts: ['chocolate-flavored', '1/8-inch trim'], tone: 'secondary' }).querySelectorAll(
                '.whitespace-nowrap',
            ),
        ].map((span) => span.textContent);

        expect(unbreakable).toStrictEqual(['1/8-inch']);
    });

    it('marks each part as English', () => {
        const marked = [...renderLine({ parts: BRISKET, tone: 'secondary' }).querySelectorAll('[lang="en"]')].map(
            (span) => span.textContent,
        );

        expect(marked).toStrictEqual([...BRISKET]);
    });

    /**
     * E2 I8 — rewritten to prove `break-words`, where it used to pin `wrap-anywhere`. `overflow-wrap: anywhere` counts
     * every character as a break point when the browser sizes the line, so in a flex row with no `min-w-0` the host
     * column shrank to 71 px. Then the no-break space before a dot broke, and a dot started a line (`boneless` / `·`).
     * `break-word` breaks an unbroken string only when it overflows, and does not lower the line's minimum width, so
     * the column cannot collapse under a word. A primitive must survive hosts it does not know.
     */
    it('never truncates, and breaks an unbroken string only when it overflows, without shrinking its host', () => {
        // Positive control: the check sees a clamp and a truncation.
        expect(truncates('block line-clamp-2')).toBe(true);
        expect(truncates('truncate text-ink-muted')).toBe(true);

        const line = renderLine({ parts: BRISKET, tone: 'secondary' });

        for (const element of [line, ...line.querySelectorAll('*')]) {
            expect(truncates(element.className)).toBe(false);
            // `anywhere` lowers the min-content width, which is what let a host column collapse.
            expect(element.className).not.toContain('wrap-anywhere');
        }

        expect(line.className).toContain('break-words');
        expect(line.className).not.toContain('whitespace-nowrap');
    });

    it('reads as secondary text under a name, and as primary text in a dialog row', () => {
        const secondary = renderLine({ parts: ['flat half'], tone: 'secondary' }).className;
        const primary = renderLine({ parts: ['point end'], tone: 'primary' }).className;

        expect(secondary).toContain('text-body-sm');
        expect(secondary).toContain('text-ink-muted');
        expect(primary).toContain('text-body-md');
        expect(primary).toContain('text-ink');
        expect(secondary.split(/\s+/u)).not.toContain('text-ink');
        expect(primary.split(/\s+/u)).not.toContain('text-ink-muted');
    });
});
