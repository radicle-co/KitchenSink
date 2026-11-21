/**
 * Fitness function for the frame props: the column takes exactly the list's props, the sheet adds `open` and `onClose`
 * and widens the copy by the sheet's close name, and neither has a Done or a mode prop (designer's D73).
 */
import { describe, expectTypeOf, it } from 'vitest';

import type { CookingMessages } from '../../messages.js';
import type { CookingIngredientsColumnProps, CookingIngredientsSheetProps } from '../cookingIngredientsFrameProps.js';
import type { CookingIngredientsListProps } from '../cookingIngredientsListProps.js';

describe('cooking ingredients frame props', () => {
    it('gives the column the list props unchanged', () => {
        expectTypeOf<CookingIngredientsColumnProps>().toEqualTypeOf<CookingIngredientsListProps>();
    });

    it('widens the sheet copy by close only, and adds open and onClose', () => {
        expectTypeOf<CookingIngredientsSheetProps['copy']>().toEqualTypeOf<
            Pick<CookingMessages['ingredients'], 'clear' | 'close'>
        >();
        expectTypeOf<CookingIngredientsSheetProps['open']>().toEqualTypeOf<boolean>();
        expectTypeOf<CookingIngredientsSheetProps['onClose']>().toEqualTypeOf<() => void>();
        expectTypeOf<keyof CookingIngredientsSheetProps>().toEqualTypeOf<
            'view' | 'copy' | 'onToggle' | 'onSetServings' | 'onClear' | 'open' | 'onClose'
        >();
    });
});
