/**
 * The native collection-detail gutter pads what it holds 16 pt a side, and the failure line inside it adds none of its
 * own (it used to pad itself AND sit in the screen's padding, so it started at 32).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { sideInsetOf } from '@commise/test-utils';
import { CollectionDetailAlert } from '../CollectionDetailAlert.js';
import { CollectionDetailGutter } from '../CollectionDetailGutter.js';

afterEach(cleanup);

describe('CollectionDetailGutter (native)', () => {
    it('pads its children 16 pt from the edge', () => {
        render(
            <CollectionDetailGutter>
                <p>inside</p>
            </CollectionDetailGutter>,
        );

        expect(sideInsetOf(screen.getByText('inside'))).toBe(16);
    });

    it('puts a failure line at 16, once', () => {
        render(
            <CollectionDetailGutter>
                <CollectionDetailAlert text="We couldn’t make this private." />
            </CollectionDetailGutter>,
        );

        expect(sideInsetOf(screen.getByRole('alert'))).toBe(16);
        expect(getComputedStyle(screen.getByRole('alert')).paddingLeft).not.toBe('16px');
    });
});
