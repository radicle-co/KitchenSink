/**
 * @module @commise/ui/icon — the web design-system {@link Icon}.
 *
 * Draws the Registry's `lucide-react` glyph for a meaning: Lucide's 24 px grid and 2 px round-capped stroke, outlined
 * unless `filled`. The glyph is decorative (Lucide marks it `aria-hidden`; it is not focusable) unless the caller names it, because the
 * control around it almost always carries the name. With no `tone` the stroke is `currentColor`, so the glyph takes the
 * colour of the text beside it; a `tone` reads the role's emitted custom property (`--color-{role}`).
 *
 * A directional glyph carries `rtl:-scale-x-100`, which mirrors it under a right-to-left `dir`.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Adapter over `lucide-react` — a screen names a meaning from the closed `IconName` Registry, never a glyph
 */
import type { CSSProperties, FC } from 'react';

import { kebab } from '../tokens/emit.js';
import { GLYPHS } from './glyphs.js';
import { MIRROR_IN_RTL, type IconProps } from './props.js';

/** The design-system icon. */
export const Icon: FC<IconProps> = ({ name, size = 24, tone, filled = false, label }) => {
    const Glyph = GLYPHS[name];
    const style: CSSProperties | undefined = tone === undefined ? undefined : { color: `var(--color-${kebab(tone)})` };

    return (
        <Glyph
            size={size}
            strokeWidth={2}
            fill={filled ? 'currentColor' : 'none'}
            focusable="false"
            className={MIRROR_IN_RTL.has(name) ? 'shrink-0 rtl:-scale-x-100' : 'shrink-0'}
            style={style}
            // Unnamed, Lucide marks the glyph `aria-hidden` itself; a name makes it an image (pinned by the tests).
            {...(label === undefined ? {} : { role: 'img', 'aria-label': label })}
        />
    );
};
