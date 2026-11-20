import { vi } from 'vitest';

import type { KeptSessionStore } from '../keptSessionStore.js';

/** A kept store whose every method is a spy that does nothing, for tests of the callers that drive it. */
export function makeKeptStub() {
    return {
        getSnapshot: vi.fn<KeptSessionStore['getSnapshot']>(() => ({ status: 'loading' })),
        subscribe: vi.fn<KeptSessionStore['subscribe']>(() => () => undefined),
        scope: vi.fn<KeptSessionStore['scope']>(() => Promise.resolve()),
        dispatch: vi.fn<KeptSessionStore['dispatch']>(() => Promise.resolve({ kind: 'unchanged' })),
        clear: vi.fn<KeptSessionStore['clear']>(() => Promise.resolve()),
        reread: vi.fn<KeptSessionStore['reread']>(() => Promise.resolve()),
    } satisfies KeptSessionStore;
}
