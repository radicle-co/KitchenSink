/**
 * @module @commise/ui/chip — the web design-system {@link Chip}.
 *
 * A `filter` chip is a toggle button (`aria-pressed`) with a 16 px check before its label while selected and an
 * optional `figure` count after it; an `input` chip is a button named by the caller's remove label, with a trailing
 * `x`. A label over 24 characters shows truncated (`visibleChipLabel`) and keeps the full label as the name.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Visitor — an exhaustive switch over the `kind` discriminated union; the surface is the `chipClass` recipe
 */
import type { FC } from 'react';

import { Icon } from '../icon/Icon.js';
import { chipClass } from './chipClass.js';
import { visibleChipLabel } from './chipLabel.js';
import type { ChipProps, FilterChipProps } from './props.js';

/** The name a filter chip states when its visible text cannot: its full label, then its count. Pure. */
const filterName = ({ label, count }: FilterChipProps): string =>
    count === undefined ? label : `${label} ${String(count)}`;

/** The web design-system chip. */
export const Chip: FC<ChipProps> = (props) => {
    switch (props.kind) {
        case 'filter': {
            const visible = visibleChipLabel(props.label);

            return (
                <button
                    type="button"
                    aria-pressed={props.selected}
                    aria-label={visible === props.label ? undefined : filterName(props)}
                    onClick={props.onPress}
                    className={chipClass(props.selected)}
                >
                    {props.selected ? <Icon name="check" size={16} /> : null}
                    <span>{visible}</span>
                    {props.count === undefined ? null : (
                        <>
                            {' '}
                            <span className="font-semibold tabular-nums lining-nums text-ink-muted">{props.count}</span>
                        </>
                    )}
                </button>
            );
        }

        case 'input':
            return (
                <button
                    type="button"
                    aria-label={props.removeLabel}
                    onClick={props.onRemove}
                    className={chipClass(false)}
                >
                    <span>{visibleChipLabel(props.label)}</span>
                    <Icon name="x" size={16} />
                </button>
            );
    }
};
