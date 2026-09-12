/**
 * @module fixtures/NoProps — a zero-prop default export with NO JSDoc of its own, which is the exact shape
 * `react-docgen-typescript` reports nothing for: with no props it falls through to `else if (description &&
 * displayName)`, so a component that is both propless AND undocumented disappears entirely. That is the worst
 * possible silence — those are precisely the components a coverage number needs to count. Measured in this
 * repository at 8 files in `@commise/web` alone (`loading.tsx`, `not-found.tsx`, `AccountEraseForm.tsx`).
 * Presentational.
 */
import { Badge } from './Badge.js';

export default function NoProps() {
    return <Badge>done</Badge>;
}
