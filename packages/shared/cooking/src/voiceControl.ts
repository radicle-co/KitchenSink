/**
 * The voice-command **port** and grammar for Cooking Mode (US-006, FR-033/FR-034).
 *
 * `@kitchensink/cooking-core` is platform-free: it depends on no browser API and no Expo SDK. This
 * module therefore holds only the two halves that need no platform — the *grammar* (a pure
 * transcript → command function) and the *port* the platform adapter satisfies. The real recogniser
 * lives in `@commise/features-cooking` (`voiceControl.ts`, over the Web Speech API), exactly as the
 * wake lock is split between {@link ./wakeLockPort.js} and its adapters.
 *
 * **Web only, deliberately — there is no native adapter, and none was forgotten.** Expo ships no
 * built-in speech recognition (`expo-speech` is text-to-speech, the opposite direction), so on-device
 * recognition would mean a new third-party native module and a microphone permission flow. US-006 is
 * *Should Have*, so T-014 scopes voice control to the web adapter; mobile keeps the tap/gesture
 * controls, which are the primary navigation on both platforms. Nothing here is web-specific, so a
 * later `voiceControl.native.ts` only has to satisfy {@link VoiceControlPort}.
 *
 * Two properties are load-bearing:
 *
 * 1. **The grammar is CLOSED and matched whole.** A transcript is recognised only if the entire
 *    utterance normalises to a declared phrase — never because it *contains* a keyword. A cook's
 *    "next door neighbour" or "pause the music" must resolve to `null`: a misfired `next` loses their
 *    place mid-recipe and a misfired `pause-timer` silently stops a timer they are relying on. When in
 *    doubt the system does nothing and the cook simply repeats themselves.
 * 2. **Listening is start-returns-its-own-disposer**, not a global `start()`/`stop()` pair — the
 *    recogniser's lifetime is exactly the caller's, so no unrelated caller can stop it and no handler
 *    can outlive the cooking session that installed it.
 */

/**
 * Every command Cooking Mode accepts by voice, as a value list.
 *
 * The list is the source of truth and {@link CookingVoiceCommand} is derived from it, so the union and
 * the iterable set can never drift apart.
 */
export const COOKING_VOICE_COMMANDS = ['next', 'back', 'start-timer', 'pause-timer', 'repeat'] as const;

/** A command the cook can issue by voice (US-006). */
export type CookingVoiceCommand = (typeof COOKING_VOICE_COMMANDS)[number];

/** The spoken phrases that resolve to each command. Every phrase must be unique across the table. */
export type VoiceCommandSynonyms = Readonly<Record<CookingVoiceCommand, readonly string[]>>;

/** Why a synonym table was rejected. */
export type VoiceGrammarDefect =
    /** Two entries claim the same phrase, so which command wins would depend on table order. */
    | 'duplicate-phrase'
    /** A phrase contains nothing a transcript could match, so it would match silence. */
    | 'empty-phrase';

/**
 * Raised when a {@link VoiceCommandSynonyms} table could not produce an unambiguous matcher.
 *
 * This is a programming error in the grammar, not a runtime input error — an unrecognised *transcript*
 * yields `null`, never a throw.
 */
export class InvalidVoiceGrammarError extends Error {
    public constructor(
        public readonly phrase: string,
        public readonly reason: VoiceGrammarDefect,
    ) {
        super(`Invalid voice grammar (${reason}): ${JSON.stringify(phrase)}`);
        this.name = 'InvalidVoiceGrammarError';
        Object.setPrototypeOf(this, InvalidVoiceGrammarError.prototype);
    }
}

/**
 * Type guard for {@link InvalidVoiceGrammarError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link InvalidVoiceGrammarError}.
 */
export function isInvalidVoiceGrammarError(error: unknown): error is InvalidVoiceGrammarError {
    return error instanceof InvalidVoiceGrammarError;
}

/**
 * The phrases Cooking Mode listens for, in English.
 *
 * Kept deliberately small. Every addition widens the surface on which a passing remark can be mistaken
 * for a command, and the cost of a false positive (a lost place, a stopped timer) is far higher than
 * the cost of a cook repeating a phrase. Notable exclusions, each for a reason:
 *
 * - bare **"stop"** — it reads as "stop listening" at least as often as "stop the timer";
 * - bare **"start"** — ambiguous between starting a timer and starting the recipe;
 * - **"last step"** — reads as "jump to the final step", not "go back".
 *
 * The grammar is English-only (see the module note): phrases are spoken *input*, so they cannot come
 * from the display-copy dictionary, and a localised grammar needs a per-locale table built with
 * {@link createVoiceCommandMatcher}.
 */
