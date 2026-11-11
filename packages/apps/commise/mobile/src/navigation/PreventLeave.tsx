/**
 * @module navigation/PreventLeave — the editor route's guard against leaving with a photo not uploaded yet (staff-ux
 * SPECIFY 2026-11-10). React Navigation's `usePreventRemove` catches every way off the screen — × (`goBack`), Android
 * Back, the header and the iOS edge swipe — so one guard serves all of them, and × asks once, not twice.
 *
 * While `when` holds, a leave is stopped and handed to `onBlocked` (the editor's ask, `useEditorPhotos`'s
 * `leave.request`); the ask's "Leave without photos" replays the very action that was stopped. It is an orchestration
 * component that renders nothing.
 *
 * Sheets still answer Android Back first: they register through `BackInterceptProvider`, which sits outside the
 * navigation container on purpose (ADR-0056); this guard acts only on the screen's own removal.
 *
 * @pattern Adapter over React Navigation's `usePreventRemove` — the navigator's guard, behind the editor's own vocabulary
 */
import { useNavigation, usePreventRemove } from '@react-navigation/native';

/** Props for {@link PreventLeave}. */
export interface PreventLeaveProps {
    /** Stop leaving while this holds: a photo is not uploaded yet. */
    readonly when: boolean;
    /** A leave was stopped: ask, and call `proceed` to leave after all. */
    readonly onBlocked: (proceed: () => void) => void;
}

/**
 * Hold the screen while a photo would be lost.
 *
 * @returns Nothing: the guard is behaviour only.
 * @sideEffect Registers a removal guard on the current screen; `proceed` dispatches the stopped navigation action.
 */
export function PreventLeave({ when, onBlocked }: PreventLeaveProps): null {
    const navigation = useNavigation();

    usePreventRemove(when, ({ data }) => onBlocked(() => navigation.dispatch(data.action)));

    return null;
}
