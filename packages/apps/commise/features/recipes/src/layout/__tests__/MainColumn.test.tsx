// @vitest-environment jsdom
/**
 * `MainColumn` (web): a content column that is its OWN `main` container. Below it, the `@regular/main:` variants (CSS)
 * and the container class a script reads (`MainElementContext`) both measure THIS box, so one screen uses one rule at one
 * window width. The editor needs it: a focused task's `<main>` has no gutter, so measuring `<main>` called a 572 px column
 * (620 px window less two 24 px gutters) `regular` while the food page, whose `<main>` is padded, called the same width
 * `narrow`.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { use, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { MainElementContext } from '@commise/ui/main-element';

import { MainColumn } from '../MainColumn.js';

afterEach(cleanup);

/** Draws the classes of the element the context holds. */
function Probe(): JSX.Element {
    return <output>{use(MainElementContext)?.className ?? 'none'}</output>;
}

describe('MainColumn', () => {
    it('is the main container, and keeps the classes it is given', () => {
        render(
            <MainColumn className="px-4 flex">
                <p>content</p>
            </MainColumn>,
        );
        const column = screen.getByText('content').parentElement as HTMLElement;

        expect(column.className.split(/\s+/u)).toEqual(expect.arrayContaining(['@container/main', 'px-4', 'flex']));
    });

    it('hands ITSELF to what it holds, over an outer shell main', () => {
        render(
            <MainElementContext value={document.body}>
                <MainColumn className="px-4">
                    <Probe />
                </MainColumn>
            </MainElementContext>,
        );

        // The body (the outer shell's value here) has no class; the column's own element does.
        expect(screen.getByRole('status').textContent).toBe('@container/main px-4');
    });
});
