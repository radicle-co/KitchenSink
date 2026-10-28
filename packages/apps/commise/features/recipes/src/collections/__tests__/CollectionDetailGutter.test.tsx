// @vitest-environment jsdom
/** The web collection-detail gutter adds nothing: the page already pads its content. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { sideInsetOf } from '@commise/test-utils';
import { CollectionDetailGutter } from '../CollectionDetailGutter.js';

afterEach(cleanup);

describe('CollectionDetailGutter (web)', () => {
    it('passes its children through with no wrapper and no inset', () => {
        const { container } = render(
            <CollectionDetailGutter>
                <p>inside</p>
            </CollectionDetailGutter>,
        );

        expect(container.firstElementChild).toBe(screen.getByText('inside'));
        expect(sideInsetOf(screen.getByText('inside'))).toBe(0);
    });
});
