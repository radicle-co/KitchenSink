import { describe, expect, it, vi } from 'vitest';

import {
    COOKING_VOICE_COMMANDS,
    InvalidVoiceGrammarError,
    VOICE_COMMAND_SYNONYMS,
    createVoiceCommandMatcher,
    isInvalidVoiceGrammarError,
    matchVoiceCommand,
    noopVoiceControl,
    type CookingVoiceCommand,
    type VoiceCommandSynonyms,
} from '../voiceControl.js';

/**
 * T-014 shared half — the platform-free voice-command grammar and port (US-006, FR-033/FR-034).
 *
 * The hazard these tests exist for is a FALSE POSITIVE: a misfired `next` mid-recipe loses the cook's
 * place, and a misfired `pause-timer` silently stops a timer they are relying on. So the grammar is
 * asserted in both directions — every intended phrase resolves, and everything else resolves to
 * `null` rather than to the nearest guess.
 */

/** Phrase → command expectations written out literally, so a swapped table entry FAILS here. */
const EXPECTED: ReadonlyArray<readonly [string, CookingVoiceCommand]> = [
    ['next', 'next'],
    ['next step', 'next'],
    ['forward', 'next'],
    ['go forward', 'next'],
    ['back', 'back'],
    ['go back', 'back'],
    ['previous', 'back'],
    ['previous step', 'back'],
    ['start timer', 'start-timer'],
    ['start the timer', 'start-timer'],
    ['timer', 'start-timer'],
    ['pause', 'pause-timer'],
    ['pause timer', 'pause-timer'],
    ['pause the timer', 'pause-timer'],
    ['stop timer', 'pause-timer'],
    ['stop the timer', 'pause-timer'],
    ['repeat', 'repeat'],
    ['repeat step', 'repeat'],
    ['repeat that', 'repeat'],
    ['say again', 'repeat'],
    ['say that again', 'repeat'],
];

describe('matchVoiceCommand — the recognised grammar', () => {
    it.each(EXPECTED)('maps %j to %j', (transcript, command) => {
        expect(matchVoiceCommand(transcript)).toBe(command);
    });

    it('recognises every phrase declared in the synonym table', () => {
        // Catches a phrase that the table declares but normalisation cannot reach (e.g. one carrying a
        // character class the normaliser strips to nothing).
        for (const command of COOKING_VOICE_COMMANDS) {
            for (const phrase of VOICE_COMMAND_SYNONYMS[command]) {
                expect(matchVoiceCommand(phrase)).toBe(command);
            }
        }
    });

    it('declares at least one phrase for every command in the union', () => {
        // Without this, adding a command to the union but forgetting its phrases ships a command that
        // can never be spoken.
        for (const command of COOKING_VOICE_COMMANDS) {
            expect(VOICE_COMMAND_SYNONYMS[command].length).toBeGreaterThan(0);
        }
    });

    it('covers all five commands', () => {
        expect(new Set(EXPECTED.map(([, command]) => command))).toEqual(new Set(COOKING_VOICE_COMMANDS));
    });
});

describe('matchVoiceCommand — normalisation', () => {
    it.each([['NEXT'], ['Next'], ['nExT']])('is case-insensitive for %j', (transcript) => {
        expect(matchVoiceCommand(transcript)).toBe('next');
    });

    it.each([['  next step  '], ['next   step'], ['\tnext\nstep\n'], ['next step']])(
        'is whitespace-tolerant for %j',
        (transcript) => {
            expect(matchVoiceCommand(transcript)).toBe('next');
        },
    );

    it.each([['Next!'], ['next.'], ['next,'], ['"next"']])('ignores speech punctuation in %j', (transcript) => {
        expect(matchVoiceCommand(transcript)).toBe('next');
    });

    it('combines case, whitespace and punctuation tolerance', () => {
        expect(matchVoiceCommand('  Say That Again?  ')).toBe('repeat');
    });
});

describe('matchVoiceCommand — refuses to guess', () => {
    it.each([['nextdoor'], ['nexts'], ['backyard'], ['repeatedly'], ['timerless'], ['pauses'], ['gobacknow']])(
        'does not match %j, where a keyword sits inside another word',
        (transcript) => {
            expect(matchVoiceCommand(transcript)).toBeNull();
        },
    );

    it.each([
        ['next door neighbour'],
        ['put the next tray in'],
        ['go back to the store'],
        ['pause the music'],
        ['set a timer for the laundry'],
        ['start'],
        ['stop'],
        ['step'],
        ['the'],
    ])('does not match the unbounded utterance %j', (transcript) => {
        // A partial/containment match here is precisely what loses the cook's place mid-recipe.
        expect(matchVoiceCommand(transcript)).toBeNull();
    });

    it.each([[''], ['   '], ['\n\t'], ['...'], ['!?']])(
        'returns null for the empty-ish transcript %j',
        (transcript) => {
            // Silence must never resolve to a command.
            expect(matchVoiceCommand(transcript)).toBeNull();
        },
    );

    it('does not throw on any input it cannot recognise', () => {
        expect(() => matchVoiceCommand('🍳 pan fry until golden')).not.toThrow();
        expect(matchVoiceCommand('🍳 pan fry until golden')).toBeNull();
    });
});

