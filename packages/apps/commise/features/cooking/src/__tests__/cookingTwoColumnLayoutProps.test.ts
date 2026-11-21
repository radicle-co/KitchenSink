/** Fitness function for the two-column layout props: a column slot and the step children, nothing else. */
import type { ReactNode } from 'react';
import { describe, expectTypeOf, it } from 'vitest';

import type { CookingTwoColumnLayoutProps } from '../cookingTwoColumnLayoutProps.js';

describe('cooking two column layout props', () => {
    it('is exactly column and children, both nodes', () => {
        expectTypeOf<keyof CookingTwoColumnLayoutProps>().toEqualTypeOf<'column' | 'children'>();
        expectTypeOf<CookingTwoColumnLayoutProps['column']>().toEqualTypeOf<ReactNode>();
        expectTypeOf<CookingTwoColumnLayoutProps['children']>().toEqualTypeOf<ReactNode>();
    });
});