export const VOICE_COMMAND_SYNONYMS: VoiceCommandSynonyms = Object.freeze({
    next: Object.freeze(['next', 'next step', 'forward', 'go forward']),
    back: Object.freeze(['back', 'go back', 'previous', 'previous step']),
    'start-timer': Object.freeze(['start timer', 'start the timer', 'timer']),
    'pause-timer': Object.freeze(['pause', 'pause timer', 'pause the timer', 'stop timer', 'stop the timer']),
    repeat: Object.freeze(['repeat', 'repeat step', 'repeat that', 'say again', 'say that again']),
});

/** Resolves one speech transcript to a command, or to `null` when the utterance is not a command. */
export type VoiceCommandMatcher = (transcript: string) => CookingVoiceCommand | null;

/**
 * Reduces a transcript to its comparable form: lower-cased, stripped of everything that is not a
 * letter or digit, and with the resulting gaps collapsed to single spaces.
 *
 * Speech engines punctuate and capitalise inconsistently ("Next!", "next.", "Next step"), so the
 * comparison happens on this form rather than on the raw string.
 *
 * @param raw - The transcript (or declared phrase) to normalise.
 * @returns The normalised form; the empty string when nothing matchable remains.
 */
function normalizeTranscript(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Builds a {@link VoiceCommandMatcher} over a synonym table.
 *
 * Exported because it is the only way to *verify* the table's core invariant — that no phrase means
 * two things — and the only seam through which a future localised grammar can be introduced without
 * touching the matching logic.
 *
 * @param synonyms - The phrases to accept for each command.
 * @returns A pure matcher over the given table.
 * @throws {InvalidVoiceGrammarError} When a phrase is declared twice, or normalises to nothing.
 */
export function createVoiceCommandMatcher(synonyms: VoiceCommandSynonyms): VoiceCommandMatcher {
    const index = new Map<string, CookingVoiceCommand>();

    for (const command of COOKING_VOICE_COMMANDS) {
        for (const phrase of synonyms[command]) {
            const normalized = normalizeTranscript(phrase);

            if (normalized.length === 0) {
                throw new InvalidVoiceGrammarError(phrase, 'empty-phrase');
            }

            if (index.has(normalized)) {
                throw new InvalidVoiceGrammarError(phrase, 'duplicate-phrase');
            }

            index.set(normalized, command);
        }
    }

    return (transcript: string): CookingVoiceCommand | null => index.get(normalizeTranscript(transcript)) ?? null;
}

/**
 * Resolves a speech transcript to a Cooking Mode command using {@link VOICE_COMMAND_SYNONYMS}.
 *
 * Matching is whole-utterance: a transcript that merely *contains* a keyword ("nextdoor", "put the
 * next tray in") is not a command and yields `null`.
 *
 * @param transcript - One final transcript from the platform recogniser.
 * @returns The command, or `null` when the utterance is not one.
 */
export const matchVoiceCommand: VoiceCommandMatcher = createVoiceCommandMatcher(VOICE_COMMAND_SYNONYMS);

/** Receives each recognised command, in the order the cook spoke them. */
export type VoiceCommandListener = (command: CookingVoiceCommand) => void;

/** Stops recognition and detaches every listener it installed. Safe to call more than once. */
export type VoiceControlDisposer = () => void;

/**
 * Starts listening for cooking commands and returns the disposer that stops listening.
 *
 * An implementation MUST return normally (never throw) when the platform has no speech recognition, or
 * when the user denies microphone access — US-006 is *Should Have*, so voice control degrades to
 * nothing while tap and gesture navigation carry on. It MUST deliver only commands that
 * {@link matchVoiceCommand} recognised, and MUST NOT deliver anything after its disposer has run.
 */
export type VoiceControlPort = (onCommand: VoiceCommandListener) => VoiceControlDisposer;

/**
 * A voice-control port for environments with no recogniser — server rendering, tests, unsupported
 * browsers, and mobile (which has no adapter; see the module note).
 *
 * @sideEffect None. Present so callers never branch on `undefined`.
 */
export const noopVoiceControl: VoiceControlPort = () => (): void => {};
