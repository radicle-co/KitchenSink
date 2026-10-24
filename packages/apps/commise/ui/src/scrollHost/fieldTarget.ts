/**
 * @module @commise/ui/scroll-host — the cursor by which a native `ScrollHost` names a field
 * (`docs/design/uiOverhaul/specSharedSystem.md` §16.3). A native field is not found by id the way a web element is, so
 * the host counts how many times `scrollToField(id)` was called for each id and publishes the counts; a field reads
 * the count of its own id and, when it goes UP, asks the field reveal host to centre it and move the screen-reader
 * cursor to it. A count is a level, so a field that mounts under a standing count stays still.
 *
 * A sibling of `ScrollHostContext`, not a member of `ScrollHostApi`: the counts change when a field is named, and the
 * screen's chrome that reads the API must not re-render for it. Internal to the package; no screen reads it.
 *
 * @pattern Observer — a field watches the count of its own id
 */
import { createContext, useContext } from 'react';

/** No field was ever named. */
const NO_TARGETS: Readonly<Record<string, number>> = {};

/** How many times each field id was named by `scrollToField`. */
export const FieldTargetContext = createContext<Readonly<Record<string, number>>>(NO_TARGETS);

/**
 * How many times the host has named this field.
 *
 * @param id - The field's id, the one the screen passes to `scrollToField`.
 * @returns The count; 0 until named, and outside any host.
 */
export function useFieldTarget(id: string): number {
    return useContext(FieldTargetContext)[id] ?? 0;
}
