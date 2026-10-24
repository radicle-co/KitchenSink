/**
 * The surface module's public API. Owner D12 keeps glass off every card; the frosted `GlassCard` was the only way a
 * card could be glass, and its one consumer (the Home placeholders) read 1.1:1 in dark mode (`evaluateFinal.md` F1).
 * It is deleted, so the module offers no glass surface to reach for.
 */
import { describe, expect, it } from 'vitest';

import * as surface from '../index.js';

describe('@commise/ui/surface', () => {
    it('offers the gradient surface and no glass card', () => {
        expect(Object.keys(surface).sort()).toEqual(['GradientSurface']);
    });
});
