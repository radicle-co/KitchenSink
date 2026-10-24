'use client';

/**
 * @module @commise/ui/input — the web design-system {@link TextArea}: a multi-line field on the shared field surface
 * that grows with its content.
 *
 * The growth is CSS `field-sizing: content`, bounded by `minRows` and `maxRows` in line units (`lh`) plus the
 * surface's padding and edge, so no script measures anything. Where a browser lacks `field-sizing`, the field keeps
 * `rows={minRows}` and scrolls — an acceptable fallback, recorded as an assumption in the blueprint.
 *
 * @pattern Template — one field geometry (`FIELD_CLASS`), rendered by both text-field leaves
 * @pattern Adapter over the DOM focus API — a level-triggered focus request, acknowledged once taken. It is the one
 *     reason this leaf holds a ref: `.focus()` has no declarative form.
 */
import { useRef, type FC } from 'react';

import { FIELD_CLASS } from './fieldClass.js';
import { useFocusRequest } from '../focusRequest/useFocusRequest.js';
import type { TextAreaProps } from './props.js';

/** A height of `rows` body lines, plus the surface's 16 px vertical padding each side and its 1 px edge. Pure. */
const rowsHeight = (rows: number): string => `calc(${String(rows)}lh + 2px + 2rem)`;

/** The web design-system multi-line text field. */
export const TextArea: FC<TextAreaProps> = ({
    id,
    value,
    onChangeText,
    invalid = false,
    describedBy,
    placeholder,
    autoCapitalize,
    disabled = false,
    minRows,
    maxRows,
    focusRequested = false,
    onFocusRequestHandled,
}) => {
    const node = useRef<HTMLTextAreaElement>(null);
    useFocusRequest(focusRequested, () => node.current?.focus(), onFocusRequestHandled);

    return (
        <textarea
            ref={node}
            id={id}
            value={value}
            rows={minRows}
            onChange={(event) => onChangeText(event.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            placeholder={placeholder}
            autoCapitalize={autoCapitalize}
            disabled={disabled}
            className={`block w-full text-ink ${FIELD_CLASS} field-sizing-content resize-none`}
            style={{
                minHeight: rowsHeight(minRows),
                ...(maxRows === undefined ? {} : { maxHeight: rowsHeight(maxRows) }),
            }}
        />
    );
};
