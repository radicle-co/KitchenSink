/**
 * @module @commise/features-recipes/ingredientMatching — what one control of a food-choice list or a settled row is told
 * about focus, for both platforms' leaves. A list takes focus for two reasons that never share a control by accident: the host asks for it
 * after a pick on the line before (`focus`, landing on the view's `focusTarget`), and Try again asks for it when a retry
 * starts and the button that held focus unmounts (`landing`, on the view's `landing`). Both are levels the control lowers
 * once it has taken focus; the control lowers only the one that asked.
 *
 * Pure and platform-agnostic.
 */
import type { ControlFocus } from '../common/controlFocus.js';
import {
    isFocusTarget,
    type FoodChoiceListView,
    type ListFocusTarget,
    type SettledAction,
    type SettledLineView,
} from './matchLineView.js';

/** The two focus props a `Button` or `ChoiceRow` takes. */
export interface ControlFocusProps {
    readonly focusRequested: boolean;
    readonly onFocusRequestHandled: () => void;
}

/**
 * The focus props of one control of a list. Pure.
 *
 * @param view - The list's view: where each request lands.
 * @param control - The control asking.
 * @param requests - The host's request after a pick, and Try again's request for the control the retry made busy.
 * @returns Whether the control is asked to take focus, and how it reports that it has.
 */
export function listControlFocusOf(
    view: Pick<FoodChoiceListView, 'focusTarget' | 'landing'>,
    control: ListFocusTarget,
    requests: { readonly focus: ControlFocus; readonly landing: ControlFocus },
): ControlFocusProps {
    const afterPick = requests.focus.requested && isFocusTarget(view.focusTarget, control);
    const afterRetry = requests.landing.requested && isFocusTarget(view.landing, control);

    return {
        focusRequested: afterPick || afterRetry,
        onFocusRequestHandled: () => {
            if (afterPick) {
                requests.focus.onHandled();
            }

            if (afterRetry) {
                requests.landing.onHandled();
            }
        },
    };
}

/**
 * The focus props of one control of a settled row: it is asked to take focus when Try again unmounted because a retry
 * started and this is the control the retry lands on (`SettledLineView.landing`). Pure.
 *
 * @param view - The settled row's view.
 * @param control - The control asking, by its action kind.
 * @param landing - Try again's request for the control the retry made busy.
 * @returns Whether the control is asked to take focus, and how it reports that it has.
 */
export function settledControlFocusOf(
    view: Pick<SettledLineView, 'landing'>,
    control: SettledAction['kind'],
    landing: ControlFocus,
): ControlFocusProps {
    return {
        focusRequested: landing.requested && view.landing === control,
        onFocusRequestHandled: landing.onHandled,
    };
}
