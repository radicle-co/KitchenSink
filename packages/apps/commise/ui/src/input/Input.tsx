/**
 * @module @commise/ui/input — the web design-system {@link Input}: a one-line text field on the shared field surface
 * (`FIELD_CLASS`), named by the `FieldLabel` above it through `htmlFor`.
 *
 * Presentational and controlled: it owns no state. `invalid` sets `aria-invalid`, which the surface reads for its
 * `danger` edge; `describedBy` names the caller's message. Return in the field calls `onSubmit`.
 *
 * @pattern Template — one field geometry (`FIELD_CLASS`), rendered by both text-field leaves
 */
import type { FC } from 'react';

import { FIELD_CLASS } from './fieldClass.js';
import type { InputProps } from './props.js';

/** The web design-system one-line text field. */
export const Input: FC<InputProps> = ({
    id,
    value,
    onChangeText,
    invalid = false,
    describedBy,
    placeholder,
    autoCapitalize,
    disabled = false,
    inputMode,
    autoComplete,
    enterKeyHint,
    secret = false,
    onSubmit,
}) => (
    <input
        id={id}
        type={secret ? 'password' : 'text'}
        value={value}
        onChange={(event) => onChangeText(event.target.value)}
        onKeyDown={(event) => {
            if (event.key === 'Enter' && onSubmit !== undefined) {
                onSubmit();
            }
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={placeholder}
        autoCapitalize={autoCapitalize}
        disabled={disabled}
        inputMode={inputMode}
        autoComplete={autoComplete}
        enterKeyHint={enterKeyHint}
        className={`block w-full text-ink ${FIELD_CLASS}`}
    />
);
