/**
 * @module gradientCss — turns expo-linear-gradient's props, and the size of the view they paint, into the CSS
 * `linear-gradient(...)` string.
 *
 * Why this is not `expo-linear-gradient`'s own web code (`getLinearGradientBackgroundImage`), measured on the
 * product's 135deg wash in a 390 x 200 view: expo's web adapter takes the angle from the segment in PIXELS
 * (117.15deg, the same as a device), but then paints the stops over the whole CSS gradient line, 0% to 100%. The
 * device paints them over the start-to-end segment only: the segment is 310px and the CSS line 438px, so the
 * wash begins at 14.6% and ends at 85.4% and is clamped flat outside. Its defaults also differ (start (0, 0)
 * instead of (0.5, 0)), it drops a stop at location 0, and its colour pass needs `Platform`, which this build
 * deliberately makes iOS. It cannot give the device's look, so the stop placement is done here and the angle
 * is the one expo's formula gives.
 *
 * @pattern Adapter — a pure translation between two gradient vocabularies
 */
import { DesignArtifactError } from '../errors.js';

/** An expo gradient point: `{ x, y }` or an `[x, y]` tuple, in the unit box. */
export type GradientPoint = { readonly x: number; readonly y: number } | readonly [number, number];

/** The gradient props the CSS needs. */
export interface GradientSpec {
    readonly colors: readonly unknown[];
    readonly locations?: readonly number[] | null;
    readonly start?: GradientPoint | null;
    readonly end?: GradientPoint | null;
}

/** expo-linear-gradient's default start and end: top centre to bottom centre. */
const DEFAULT_START: GradientPoint = { x: 0.5, y: 0 };
const DEFAULT_END: GradientPoint = { x: 0.5, y: 1 };
const FULL_TURN_DEGREES = 360;
const PRECISION = 1e4;

/** The pixel size of the view a gradient paints. */
export interface GradientSize {
    readonly width: number;
    readonly height: number;
}

/** Round away float noise (`0.3 * 100` is `30.000000000000004`). */
function tidy(value: number): number {
    return Math.round(value * PRECISION) / PRECISION;
}

function xyOf(point: GradientPoint): { readonly x: number; readonly y: number } {
    return Array.isArray(point) ? { x: point[0], y: point[1] } : (point as { x: number; y: number });
}

function colourOf(colour: unknown, index: number): string {
    if (typeof colour !== 'string') {
        throw new DesignArtifactError(
            'unknown-colour',
            `LinearGradient colour #${index} is ${JSON.stringify(colour)}; only CSS colour strings can be painted`,
        );
    }

    return colour;
}

/**
 * The CSS `linear-gradient(...)` for an expo gradient painted in a view of the given size.
 *
 * The start and end points are scaled to pixels. The CSS angle is that segment's direction, and each stop is
 * placed on the segment (not on the CSS gradient line, which is longer unless the segment runs corner to corner).
 * A stop outside 0..1 lands outside 0..100% and CSS clamps the ends, as the device does.
 *
 * @param spec - The gradient's colours, locations and points.
 * @param size - The view's size in pixels.
 * @returns A CSS `linear-gradient(<deg>deg, <colour> <pct>%, …)` value.
 * @throws DesignArtifactError `unknown-colour` when a colour is not a string, which the browser cannot paint (a
 *     number or a platform colour object would otherwise become silent black).
 */
export function linearGradientCss(spec: GradientSpec, size: GradientSize): string {
    const given = spec.colors.map(colourOf);
    // CSS needs two stops; a lone colour is a flat fill.
    const colours = given.length === 1 ? [...given, ...given] : given;
    const start = xyOf(spec.start ?? DEFAULT_START);
    const end = xyOf(spec.end ?? DEFAULT_END);
    const dx = (end.x - start.x) * size.width;
    const dy = (end.y - start.y) * size.height;
    const length = Math.hypot(dx, dy);

    if (length === 0) {
        const flat = colours.at(-1) ?? '';

        return `linear-gradient(180deg, ${flat} 0%, ${flat} 100%)`;
    }

    const ux = dx / length;
    const uy = dy / length;
    const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
    // The CSS gradient line through the box centre runs from corner to corner along the angle.
    const lineLength = Math.abs(size.width * ux) + Math.abs(size.height * uy);
    const alongLine = (point: { x: number; y: number }): number =>
        (point.x - 0.5) * size.width * ux + (point.y - 0.5) * size.height * uy + lineLength / 2;
    const from = alongLine(start);
    const to = alongLine(end);
    const lastIndex = colours.length - 1;
    const stops = colours.map((colour, index) => {
        const location = spec.locations?.[index] ?? index / lastIndex;
        const percent = tidy(((from + location * (to - from)) / lineLength) * 100);

        return `${colour} ${percent}%`;
    });

    return `linear-gradient(${tidy((degrees + FULL_TURN_DEGREES) % FULL_TURN_DEGREES)}deg, ${stops.join(', ')})`;
}
