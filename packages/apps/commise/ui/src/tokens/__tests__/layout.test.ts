/**
 * The layout tokens (`docs/design/uiOverhaul/buildSpec.md` §1.2, §1.3, §1.6) and their one web emission.
 *
 * One numeric source feeds both platforms: native reads these numbers through `containerClass.ts`, web reads the same
 * numbers as `rem` custom properties in `theme.css`. This suite pins the numbers and that the emitted rems are the
 * numbers ÷ 16, so the two cannot drift.
 *
 * ⚠️ The content width the spec calls `content-wide` is emitted as `page` (blueprint, "Changes to the build spec" 5):
 * Tailwind v4's `--container-*` namespace drives BOTH `max-w-*` and the `@container` size variants, so a
 * `--container-wide` of 90rem would make `@wide/main:` fire at 1440 instead of 960. The last row pins that.
 *
 * Mutation lens: change a number, emit it under its spec name, or emit a breakpoint the token does not state, and a
 * row fails.
 */
import { describe, expect, it } from 'vitest';

import { containerThreshold, contentWidth, gutter, spacingRole, viewportThreshold } from '../layout.js';
import { spacing } from '../scale.js';
import { themeCss } from '../themeCss.js';

describe('layout tokens', () => {
    it('states the §1.2 viewport and container thresholds', () => {
        expect(viewportThreshold).toEqual({ medium: 600, expanded: 840 });
        expect(containerThreshold).toEqual({ regular: 600, wide: 960 });
    });

    it('states the §1.3 content widths, with `page` for the spec’s `content-wide`', () => {
        expect(contentWidth).toEqual({ reading: 640, list: 768, detail: 1152, page: 1440 });
    });

    it('states the §1.2 gutters per viewport class', () => {
        expect(gutter).toEqual({ compact: 16, medium: 24, expanded: 32 });
    });

    // §1.6: space between groups is always larger than space within them.
    it('states the §1.6 spacing roles on the 4 px ramp', () => {
        expect(spacingRole).toEqual({
            gapInline: spacing[1],
            gapWithin: spacing[2],
            gapGroup: spacing[4],
            gapSection: spacing[6],
            gapGrid: { narrow: spacing[4], regular: spacing[5], wide: spacing[5] },
            headerToContent: spacing[5],
            gapRow: spacing[3],
        });
        expect(spacingRole.gapWithin).toBeLessThan(spacingRole.gapGroup);
        expect(spacingRole.gapGroup).toBeLessThan(spacingRole.gapSection);
    });
});

describe('theme.css — the layout emission', () => {
    const css = themeCss();

    it.each(Object.entries(contentWidth))('emits the %s content width as its px ÷ 16', (name, px) => {
        expect(css).toContain(`--container-${name}: ${px / 16}rem;`);
    });

    it.each(Object.entries(containerThreshold))('emits the %s container threshold as its px ÷ 16', (name, px) => {
        expect(css).toContain(`--container-${name}: ${px / 16}rem;`);
    });

    it('emits the navigation breakpoint at the expanded viewport threshold', () => {
        expect(css).toContain(`--breakpoint-nav: ${viewportThreshold.expanded / 16}rem;`);
    });

    // Tailwind's own `md` is 768 px, but the gutter steps to 24 px at the 600 px medium threshold (§1.2).
    it('emits a medium breakpoint at the medium viewport threshold, for the gutter step', () => {
        expect(css).toContain(`--breakpoint-medium: ${viewportThreshold.medium / 16}rem;`);
    });

    it('never emits the spec’s 1440 px `content-wide` under the `wide` name the container variant reads', () => {
        expect(css).not.toContain('--container-wide: 90rem');
        expect(css).not.toContain('--container-content-wide');
    });
});
