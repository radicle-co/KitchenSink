/**
 * The native `HeaderEyebrowBack` draws nothing: native has no eyebrow, and Back is the pinned bar's in every state
 * (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §4), so a second control here would be a duplicate with the same
 * accessible name. The leaf exists so the package export resolves on both platforms.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { HeaderEyebrowBack } from '../HeaderEyebrowBack.native.js';

afterEach(cleanup);

describe('HeaderEyebrowBack (native)', () => {
    it('renders no control at all', () => {
        const { container } = render(
            <HeaderEyebrowBack back={{ label: 'Back to Collections', parent: 'Collections', onPress: vi.fn() }} />,
        );

        expect(container.innerHTML).toBe('');
    });
});
