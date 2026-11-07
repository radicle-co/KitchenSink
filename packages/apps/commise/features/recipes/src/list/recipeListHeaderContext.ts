/**
 * @module @commise/features-recipes — the header the Recipes frame puts at the top of the one list (native).
 *
 * The frame owns the title, the avatar, the segments and the search field, and the list owns the scroller. The frame
 * hands its header down through this context, so the list draws it as its first child and a read that is pending or
 * failed never unmounts it. Absent (a list rendered alone): no header.
 *
 * @pattern Template Method with a slot — the frame fixes the header, the list fills in the rest
 */
import { createContext, type ReactNode } from 'react';

export const RecipeListHeaderContext = createContext<ReactNode>(null);
