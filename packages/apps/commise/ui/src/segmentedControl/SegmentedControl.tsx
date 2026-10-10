'use client';

/**
 * @module @commise/ui/segmented-control — the web design-system {@link SegmentedControl}.
 *
 * A `route` control is a `nav` of links: the current one `aria-current="page"`. A plain click is handed to `onSelect`
 * and the link's own navigation cancelled, so the app's router moves; a modified click (a new tab, a new window) is
 * left to the browser, which is why the segment stays a real link with its `href`. A segment with no `href` is a button
 * that states `aria-current` the same way.
 *
 * A `view` control is a Radix `RadioGroup`: a `radiogroup` of `radio`s with roving focus and arrow keys.
 *
 * `'use client'`: Radix's roving focus is an effect.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Visitor — an exhaustive switch over the `form` discriminated union: two semantics, one look
 * @pattern Adapter over `@radix-ui/react-radio-group` for the view form
 */
import * as RadioGroup from '@radix-ui/react-radio-group';
import type { FC } from 'react';

import { Icon } from '../icon/Icon.js';
import { isModifiedClick } from '../routeLink/isModifiedClick.js';
import type { RouteSegmentedControlProps, SegmentedControlProps } from './props.js';
import { segmentClass, trackClass, type SegmentWidth } from './segmentClass.js';

/** A route control: places, as links. */
const RouteControl: FC<RouteSegmentedControlProps> = ({ label, segments, current, onSelect }) => (
    <nav aria-label={label}>
        <div className={trackClass()}>
            {segments.map((segment) => {
                const isCurrent = segment.id === current;
                const state = { 'aria-current': isCurrent ? ('page' as const) : undefined };

                return segment.href === undefined ? (
                    <button
                        key={segment.id}
                        type="button"
                        {...state}
                        onClick={() => onSelect(segment.id)}
                        className={segmentClass(isCurrent)}
                    >
                        {segment.label}
                    </button>
                ) : (
                    <a
                        key={segment.id}
                        href={segment.href}
                        {...state}
                        onClick={(event) => {
                            if (isModifiedClick(event)) {
                                return;
                            }

                            event.preventDefault();
                            onSelect(segment.id);
                        }}
                        className={segmentClass(isCurrent)}
                    >
                        {segment.label}
                    </a>
                );
            })}
        </div>
    </nav>
);

/** The web design-system segmented control. */
export const SegmentedControl: FC<SegmentedControlProps> = (props) => {
    switch (props.form) {
        case 'route':
            return <RouteControl {...props} />;
        case 'view': {
            // An icon-only switch takes its glyphs' width; a labelled one shares the row.
            const width: SegmentWidth = props.labelVisibility === 'hidden' ? 'content' : 'share';

            return (
                <RadioGroup.Root
                    aria-label={props.label}
                    orientation="horizontal"
                    value={props.value}
                    onValueChange={props.onChange}
                    className={trackClass(width)}
                >
                    {props.segments.map((segment) => (
                        <RadioGroup.Item
                            key={segment.id}
                            value={segment.id}
                            className={segmentClass(segment.id === props.value, width)}
                        >
                            {segment.icon === undefined ? null : <Icon name={segment.icon} size={20} />}
                            {props.labelVisibility === 'hidden' ? (
                                <span className="sr-only">{segment.label}</span>
                            ) : (
                                segment.label
                            )}
                        </RadioGroup.Item>
                    ))}
                </RadioGroup.Root>
            );
        }
    }
};
