/**
 * @module @commise/ui/input — the `@commise/ui/input` package export: the design-system text fields (`Input`,
 * `TextArea`), the `Stepper`, and the `FieldLabel` that names a field, each resolved to its web or native leaf at bundle time, plus their
 * shared contract, and the field surface (a web class string, native geometry) for a raw field that cannot be one
 * of them.
 */
export { FieldLabel } from './FieldLabel.js';
export { FIELD_CLASS } from './fieldClass.js';
export { FIELD_EDGE, FIELD_PADDING, fieldGeometry, fieldPaint } from './fieldStyle.js';
export { Input } from './Input.js';
export { Stepper } from './Stepper.js';
export { TextArea } from './TextArea.js';
export { fieldHintId, fieldLabelId, stepFrom } from './props.js';
export type {
    EnterKeyHint,
    FieldLabelProps,
    InputAutoComplete,
    InputMode,
    InputProps,
    StepperProps,
    TextAreaProps,
} from './props.js';
