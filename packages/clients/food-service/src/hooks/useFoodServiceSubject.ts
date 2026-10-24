import { useContext } from 'react';

import { FoodServiceContext } from './foodServiceProvider.js';

/**
 * Read the signed-in cook from context: the user id the per-cook food reads are keyed on (plan 002 S3 property 7).
 *
 * @returns The cook's user id, or `undefined` while no one is signed in.
 * @throws {Error} when called outside a `FoodServiceProvider`.
 */
export function useFoodServiceSubject(): string | undefined {
    const value = useContext(FoodServiceContext);

    if (value === null) {
        throw new Error('useFoodServiceSubject must be used within a <FoodServiceProvider>.');
    }

    return value.subject;
}
