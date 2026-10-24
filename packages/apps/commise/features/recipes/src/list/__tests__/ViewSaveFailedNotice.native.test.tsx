/**
 * The notice a failed save of the library's grid/list choice shows (native, react-native-web under jsdom). Mirrors
 * `ViewSaveFailedNotice.test.tsx`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ViewSaveFailedNotice } from '../ViewSaveFailedNotice.native.js';

afterEach(cleanup);

describe('ViewSaveFailedNotice (native)', () => {
    it('announces that the choice was not saved, as an alert', () => {
        render(<ViewSaveFailedNotice />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t save your view. Try choosing it again.');
    });
});
