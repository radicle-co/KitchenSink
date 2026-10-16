import type { Plugin } from 'vitest/config';

/** Redirects a relative import to its `.native.tsx`/`.native.ts` sibling when one exists (Metro's rule). */
export function preferNativeLeaves(): Plugin;
