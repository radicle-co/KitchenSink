/**
 * No handler reads its event inside a callback that runs later. The renderer releases the event when the handler returns
 * (`deferredEventReads.ts` says why), so every `onLayout`, `onScroll`, `onContentSizeChange` and press handler in a native
 * module reads what it needs into a `const` first. The detector is proven against its fixture table
 * (`deferredEventReads.test.ts`) and this guard enumerates nothing: it reads every native module (`nativeSources.ts`).
 *
 * ✅ THE FIX FOR A FAILURE: `const { layout } = event.nativeEvent;` in the handler, then use `layout` in the updater.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { deferredEventReads } from './deferredEventReads.js';
import { nativeSources } from './nativeSources.js';
import { repoRoot } from './serviceSources.js';

const sources = nativeSources();

describe('no handler reads its event in a deferred callback', () => {
    it('reads the native modules, so an empty list cannot pass by reading nothing', () => {
        expect(sources).toContain('packages/apps/commise/ui/src/scrollHost/ScrollHost.native.tsx');
        expect(sources.length).toBeGreaterThan(100);
    });

    it('finds no event read inside a state updater, a timer or a promise callback', () => {
        const uses = sources.flatMap((file) =>
            deferredEventReads(readFileSync(path.join(repoRoot, file), 'utf8'), file).map(
                (use) => `${file}:${String(use.line)}  ${use.text}`,
            ),
        );

        expect(uses).toEqual([]);
    });
});
