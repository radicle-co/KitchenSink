// @vitest-environment jsdom
/**
 * The web label-and-value pair: a label with its value beside it at the end of the line, or under it at the start when
 * the group's column (its `rows` container) has less than 17.5 rem of room (designer rulings 2026-11-01,
 * `nativeBoards/designAnswers.md`). 17.5 rem is native's LABEL_VALUE_MIN_ROOM (280) at the default 16 px, and a rem
 * follows the browser's text size.
 *
 * jsdom evaluates no container query, so these tests read the classes; `tailwindTheme.integration.test.ts` in the web
 * app proves the query compiles. The label is the caller's own element, a direct child, so it keeps its id and colour;
 * as a flex item its minimum width is its longest word, so it never breaks inside one. The value wraps anywhere and
 * never truncates.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LabelValuePair } from '../LabelValuePair.js';
import { LABEL_VALUE_MIN_ROOM } from '../model.js';

afterEach(cleanup);

const below = `@max-[${String(LABEL_VALUE_MIN_ROOM / 16)}rem]/rows:`;

function renderPair(): { readonly pair: HTMLElement; readonly label: HTMLElement; readonly value: HTMLElement } {
    render(<LabelValuePair label={<span className="text-ink">Display name</span>} value="Eliza" valueId="row-value" />);
    const label = screen.getByText('Display name');

    return { pair: label.parentElement as HTMLElement, label, value: screen.getByText('Eliza') };
}

describe('LabelValuePair (web)', () => {
    it('holds the caller’s label and the value as its two children, the value carrying its id', () => {
        const { pair, label, value } = renderPair();

        expect(Array.from(pair.children)).toEqual([label, value]);
        expect(value.id).toBe('row-value');
    });

    it('sets the value beside its label, at the end, 12 px apart, with room', () => {
        const { pair, value } = renderPair();

        expect(pair.className.split(' ')).toEqual(
            expect.arrayContaining(['flex', 'items-center', 'justify-between', 'gap-3']),
        );
        expect(value.className.split(' ')).toContain('text-end');
    });

    it('stacks the value under its label, at the start and 4 px apart, below 17.5 rem of room', () => {
        const { pair, value } = renderPair();

        expect(pair.className.split(' ')).toEqual(
            expect.arrayContaining([`${below}flex-col`, `${below}items-start`, `${below}gap-1`]),
        );
        expect(value.className.split(' ')).toContain(`${below}text-start`);
    });

    it('wraps the value anywhere and never truncates it', () => {
        const { value } = renderPair();
        const classes = value.className.split(' ');

        expect(classes).toEqual(expect.arrayContaining(['min-w-0', '[overflow-wrap:anywhere]', 'text-ink-muted']));
        expect(classes.filter((name) => /^(truncate|line-clamp-|max-w-)/u.test(name))).toEqual([]);
    });
});
