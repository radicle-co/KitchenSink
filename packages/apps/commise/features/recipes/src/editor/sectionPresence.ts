/**
 * @module @commise/features-recipes/editor — whether the section a leaf sits in is the one the cook is in.
 *
 * One page holds every section, so a section's fields stay mounted while the cook works in another. A leaf that speaks
 * an event (an alert) asks this before it interrupts: an event that lands while the cook is elsewhere is a state on
 * return (`docs/design/rowEditorOpenDecisions.md` E2). `EditorSection` provides it from the scroll spy's current
 * section. Outside an editor nothing provides it, and the leaf is where the cook is.
 *
 * @pattern Dependency Injection through a context — the frame states presence; a leaf reads it without knowing sections
 */
import { createContext } from 'react';

/** `true` while the section around a leaf is the one the cook is in. */
export const SectionPresenceContext = createContext(true);
