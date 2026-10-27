'use client';

/**
 * @module @commise/ui/photo-control — the web design-system {@link PhotoControl} (see `props.ts`): a solid 44 px
 * `photoChip` disc with an `ink` glyph and a visible focus ring. No backdrop blur, by D12.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import { Icon } from '../icon/Icon.js';
import type { PhotoControlProps } from './props.js';
import { FOCUS_RING_CLASS } from '../focusRing/focusRingClass.js';

/** The web control over a photo. */
export const PhotoControl: FC<PhotoControlProps> = ({ icon, label, onPress }) => (
    <button
        type="button"
        aria-label={label}
        onClick={onPress}
        className={`inline-flex size-11 items-center justify-center rounded-full bg-photo-chip text-ink shadow-sm ${FOCUS_RING_CLASS.floating} `}
    >
        <Icon name={icon} size={24} tone="ink" />
    </button>
);
