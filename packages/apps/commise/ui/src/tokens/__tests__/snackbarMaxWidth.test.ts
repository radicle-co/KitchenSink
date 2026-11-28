/**
 * The snackbar's maximum width reaches the web as ONE custom property, `--snackbar-max-width`, emitted from the same
 * number native sets as the bar's `maxWidth` (`snackbarMaxWidth`), so the two bars cannot be drawn at different widths
 * (owner ruling 2026-11-27). Written before the change.
 */
import { describe, expect, it } from 'vitest';

import { snackbarMaxWidth } from '../layout.js';
import { themeCss } from '../themeCss.js';

describe('--snackbar-max-width', () => {
    it('is emitted into the theme, and in rem it is exactly snackbarMaxWidth px', () => {
        const declared = /--snackbar-max-width: ([\d.]+)rem;/u.exec(themeCss());

        expect(declared, 'the theme declares --snackbar-max-width in rem').not.toBeNull();
        expect(Number(declared?.[1]) * 16).toBe(snackbarMaxWidth);
    });
});
