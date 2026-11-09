// @vitest-environment jsdom
/** `PrivateFoodNote` (web): the attention line in a public recipe, the quiet badge in a private one. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PrivateFoodNote } from '../PrivateFoodNote.js';

afterEach(cleanup);

describe('PrivateFoodNote (web)', () => {
    it('draws the attention text, with a lock, in the attention colour', () => {
        const { container } = render(
            <PrivateFoodNote view={{ kind: 'attention', text: 'Private food. A public recipe can’t use it.' }} />,
        );

        expect(screen.getByText('Private food. A public recipe can’t use it.').parentElement?.className).toContain(
            'text-attention',
        );
        expect(container.querySelector('svg')).not.toBeNull();
    });

    it('draws the quiet badge for a private recipe, and is not a control', () => {
        render(<PrivateFoodNote view={{ kind: 'badge', text: 'Private food' }} />);

        expect(screen.getByText('Private food')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });
});
