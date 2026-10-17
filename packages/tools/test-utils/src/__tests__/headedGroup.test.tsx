/**
 * `headedGroup` finds a native group through the header that names it (`docs/design/nativeContainerNames.md` N1):
 * the group is the header's container.
 */
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { headedGroup, queryHeadedGroup } from '../headedGroup.js';

afterEach(cleanup);

describe('headedGroup', () => {
    it('returns the container of the header that says the name', () => {
        render(
            <div>
                <div data-which="prep">
                    <h3>Prep time</h3>
                    <button type="button">Under 15 min</button>
                </div>
                <div data-which="cook">
                    <h3>Cook time</h3>
                    <button type="button">Under 30 min</button>
                </div>
            </div>,
        );

        const group = headedGroup('Cook time');

        expect(group.getAttribute('data-which')).toBe('cook');
        expect(within(group).getByRole('button').textContent).toBe('Under 30 min');
    });

    it('throws when no header says the name, and the query answers null', () => {
        render(
            <div aria-label="Cook time">
                <p>Cook time</p>
            </div>,
        );

        expect(() => headedGroup('Cook time')).toThrow();
        expect(queryHeadedGroup('Cook time')).toBeNull();
    });
});
