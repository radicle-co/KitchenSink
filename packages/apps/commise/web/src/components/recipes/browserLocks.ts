import type { LockManagerLike } from '@kitchensink/sync';

/**
 * The browser's Web Locks, or `undefined` where the origin is not secure or the browser predates them. Its own module
 * so the device store and the kept store share one check without importing each other.
 *
 * @returns The lock manager, or `undefined`.
 */
export function browserLocks(): LockManagerLike | undefined {
    return typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : undefined;
}
