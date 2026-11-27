'use client';

/**
 * @module @commise/ui/search-field — the web design-system {@link SearchField}: the one pill input (spec §1.6/§1.11).
 *
 * A `type="search"` field 48 px tall on `paper` with a 1 px `lineControl` edge, a leading 20 px `search` glyph
 * (`inkMuted`, hidden), and while non-empty a trailing 44 × 44 clear control named by the caller's `clearLabel`. The
 * browser's own clear control is hidden, so there is one. Its label is the `FieldLabel` above it, or a visually hidden
 * `<label>` that stays its name.
 *
 * Clearing empties the field and returns focus to it: the clear control disappears with the text, which drops focus to
 * the page, so a counter the field advances on clear hands focus back through `useFocusOnSignal` (the registered focus
 * Adapter — this leaf holds no ref of its own).
 *
 * `'use client'`: the clear count is state and the focus return an effect.
 *
 * @pattern Adapter over the native `type="search"` input — the label, glyph and clear control are the primitive's
 */
import { useState, type FC } from 'react';

import { useFocusOnSignal } from '../dialogFocus/useFocusOnSignal.js';
import { Icon } from '../icon/Icon.js';
import { IconButton } from '../iconButton/IconButton.js';
import { FieldLabel } from '../input/FieldLabel.js';
import type { SearchFieldProps } from './props.js';
import { FOCUS_RING_CLASS } from '../focusRing/focusRingClass.js';

/** The pill. Its start padding clears the glyph and its end padding the clear control. */
const FIELD =
    'block min-h-12 w-full rounded-full border border-line-control bg-paper ps-11 pe-12 py-3 text-body text-ink ' +
    'placeholder:text-ink-muted [&::-webkit-search-cancel-button]:appearance-none ' +
    FOCUS_RING_CLASS.offset;

/** Where the clear control sits: the pill's end, centred. The control itself is the shared icon button. */
const CLEAR_SLOT = 'absolute inset-y-0 end-0.5 flex items-center';

/** The web design-system search field. */
export const SearchField: FC<SearchFieldProps> = ({
    id,
    label,
    labelVisibility,
    clearLabel,
    value,
    onChangeText,
    onSubmit,
    placeholder,
    onFocus,
    onBlur,
}) => {
    const [clears, setClears] = useState(0);
    const field = useFocusOnSignal<HTMLInputElement>(clears);

    return (
        <div className="flex flex-col gap-1">
            {labelVisibility === 'visible' ? (
                <FieldLabel forId={id} label={label} />
            ) : (
                <label htmlFor={id} className="sr-only">
                    {label}
                </label>
            )}
            <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 start-4 flex items-center">
                    <Icon name="search" size={20} tone="inkMuted" />
                </span>
                <input
                    ref={field}
                    id={id}
                    type="search"
                    enterKeyHint="search"
                    autoComplete="off"
                    value={value}
                    placeholder={placeholder}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    onChange={(event) => onChangeText(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && onSubmit !== undefined) {
                            onSubmit();
                        }
                    }}
                    className={FIELD}
                />
                {value === '' ? null : (
                    <span className={CLEAR_SLOT}>
                        <IconButton
                            icon="x"
                            accessibilityLabel={clearLabel}
                            tone="inkMuted"
                            onPress={() => {
                                onChangeText('');
                                setClears((count) => count + 1);
                            }}
                        />
                    </span>
                )}
            </div>
        </div>
    );
};
