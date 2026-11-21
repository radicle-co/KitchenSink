/**
 * Fitness function for the scale note props: the note, its open label, and an optional open command, nothing else.
 */
import { describe, expectTypeOf, it } from 'vitest';

import type { CookingScaleNoteProps } from '../cookingScaleNoteProps.js';

describe('cooking scale note props', () => {
    it('is exactly note, openLabel and an optional onOpen', () => {
        expectTypeOf<keyof CookingScaleNoteProps>().toEqualTypeOf<'note' | 'openLabel' | 'onOpen'>();
        expectTypeOf<CookingScaleNoteProps['note']>().toEqualTypeOf<string>();
        expectTypeOf<CookingScaleNoteProps['openLabel']>().toEqualTypeOf<string>();
        expectTypeOf<CookingScaleNoteProps['onOpen']>().toEqualTypeOf<(() => void) | undefined>();
    });
});
