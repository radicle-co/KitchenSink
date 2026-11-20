/**
 * The list's props are the hook's binding and the view's list variant, and nothing of their own. These cases are
 * checked by the type checker, so a props change that drifts from `useCookingIngredients` or from the view fails
 * `tsc`, not only a render.
 */
import { describe, expectTypeOf, it } from 'vitest';

import type { CookingMessages } from '../../messages.js';
import type { CookingIngredientsListProps, CookingIngredientsListView } from '../cookingIngredientsListProps.js';
import type { CookingIngredientsView } from '../ingredientsView.js';
import type { CookingIngredientsBinding } from '../useCookingIngredients.js';

describe('CookingIngredientsListProps', () => {
    it('takes exactly the list variant of the view, so the screen never mounts the list for none', () => {
        expectTypeOf<CookingIngredientsListView>().toEqualTypeOf<Extract<CookingIngredientsView, { kind: 'list' }>>();
        expectTypeOf<CookingIngredientsListProps['view']>().toEqualTypeOf<CookingIngredientsListView>();
        expectTypeOf<{ kind: 'none' }>().not.toExtend<CookingIngredientsListProps['view']>();
    });

    it('toggles a line by its position in the view, never by an id (mutant: a string parameter)', () => {
        expectTypeOf<Parameters<CookingIngredientsListProps['onToggle']>>().toEqualTypeOf<[position: number]>();
        expectTypeOf<Parameters<CookingIngredientsBinding['toggle']>>().toEqualTypeOf<[position: number]>();
    });

    it('takes its three commands from the hook binding unchanged, bar the Undo the list drops', () => {
        expectTypeOf<CookingIngredientsListProps['onToggle']>().toEqualTypeOf<CookingIngredientsBinding['toggle']>();
        expectTypeOf<CookingIngredientsListProps['onSetServings']>().toEqualTypeOf<
            CookingIngredientsBinding['setServings']
        >();
        // The binding's clearTicks returns its Undo. The list needs only to call it, so a void callback accepts it.
        expectTypeOf<CookingIngredientsBinding['clearTicks']>().toExtend<CookingIngredientsListProps['onClear']>();
    });

    it('takes only the Clear ticks label from the copy', () => {
        expectTypeOf<CookingIngredientsListProps['copy']>().toEqualTypeOf<
            Pick<CookingMessages['ingredients'], 'clear'>
        >();
    });

    it('has exactly these five props and an optional no-argument onClear (P60), so no mode prop creeps in', () => {
        expectTypeOf<keyof CookingIngredientsListProps>().toEqualTypeOf<
            'view' | 'copy' | 'onToggle' | 'onSetServings' | 'onClear'
        >();
        expectTypeOf<Parameters<NonNullable<CookingIngredientsListProps['onClear']>>>().toEqualTypeOf<[]>();
        expectTypeOf<CookingIngredientsListProps['onClear']>().toEqualTypeOf<(() => void) | undefined>();
    });
});
