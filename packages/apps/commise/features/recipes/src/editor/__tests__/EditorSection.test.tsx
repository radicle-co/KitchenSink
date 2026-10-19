/**
 * The web editor section's heading row (build spec §1.1, §7.1). At 320 CSS px with 200% zoom the H2 and its trailing
 * action are wider than the row: the row wraps so the action drops under the heading (a flex item never shrinks below
 * its longest word, so the heading breaks only between words).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EditorSection } from '../EditorSection';

afterEach(cleanup);

const renderSection = (): HTMLElement => {
    render(
        <EditorSection id="steps" title="Steps" action={<button type="button">Paste steps</button>} current={false}>
            <p>body</p>
        </EditorSection>,
    );

    const row = screen.getByRole('heading', { name: 'Steps' }).parentElement;

    if (row === null) {
        throw new Error('the heading has no row');
    }

    return row;
};

describe('EditorSection (web): the heading row at large text', () => {
    it('⛔ wraps, so the trailing action moves under the heading', () => {
        expect(renderSection().className).toContain('flex-wrap');
    });

    it('keeps the heading before its action', () => {
        const row = renderSection();

        expect(row.firstElementChild?.textContent).toBe('Steps');
        expect(row.lastElementChild?.textContent).toBe('Paste steps');
    });
});
