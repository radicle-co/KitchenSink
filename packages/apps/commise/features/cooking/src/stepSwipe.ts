/**
 * @module stepSwipe — the step swipe: a swipe on the step body is an extra route between steps on a
 * touch screen, and the buttons stay. The rule is platform free, so native and a touch screen on web call the same one.
 *
 * A swipe moves only between steps. It never exits on step 1 and never finishes on the last step, because those lose the
 * place and only a button may do them. It ignores a gesture that starts at a screen edge, where the system back gestures
 * live.
 *
 * @pattern Specification — a pure predicate over a gesture's start and travel.
 */

/** Travel, in dp, a swipe needs. The cooking step's own value. */
export const STEP_SWIPE_MIN_TRAVEL_DP = 96;

/** Width, in dp, of the zone at each screen edge where a gesture is left to the system's back gesture. */
export const STEP_SWIPE_EDGE_DP = 24;

/** The step a swipe asks for. */
export type StepSwipe = 'next' | 'back';

/** A gesture's start and travel, in dp. */
export interface SwipeTravel {
    readonly startX: number;
    readonly dx: number;
    readonly dy: number;
}

/** Inputs to {@link stepSwipeOf}. */
export interface StepSwipeInput extends SwipeTravel {
    /** The screen's width, in dp, for the far edge zone. */
    readonly width: number;
    readonly hasPrevious: boolean;
    readonly hasNext: boolean;
}

/**
 * The step a released gesture asks for, or `null` for no move. Pure.
 *
 * @returns `'next'` for a leftward swipe when a later step exists, `'back'` for a rightward one when an earlier step
 *   exists; `null` for a short or mostly vertical drag, a start in an edge zone, or a move past either end.
 */
export function stepSwipeOf({ startX, dx, dy, width, hasPrevious, hasNext }: StepSwipeInput): StepSwipe | null {
    const fromEdge = startX < STEP_SWIPE_EDGE_DP || startX >= width - STEP_SWIPE_EDGE_DP;

    if (fromEdge || Math.abs(dx) < STEP_SWIPE_MIN_TRAVEL_DP || Math.abs(dy) >= Math.abs(dx)) {
        return null;
    }

    if (dx < 0) {
        return hasNext ? 'next' : null;
    }

    return hasPrevious ? 'back' : null;
}

/** One touch of React Native's responder touch bank: the fields {@link swipeTravelOf} reads. */
interface TouchRecord {
    readonly startPageX: number;
    readonly startPageY: number;
    readonly currentPageX: number;
    readonly currentPageY: number;
    readonly currentTimeStamp: number;
}

/** A touch bank entry read as a {@link TouchRecord}, or `undefined` for a hole or a malformed entry. Pure. */
function touchOf(value: unknown): TouchRecord | undefined {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('startPageX' in value && 'startPageY' in value && 'currentPageX' in value) ||
        !('currentPageY' in value && 'currentTimeStamp' in value)
    ) {
        return undefined;
    }

    const { startPageX, startPageY, currentPageX, currentPageY, currentTimeStamp } = value;

    return typeof startPageX === 'number' &&
        typeof startPageY === 'number' &&
        typeof currentPageX === 'number' &&
        typeof currentPageY === 'number' &&
        typeof currentTimeStamp === 'number'
        ? { startPageX, startPageY, currentPageX, currentPageY, currentTimeStamp }
        : undefined;
}

/**
 * The start and travel of the touch that moved last, read from a responder event's `touchHistory`. Pure.
 *
 * React Native sets `touchHistory` on every responder event, and its 0.86 generated typings declare it
 * (`ResponderSyntheticEvent`), but the legacy typings this package compiles against leave it out. So it is parsed here
 * rather than cast: a missing or malformed history is no swipe.
 *
 * @param event - A responder event.
 * @returns `null` when the event carries no readable touch.
 */
export function swipeTravelOf(event: object): SwipeTravel | null {
    const history: unknown = 'touchHistory' in event ? event.touchHistory : undefined;
    const bank: readonly unknown[] =
        typeof history === 'object' && history !== null && 'touchBank' in history && Array.isArray(history.touchBank)
            ? history.touchBank
            : [];
    const latest = bank
        .map(touchOf)
        .reduce<TouchRecord | undefined>(
            (found, touch) =>
                touch !== undefined && (found === undefined || touch.currentTimeStamp > found.currentTimeStamp)
                    ? touch
                    : found,
            undefined,
        );

    return latest === undefined
        ? null
        : {
              startX: latest.startPageX,
              dx: latest.currentPageX - latest.startPageX,
              dy: latest.currentPageY - latest.startPageY,
          };
}
