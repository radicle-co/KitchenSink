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
import { HERO_DISC_CLASS } from '../heroButton/HeroButton.js';

/** The web control over a photo. */
export const PhotoControl: FC<PhotoControlProps> = ({ icon, label, onPress }) => (
    <button
        type="button"
        aria-label={label}
        onClick={onPress}
        className={HERO_DISC_CLASS}
    >
        <Icon name={icon} size={24} tone="ink" />
    </button>
);
