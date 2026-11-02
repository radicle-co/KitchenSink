/**
 * The native scroll hint's measures. Android re-sends a layout for float noise (+0.0004), and each report that changed
 * the stored width cost a commit of the chip row. The widths are whole pixels, and an unchanged one costs nothing.
 */
import { act, cleanup, render } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useScrollHint, type NativeScrollHintBinding } from '../useScrollHint.native.js';

afterEach(cleanup);

const layout = (width: number) => ({ nativeEvent: { layout: { width } } });

/** Mount the hook and count its COMMITS (React may call a component once more before it bails out of an update). */
function mountHook(): { binding: () => NativeScrollHintBinding; commits: () => number } {
    const seen: { binding?: NativeScrollHintBinding; commits: number } = { commits: 0 };

    const Host = (): null => {
        const binding = useScrollHint(undefined);

        seen.binding = binding;

        return null;
    };

    render(
        <Profiler
            id="hint"
            onRender={() => {
                seen.commits += 1;
            }}
        >
            <Host />
        </Profiler>,
    );

    return {
        binding: () => {
            if (seen.binding === undefined) {
                throw new Error('no binding');
            }

            return seen.binding;
        },
        commits: () => seen.commits,
    };
}

describe('useScrollHint (native) — sub-pixel noise costs no commit', () => {
    it.each([
        ['the scroller’s own width', (b: NativeScrollHintBinding, width: number) => b.onLayout(layout(width))],
        ['the box width', (b: NativeScrollHintBinding, width: number) => b.onBoxLayout(layout(width))],
        ['the content width', (b: NativeScrollHintBinding, width: number) => b.onContentSizeChange(width)],
    ])('re-renders nothing when %s differs by a fraction of a pixel', (_name, report) => {
        const { binding, commits } = mountHook();

        act(() => report(binding(), 300.0004));
        // React renders once more for the first update that changes nothing, then bails out eagerly: let that one pass.
        act(() => report(binding(), 300.0001));
        const settled = commits();

        act(() => report(binding(), 299.9996));
        act(() => report(binding(), 300.0003));

        expect(commits()).toBe(settled);
    });

    it('still re-renders when a width changes by a whole pixel', () => {
        const { binding, commits } = mountHook();

        act(() => binding().onLayout(layout(300)));
        const settled = commits();

        act(() => binding().onLayout(layout(302)));

        expect(commits()).toBeGreaterThan(settled);
    });
});