describe('VOICE_COMMAND_SYNONYMS — table integrity', () => {
    it('maps no phrase to two different commands', () => {
        const seen = new Map<string, CookingVoiceCommand>();

        for (const command of COOKING_VOICE_COMMANDS) {
            for (const phrase of VOICE_COMMAND_SYNONYMS[command]) {
                expect(seen.has(phrase)).toBe(false);
                seen.set(phrase, command);
            }
        }
    });

    it('is frozen, so no consumer can widen the grammar at runtime', () => {
        expect(Object.isFrozen(VOICE_COMMAND_SYNONYMS)).toBe(true);

        for (const command of COOKING_VOICE_COMMANDS) {
            expect(Object.isFrozen(VOICE_COMMAND_SYNONYMS[command])).toBe(true);
        }
    });
});

describe('createVoiceCommandMatcher — rejects a defective grammar', () => {
    /** A synonym table with every command populated, so only the field under test differs. */
    function makeSynonyms(overrides: Partial<Record<CookingVoiceCommand, readonly string[]>>): VoiceCommandSynonyms {
        return {
            next: ['next'],
            back: ['back'],
            'start-timer': ['start timer'],
            'pause-timer': ['pause'],
            repeat: ['repeat'],
            ...overrides,
        };
    }

    it('throws InvalidVoiceGrammarError when one phrase would mean two commands', () => {
        // Ambiguity resolved by table order is the worst kind of bug: "pause" would mean "back" or
        // "pause-timer" depending on nothing the reader can see.
        const build = (): unknown => createVoiceCommandMatcher(makeSynonyms({ back: ['back', 'pause'] }));

        expect(build).toThrow(InvalidVoiceGrammarError);
        try {
            build();
            expect.unreachable('a duplicate phrase must not build a matcher');
        } catch (error) {
            expect(isInvalidVoiceGrammarError(error)).toBe(true);
            expect((error as InvalidVoiceGrammarError).reason).toBe('duplicate-phrase');
            expect((error as InvalidVoiceGrammarError).phrase).toBe('pause');
            expect((error as InvalidVoiceGrammarError).name).toBe('InvalidVoiceGrammarError');
        }
    });

    it('treats a phrase repeated within one command as a duplicate', () => {
        expect(() => createVoiceCommandMatcher(makeSynonyms({ next: ['next', 'Next'] }))).toThrow(
            InvalidVoiceGrammarError,
        );
    });

    it('throws InvalidVoiceGrammarError for a phrase that normalises to nothing', () => {
        // An empty key would make silence — a transcript of "" — resolve to a command.
        const build = (): unknown => createVoiceCommandMatcher(makeSynonyms({ repeat: ['repeat', '  '] }));

        expect(build).toThrow(InvalidVoiceGrammarError);
        try {
            build();
            expect.unreachable('an empty phrase must not build a matcher');
        } catch (error) {
            expect((error as InvalidVoiceGrammarError).reason).toBe('empty-phrase');
        }
    });

    it('builds a working matcher for a valid custom grammar', () => {
        const match = createVoiceCommandMatcher(makeSynonyms({ next: ['onwards'] }));

        expect(match('Onwards!')).toBe('next');
        expect(match('next')).toBeNull();
    });

    it('does not leak the built index — the returned matcher is pure', () => {
        const match = createVoiceCommandMatcher(makeSynonyms({}));

        expect(match('next')).toBe('next');
        expect(match('next')).toBe('next');
    });
});

describe('isInvalidVoiceGrammarError', () => {
    it('accepts the error it guards', () => {
        expect(isInvalidVoiceGrammarError(new InvalidVoiceGrammarError('x', 'empty-phrase'))).toBe(true);
    });

    it('rejects anything else', () => {
        expect(isInvalidVoiceGrammarError(new Error('InvalidVoiceGrammarError'))).toBe(false);
        expect(isInvalidVoiceGrammarError('InvalidVoiceGrammarError')).toBe(false);
        expect(isInvalidVoiceGrammarError(null)).toBe(false);
    });

    it('survives instanceof across the prototype fix-up', () => {
        expect(new InvalidVoiceGrammarError('x', 'duplicate-phrase')).toBeInstanceOf(Error);
        expect(new InvalidVoiceGrammarError('x', 'duplicate-phrase')).toBeInstanceOf(InvalidVoiceGrammarError);
    });
});

describe('noopVoiceControl', () => {
    it('never delivers a command', () => {
        const onCommand = vi.fn();

        noopVoiceControl(onCommand);

        expect(onCommand).not.toHaveBeenCalled();
    });

    it('returns a disposer that is safe to call more than once', () => {
        const stop = noopVoiceControl(vi.fn());

        expect(stop).toBeTypeOf('function');
        expect(() => {
            stop();
            stop();
        }).not.toThrow();
    });
});
