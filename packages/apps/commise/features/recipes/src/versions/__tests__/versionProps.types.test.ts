/**
 * `onBack` and `backHref` are the WEB leaves' props: native draws no Back of its own, because the screen's pinned bar owns
 * it in every state. They live on `*WebProps` types (as `DataSourcesPageWebProps` does) and the shared props, which the
 * native leaves take, do not carry props they ignore. The assertions are conditional types: a regression fails `tsc`, the
 * gate; the runtime check keeps the file a real test.
 */
import { describe, expect, it } from 'vitest';

import type { RecipeVersionListProps, RecipeVersionListWebProps } from '../history.js';
import type { RecipeVersionListErrorProps, RecipeVersionListErrorWebProps } from '../RecipeVersionListError.js';
import type {
    RecipeVersionListSkeletonProps,
    RecipeVersionListSkeletonWebProps,
} from '../RecipeVersionListSkeleton.js';

/** Whether T carries ANY of the way-back props. Not distributive: a union K would make `true | false`, which accepts anything. */
type HasAnyWayBack<T> = [Extract<keyof T, 'onBack' | 'backHref'>] extends [never] ? false : true;
/** Whether T carries BOTH of them. */
type HasBothWayBack<T> = ['onBack' | 'backHref'] extends [keyof T] ? true : false;

describe('the version history leaves’ props', () => {
    it('keep the way back off the shared props the native leaves take', () => {
        const list: HasAnyWayBack<RecipeVersionListProps> = false;
        const error: HasAnyWayBack<RecipeVersionListErrorProps> = false;
        const skeleton: HasAnyWayBack<RecipeVersionListSkeletonProps> = false;

        expect([list, error, skeleton]).toEqual([false, false, false]);
    });

    it('put the way back on the web props', () => {
        const list: HasBothWayBack<RecipeVersionListWebProps> = true;
        const error: HasBothWayBack<RecipeVersionListErrorWebProps> = true;
        const skeleton: HasBothWayBack<RecipeVersionListSkeletonWebProps> = true;

        expect([list, error, skeleton]).toEqual([true, true, true]);
    });
});
