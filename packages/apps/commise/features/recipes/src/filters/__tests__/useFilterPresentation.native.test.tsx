/**
 * Which place Discover's facets take on native: the panel for a wide container in a window that is not short, the sheet
 * for everything else, both read from the design system's layout hooks (`docs/architecture/uiOverhaulBlueprint.md` Part C,
 * slice 5). The hooks are served by the test: jsdom has no window to turn.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFilterPresentation } from '../useFilterPresentation.native.js';

const layout = vi.hoisted(() => ({ container: 'narrow' as 'narrow' | 'regular' | 'wide', compact: false }));

vi.mock('@commise/ui/layout', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/ui/layout')>()),
    useContainerClass: () => layout.container,
    useCompactHeight: () => layout.compact,
}));

describe('useFilterPresentation (native)', () => {
    it.each([
        ['narrow', false, 'sheet'],
        ['regular', false, 'sheet'],
        ['wide', false, 'panel'],
        ['wide', true, 'sheet'],
    ] as const)('a %s container, compact height %s: the %s', (container, compact, expected) => {
        layout.container = container;
        layout.compact = compact;

        expect(renderHook(() => useFilterPresentation()).result.current).toBe(expected);
    });
});
