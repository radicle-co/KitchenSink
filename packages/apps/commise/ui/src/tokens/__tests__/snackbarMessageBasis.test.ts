/**
 * The snackbar's message basis reaches the web as ONE custom property, `--snackbar-message-basis`, emitted from the
 * same number native multiplies by the system text size (`snackbarMessageBasis`), so the two bars cannot ask for
 * different room beside Undo. Written before the change.
 */
import { describe, expect, it } from 'vitest';

import { snackbarMessageBasis } from '../layout.js';
import { themeCss } from '../themeCss.js';

describe('--snackbar-message-basis', () => {
    it('is emitted into the theme, and in rem it is exactly snackbarMessageBasis px', () => {
        const declared = /--snackbar-message-basis: ([\d.]+)rem;/u.exec(themeCss());

        expect(declared, 'the theme declares --snackbar-message-basis in rem').not.toBeNull();
        expect(Number(declared?.[1]) * 16).toBe(snackbarMessageBasis);
    });
});
