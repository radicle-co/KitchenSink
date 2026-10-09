/**
 * @module @commise/ui/segmented-control — the shared contract of the design-system `SegmentedControl`
 * (`docs/architecture/uiOverhaulBlueprint.md` Part B; `docs/design/uiOverhaul/buildSpec.md` §1.11): two or three views
 * of one thing, in ONE look and TWO semantics.
 *
 * - `route`: the segments are places (My recipes · Collections). On web they are links in a `nav`, the current one
 *   `aria-current="page"`; on native they are the `tab`s of a `tablist`.
 * - `view`: the segments are presentations of the same content (list · grid). They are a `radiogroup` on both
 *   platforms.
 *
 * The discriminated union makes the two unmixable: a route has a `current` and `onSelect`, a view a `value` and
 * `onChange`, and only a view's segments carry a glyph.
 */
import type { IconName } from '../icon/props.js';

/** One place a route segment leads to. */
export interface RouteSegment {
    /** The segment's id, reported to `onSelect`. */
    readonly id: string;
    /** The visible label, which is also its name. */
    readonly label: string;
    /** The web URL it links to. Native ignores it; on web a segment without one is a button. */
    readonly href?: string;
}

/** One presentation a view segment selects. */
export interface ViewSegment {
    /** The segment's id, reported to `onChange`. */
    readonly id: string;
    /** The visible label, which is also its name. */
    readonly label: string;
    /** A glyph before the label. */
    readonly icon?: IconName;
}

/** Segments that are places. */
export interface RouteSegmentedControlProps {
    readonly form: 'route';
    /** The control's accessible name (the `nav` or `tablist`). */
    readonly label: string;
    /** The places, in order. */
    readonly segments: readonly RouteSegment[];
    /** The id of the place the person is on. */
    readonly current: string;
    /** Go to a place. On web a plain click is handed here (the link's own navigation is cancelled). */
    readonly onSelect: (id: string) => void;
}

/** Segments that are presentations of one view. */
export interface ViewSegmentedControlProps {
    readonly form: 'view';
    /** The control's accessible name (the `radiogroup`). */
    readonly label: string;
    /** The presentations, in order. */
    readonly segments: readonly ViewSegment[];
    /** The id of the presentation in use. */
    readonly value: string;
    /** Switch presentation. */
    readonly onChange: (id: string) => void;
}

/** The cross-platform `SegmentedControl` contract. */
export type SegmentedControlProps = RouteSegmentedControlProps | ViewSegmentedControlProps;
