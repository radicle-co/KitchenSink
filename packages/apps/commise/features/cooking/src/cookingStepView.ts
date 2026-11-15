/**
 * @module cookingStepView — the view model of one step, the one copy both platforms' screens call, so web's step view
 * and its native twin cannot drift. Pure: the session's state, the copy and the disclosure's state in, the step body's
 * props and what comes after the step out. The disclosure's open state stays in the caller, keyed by the step, so it
 * starts closed on every step.
 *
 * @pattern Presentation Model — the step's display state derived once, so both platforms' screens only draw it
 */
import { fillTemplate, pluralOf } from '@commise/i18n';

import type {
    CookingLineView,
    CookingPreviewView,
    CookingStepProps,
    CookingTickedView,
    CookingUpNextView,
} from './cookingViewProps.js';
import type { CookingMessages } from './messages.js';
import type { UseCookingSessionResult } from './useCookingSession.js';

/** What a step's view is made of. */
export interface CookingStepViewInput {
    /** The parts of the session a step reads, and the tick handlers its rows call. */
    readonly session: Pick<
        UseCookingSessionResult,
        | 'steps'
        | 'step'
        | 'place'
        | 'focusLine'
        | 'focusPlace'
        | 'tickedCount'
        | 'everyLineTicked'
        | 'isTicked'
        | 'tick'
        | 'untick'
    >;
    readonly copy: CookingMessages;
    /** The locale the ticked summary's plural is chosen in. */
    readonly locale: Parameters<typeof pluralOf>[2];
    /** The place ("Step 2 of 6"), already filled: the step region's name, the same words as the top bar. */
    readonly label: string;
    /** Whether the ticked lines are open. */
    readonly expanded: boolean;
    /** Show: opens or closes the ticked lines. */
    readonly onToggleShow: () => void;
}

/** A step's view: the body's props, and the foot's preview of the next step. */
export interface CookingStepView {
    /** The step body, with its Up next filled once every line is ticked. */
    readonly step: CookingStepProps;
    /** The next step's one-line preview for the pinned foot, while a line is unticked; absent on the last step. */
    readonly preview?: CookingPreviewView;
}

/**
 * What comes after the current step: the foot's preview while a line is unticked, the body's Up next once every line is
 * ticked, and neither on the last step. `place.next` is 1-based and `steps` is read by 0-based index; every cooked step
 * has a line, but the read is an index, so the guard stays (an index read may be undefined, DD19).
 */
function afterOf(
    session: CookingStepViewInput['session'],
    copy: CookingMessages,
): { readonly preview?: CookingPreviewView; readonly upNext?: CookingUpNextView } {
    const { steps, place, everyLineTicked } = session;

    if (place.next === null) {
        return {};
    }

    const following = steps[place.next - 1];

    if (following === undefined) {
        return {};
    }

    const [lead = '', ...rest] = following.lines;

    return everyLineTicked
        ? { upNext: { overline: fillTemplate(copy.next.upNext, { n: place.next }), lead, rest } }
        : { preview: { overline: fillTemplate(copy.nav.nextPreview, { n: place.next }), line: lead } };
}

/** The step's display props: its focus line, the lines after it, the ticked record and what comes next. Pure. */
export function cookingStepViewOf({
    session,
    copy,
    locale,
    label,
    expanded,
    onToggleShow,
}: CookingStepViewInput): CookingStepView {
    const { step, place, focusLine, focusPlace, tickedCount, isTicked } = session;

    const lineViewOf = (index: number): CookingLineView => {
        const checked = isTicked(index);

        return {
            key: String(index),
            text: step.lines[index] ?? '',
            checked,
            onToggle: () => (checked ? session.untick(index) : session.tick(index)),
        };
    };

    const indexes = step.lines.map((_, index) => index);
    const ticked: CookingTickedView | undefined =
        tickedCount === 0
            ? undefined
            : {
                  summary: pluralOf(copy.step.tickedSummary, tickedCount, locale),
                  show: { label: copy.step.show, onPress: onToggleShow },
                  expanded,
                  lines: indexes.filter((index) => isTicked(index)).map(lineViewOf),
              };
    const { preview, upNext } = afterOf(session, copy);

    return {
        step: {
            label,
            track: { total: place.total, position: place.position },
            ...(focusPlace === null
                ? {}
                : {
                      lineOf: fillTemplate(copy.step.lineOf, { current: focusPlace.position, total: focusPlace.total }),
                  }),
            ...(ticked === undefined ? {} : { ticked }),
            ...(upNext === undefined ? {} : { upNext }),
            ...(focusLine === null ? {} : { focus: lineViewOf(focusLine) }),
            then:
                focusLine === null
                    ? []
                    : indexes.filter((index) => index > focusLine && !isTicked(index)).map(lineViewOf),
        },
        ...(preview === undefined ? {} : { preview }),
    };
}
