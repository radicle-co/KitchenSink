// @vitest-environment jsdom
/**
 * The notice a failed save of the library's grid/list choice shows (web). The view has already gone back to what it was,
 * so the notice says the choice was not kept, and it is an ALERT so a screen reader hears it without moving focus.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ViewSaveFailedNotice } from '../ViewSaveFailedNotice.js';

afterEach(cleanup);

describe('ViewSaveFailedNotice (web)', () => {
    it('announces that the choice was not saved, as an alert', () => {
        render(<ViewSaveFailedNotice />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t save your view. Try choosing it again.');
    });
});
