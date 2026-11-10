/** `PrivateFoodNote` (native): the same two shapes, and neither is a control. */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { render } from '@commise/ui/testing/tamagui';

import { PrivateFoodNote } from '../PrivateFoodNote.native.js';

afterEach(cleanup);

describe('PrivateFoodNote (native)', () => {
    it('draws the attention text', () => {
        render(<PrivateFoodNote view={{ kind: 'attention', text: 'Private food. A public recipe can’t use it.' }} />);

        expect(screen.getByText('Private food. A public recipe can’t use it.')).toBeTruthy();
    });

    it('draws the quiet badge and no control', () => {
        render(<PrivateFoodNote view={{ kind: 'badge', text: 'Private food' }} />);

        expect(screen.getByText('Private food')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
