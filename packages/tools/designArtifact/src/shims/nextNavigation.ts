/**
 * @module nextNavigation — `next/navigation` for a static artboard. Nothing navigates: the router's methods do nothing,
 * `redirect` and `notFound` return instead of throwing (a board draws one state and has nowhere to go), and the path
 * is whatever the page said it is.
 *
 * @pattern Null Object over the Next app router (typed against next/navigation)
 */
import type { Params } from 'next/dist/server/request/params.js';
import type {
    useParams as UseParams,
    useRouter as UseRouter,
    useSearchParams as UseSearchParams,
} from 'next/navigation.js';

import { currentPath } from './artifactGlobals.js';

const router: ReturnType<typeof UseRouter> = {
    bfcacheId: 'artboard',
    push: () => undefined,
    replace: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    prefetch: () => undefined,
};

const params: Record<string, string> = { locale: 'en' };

/** The page's path. */
export function usePathname(): string {
    return currentPath();
}

/** A router that goes nowhere. The same object every render, so an effect keyed on it does not rerun. */
export const useRouter: typeof UseRouter = () => router;

/** Empty, and read-only like `ReadonlyURLSearchParams`: one instance is shared by every caller. */
class EmptySearchParams extends URLSearchParams {
    override append(): never {
        throw new Error('The artboard search params are read-only.');
    }

    override set(): never {
        throw new Error('The artboard search params are read-only.');
    }

    override delete(): never {
        throw new Error('The artboard search params are read-only.');
    }

    override sort(): never {
        throw new Error('The artboard search params are read-only.');
    }
}

const searchParams = new EmptySearchParams('');

/** No search params. The same object every render, so an effect keyed on it does not rerun. */
export const useSearchParams: typeof UseSearchParams = () => searchParams as ReturnType<typeof UseSearchParams>;

/** The `en` locale. */
export const useParams: typeof UseParams = <T extends Params = Params>(): T => params as T;

/**
 * Does nothing: a static artboard does not navigate.
 *
 * Next types this `never` (it throws to stop rendering); this returns `void` on purpose, because throwing would
 * blank the board. Code after a `redirect(...)` call therefore keeps running here.
 */
export function redirect(_url: string): void {}

/** Does nothing, and returns `void` for the same reason as {@link redirect}: a board draws one state. */
export function notFound(): void {}
