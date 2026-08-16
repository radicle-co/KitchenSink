/**
 * @module @commise/features-cooking/voiceControlModel — the platform-neutral model layer for Cooking
 * Mode's VOICE CONTROL surface (US-006 / D-004, FR-033/FR-034).
 *
 * Pattern: **policy module + shared props contract**, the same prescription `stepNavigationModel` and
 * `sessionExtras` follow (§14.4). It holds the two things the web (`VoiceControlToggle.tsx`) and native
 * (`VoiceControlToggle.native.tsx`) leaves must NOT diverge on — what the control's states ARE, and when
 * the control may be operated — so neither leaf re-derives "is this pressable?" inline. That is exactly
 * how two platforms end up disagreeing about whether a denied microphone can be re-asked.
 *
 * Everything here is pure: no I/O, no platform SDK, no state. The recogniser's lifetime belongs to
 * `useCookingSession`; these components only render what it decided.
 */
import type { VoiceControlStatus } from './voiceControlPolicy';

/**
 * What the voice control shows the cook.
 *
 * Derived from {@link VoiceControlStatus} rather than restated, so a status the session can report and a
 * state the surface can render can never drift apart. `idle` is the one state a *session* cannot be in:
 * it means no session has been asked for, which is where Cooking Mode always starts — voice is opt-in,
 * and the microphone opens on a press and never on arrival.
 */
export type VoiceControlState = 'idle' | VoiceControlStatus;

/**
 * The props both {@link VoiceControlToggle} leaves accept.
 *
 * Purely CONTROLLED: the state arrives as a prop and the only intent leaves as a callback, so the
 * component owns no session state and holds nothing that could open a microphone by itself.
 */
export interface VoiceControlToggleProps {
    /** What the session currently is: off, listening, refused, or impossible on this platform. */
    readonly state: VoiceControlState;
    /** Requests the opposite of the current state. Never invoked from an inoperable state. */
    readonly onToggle: () => void;
}

/**
 * Whether the control may be operated at all.
 *
 * `denied` and `unsupported` are both SETTLED answers, not transient ones: the shared voice policy never
 * re-asks for a permission that was refused (re-asking in a loop would spam the OS dialog mid-recipe),
 * and a platform with no recogniser will not grow one while the cook stands there. So the control stays
 * mounted and explained — never removed, which would reflow the header under a cook's hands — but
 * pressing it does nothing.
 *
 * @param state - The state the session reported.
 * @returns `true` when a press should be wired to a handler.
 */
export function canToggleVoiceControl(state: VoiceControlState): boolean {
    return state === 'idle' || state === 'listening';
}

/**
 * Fill the `voiceControlName` template — the toggle's accessible name.
 *
 * Both leaves state this name EXPLICITLY rather than letting each platform's accessible-name calculation
 * concatenate the two visible text nodes: react-native-web joined them without a separator while the DOM
 * joined them with one, so the same control announced two different names on the two platforms. Composing
 * it here means the name is one piece of knowledge with one representation — and one that a locale can
 * reorder or punctuate.
 *
 * @param template - The localized template, e.g. `'{label} {state}'`.
 * @param label - The control's name, e.g. `'Voice control'`.
 * @param state - The current state's word, e.g. `'Listening'`.
 * @returns The accessible name.
 */
export function formatVoiceControlName(template: string, label: string, state: string): string {
    return template.replace('{label}', label).replace('{state}', state);
}

/**
 * Fill the `voiceRepeatAnnouncement` template — the sentence the `repeat` command speaks through the
 * screen's assertive live region.
 *
 * Both halves are already localized by the caller (the position through `formatStepPosition`, the
 * instruction from the recipe itself); this module owns only the ORDER and joining, which is one piece of
 * knowledge and therefore has one representation rather than a copy per platform screen.
 *
 * @param template - The localized template, e.g. `'{position}. {instruction}'`.
 * @param position - The rendered step position, e.g. `'Step 2 of 5'`.
 * @param instruction - The step's instruction text.
 * @returns The sentence to announce.
 */
export function formatStepAnnouncement(template: string, position: string, instruction: string): string {
    return template.replace('{position}', position).replace('{instruction}', instruction);
}
