import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ExpoWebSpeechRecognition,
    getRecognitionInstances,
    getSpeechRecognitionCalls,
    onlyRecognitionInstance,
    resetSpeechRecognitionStub,
    setPermissionRequestRejects,
    setRecognitionConstructionFails,
    setSpeechRecognitionPermission,
} from './expoSpeechRecognitionStub';
import { MAX_CONSECUTIVE_RESTARTS, startNativeVoiceControl } from '../voiceControl.native';
import { MAX_CONSECUTIVE_RESTARTS as POLICY_MAX_CONSECUTIVE_RESTARTS } from '../voiceControlPolicy';

/**
 * Native (Expo) voice-control adapter (US-006, FR-033/FR-034).
 *
 * These tests prove the adapter's CONTRACT against a recording stub. They deliberately prove nothing
 * about the native module linking or capturing audio on a real device — `expo-speech-recognition` is
 * published for SDK 56 while this app runs Expo 57, and only a physical build can settle that (see the
 * ⚠️ note in `../voiceControl.native.ts`).
 *
 * Four regressions are guarded:
 *
 * 1. Starting recognition without the OS permission — on Android the recogniser silently never fires,
 *    on iOS the app is killed for a missing usage description.
 * 2. A denied permission breaking Cooking Mode: it must degrade to a working no-op, never throw, and
 *    never re-ask in a loop (which would spam the OS dialog mid-recipe).
 * 3. A false positive — an utterance that is not a command reaching `onCommand` and losing the cook's
 *    place mid-recipe.
 * 4. Platform drift — the restart/latch/dispose policy diverging between web and native.
 */

/** Flushes the permission promise chain, which the synchronous port deliberately does not await. */
async function settlePermission(): Promise<void> {
    await new Promise<void>((done) => {
        setTimeout(done, 0);
    });
}

/** Builds a `result` event shaped like the recogniser's, from `resultIndex` onward. */
function resultEvent(
    transcripts: readonly string[],
    options: { resultIndex?: number; isFinal?: boolean } = {},
): unknown {
    const results = transcripts.map((transcript) => ({
        isFinal: options.isFinal ?? true,
        length: 1,
        0: { transcript },
    }));

    return { resultIndex: options.resultIndex ?? 0, results };
}

/** Counts stub calls of one kind. */
function callCount(kind: 'construct' | 'start' | 'stop' | 'abort' | 'request-permission'): number {
    return getSpeechRecognitionCalls().filter((call) => call.kind === kind).length;
}

/** Starts a session and waits for the permission gate to settle. */
async function startAndSettle(onCommand: (command: string) => void): Promise<() => void> {
    const dispose = startNativeVoiceControl(onCommand);
    await settlePermission();

    return dispose;
}

beforeEach(() => {
    resetSpeechRecognitionStub();
});

describe('startNativeVoiceControl — permission gate', () => {
    it('requests OS permission before constructing any recogniser', () => {
        startNativeVoiceControl(vi.fn());

        // Synchronously — before the gate settles — nothing may have been constructed or started.
        expect(getRecognitionInstances()).toHaveLength(0);
        expect(callCount('start')).toBe(0);
    });

    it('starts recognition once permission is granted', async () => {
        await startAndSettle(vi.fn());

        expect(callCount('request-permission')).toBe(1);
        expect(onlyRecognitionInstance().startCount).toBe(1);
    });

    it('does NOT construct or start a recogniser when permission is denied', async () => {
        setSpeechRecognitionPermission(false);

        await startAndSettle(vi.fn());

        expect(callCount('request-permission')).toBe(1);
        expect(getRecognitionInstances()).toHaveLength(0);
        expect(callCount('construct')).toBe(0);
        expect(callCount('start')).toBe(0);
    });

    it('returns a working disposer when permission is denied, and neither throws nor re-asks', async () => {
        setSpeechRecognitionPermission(false);
        const onCommand = vi.fn();

        const dispose = startNativeVoiceControl(onCommand);

        expect(dispose).toBeTypeOf('function');
        await settlePermission();
        expect(() => {
            dispose();
        }).not.toThrow();
        expect(() => {
            dispose();
        }).not.toThrow();
        await settlePermission();

        // A denial is a settled answer. Re-asking would spam the OS dialog in the middle of a recipe.
        expect(callCount('request-permission')).toBe(1);
        expect(onCommand).not.toHaveBeenCalled();
    });

    it('treats a permission request that rejects exactly as a denial', async () => {
        setPermissionRequestRejects(true);

        const dispose = startNativeVoiceControl(vi.fn());
        await settlePermission();

        expect(getRecognitionInstances()).toHaveLength(0);
        expect(() => {
            dispose();
        }).not.toThrow();
    });

    it('does not start when the session was disposed before permission resolved', async () => {
        const dispose = startNativeVoiceControl(vi.fn());
        dispose();

        await settlePermission();

        // The cook left Cooking Mode while the dialog was up; granting it afterwards must not open the
        // microphone behind their back.
        expect(getRecognitionInstances()).toHaveLength(0);
        expect(callCount('start')).toBe(0);
    });

    it('degrades silently when the native module cannot be constructed', async () => {
        setRecognitionConstructionFails(true);
        const onCommand = vi.fn();

        const dispose = startNativeVoiceControl(onCommand);
        await settlePermission();

        expect(() => {
            dispose();
        }).not.toThrow();
        expect(callCount('start')).toBe(0);
        expect(onCommand).not.toHaveBeenCalled();
    });
});

describe('startNativeVoiceControl — recognition configuration', () => {
    it('listens continuously for final results only, in the grammar language', async () => {
        await startAndSettle(vi.fn());
        const recognition = onlyRecognitionInstance();

        // Non-continuous recognition stops after the first phrase — one command per session. Interim
        // results would deliver the same phrase repeatedly as it is refined.
        expect(recognition.continuous).toBe(true);
        expect(recognition.interimResults).toBe(false);
        expect(recognition.lang).toBe('en-US');
    });

    it('does not propagate a start() that the platform rejects', async () => {
        const spy = vi.spyOn(ExpoWebSpeechRecognition.prototype, 'start').mockImplementation(function (
            this: ExpoWebSpeechRecognition,
        ) {
            this.startCount += 1;
            throw new Error('InvalidStateError');
        });

        try {
            const dispose = startNativeVoiceControl(vi.fn());
            await expect(settlePermission()).resolves.toBeUndefined();

            expect(spy).toHaveBeenCalled();
            expect(() => {
                dispose();
            }).not.toThrow();
        } finally {
            spy.mockRestore();
        }
    });
});

describe('startNativeVoiceControl — command delivery', () => {
    it('delivers the matched command for a recognised phrase', async () => {
        const onCommand = vi.fn();

        await startAndSettle(onCommand);
        onlyRecognitionInstance().emit('result', resultEvent(['Next step']));

        expect(onCommand).toHaveBeenCalledTimes(1);
        expect(onCommand).toHaveBeenCalledWith('next');
    });

    it.each([
        ['go back', 'back'],
        ['start timer', 'start-timer'],
        ['pause', 'pause-timer'],
        ['say again', 'repeat'],
    ])('delivers %j as %j', async (transcript, command) => {
        const onCommand = vi.fn();

        await startAndSettle(onCommand);
        onlyRecognitionInstance().emit('result', resultEvent([transcript]));

        expect(onCommand).toHaveBeenCalledWith(command);
    });

    it('does not invoke the callback at all for an unrecognised utterance', async () => {
        const onCommand = vi.fn();

        await startAndSettle(onCommand);
        onlyRecognitionInstance().emit('result', resultEvent(['next door neighbour']));

        expect(onCommand).not.toHaveBeenCalled();
    });

    it('ignores interim (non-final) results', async () => {
        const onCommand = vi.fn();

        await startAndSettle(onCommand);
        onlyRecognitionInstance().emit('result', resultEvent(['next'], { isFinal: false }));

        expect(onCommand).not.toHaveBeenCalled();
    });

    it('processes only the results new since resultIndex', async () => {
        const onCommand = vi.fn();

        await startAndSettle(onCommand);
        // The recogniser keeps earlier results in the list; re-reading them would replay old commands.
        onlyRecognitionInstance().emit('result', resultEvent(['next', 'back'], { resultIndex: 1 }));

        expect(onCommand).toHaveBeenCalledTimes(1);
        expect(onCommand).toHaveBeenCalledWith('back');
    });
});

describe('startNativeVoiceControl — disposal', () => {
    it('stops recognition and detaches every listener it attached', async () => {
        const dispose = await startAndSettle(vi.fn());
        const recognition = onlyRecognitionInstance();
        expect(recognition.listeners.length).toBeGreaterThan(0);

        dispose();

        // A surviving listener would keep restarting recognition — and keep the microphone live — long
        // after the cook left Cooking Mode.
        expect(recognition.listeners).toEqual([]);
        expect(recognition.stopCount).toBe(1);
    });

    it('is idempotent — disposing twice stops recognition once', async () => {
        const dispose = await startAndSettle(vi.fn());
        dispose();

        expect(() => {
            dispose();
        }).not.toThrow();
        expect(onlyRecognitionInstance().stopCount).toBe(1);
    });

    it('delivers no command from an event that arrives after disposal', async () => {
        const onCommand = vi.fn();

        const dispose = await startAndSettle(onCommand);
        const recognition = onlyRecognitionInstance();
        const resultListener = recognition.listenerFor('result');
        dispose();

        // Re-invoke the detached listener directly: the platform can dispatch an event that was already
        // queued when the disposer ran, so detaching alone is not the whole guarantee.
        resultListener?.(resultEvent(['next']));

        expect(onCommand).not.toHaveBeenCalled();
    });
});

describe('startNativeVoiceControl — restart behaviour', () => {
    it('restarts recognition when the platform ends it while the session is live', async () => {
        await startAndSettle(vi.fn());
        const recognition = onlyRecognitionInstance();
        recognition.emit('end');

        // Recognisers end after a few seconds of silence; without the restart, voice control dies
        // partway through the recipe with no visible cause.
        expect(recognition.startCount).toBe(2);
    });

    it('does NOT restart after the session has been disposed', async () => {
        const dispose = await startAndSettle(vi.fn());
        const recognition = onlyRecognitionInstance();
        dispose();
        recognition.emit('end');

        expect(recognition.startCount).toBe(1);
    });

    it('does NOT restart after a fatal error such as a denied microphone', async () => {
        await startAndSettle(vi.fn());
        const recognition = onlyRecognitionInstance();
        recognition.emit('error', { error: 'not-allowed' });
        recognition.emit('end');

        expect(recognition.startCount).toBe(1);
    });

    it('still restarts after a transient error such as silence', async () => {
        await startAndSettle(vi.fn());
        const recognition = onlyRecognitionInstance();
        recognition.emit('error', { error: 'no-speech' });
        recognition.emit('end');

        expect(recognition.startCount).toBe(2);
    });

    it('bounds consecutive restarts so a recogniser that cannot start cannot spin', async () => {
        await startAndSettle(vi.fn());
        const recognition = onlyRecognitionInstance();

        for (let attempt = 0; attempt < MAX_CONSECUTIVE_RESTARTS + 5; attempt += 1) {
            recognition.emit('end');
        }

        expect(recognition.startCount).toBe(MAX_CONSECUTIVE_RESTARTS + 1);
    });

    it('replenishes the restart budget once a result proves the recogniser is alive', async () => {
        await startAndSettle(vi.fn());
        const recognition = onlyRecognitionInstance();

        for (let attempt = 0; attempt < MAX_CONSECUTIVE_RESTARTS; attempt += 1) {
            recognition.emit('end');
        }

        recognition.emit('result', resultEvent(['next']));
        recognition.emit('end');

        expect(recognition.startCount).toBe(MAX_CONSECUTIVE_RESTARTS + 2);
    });
});

describe('voice control — both platforms share ONE policy', () => {
    /** The web adapter's public surface, as loaded by absolute path (see the note in the test). */
    interface WebVoiceControlModule {
        readonly MAX_CONSECUTIVE_RESTARTS: number;
    }

    it('binds the native adapter to the shared policy, not a copy of it', () => {
        expect(MAX_CONSECUTIVE_RESTARTS).toBe(POLICY_MAX_CONSECUTIVE_RESTARTS);
    });

    it('exposes the SAME restart budget on web and on native', async () => {
        // Loaded by absolute path on purpose: this config's `preferNativeLeaves` resolver rewrites any
        // RELATIVE `../voiceControl` import to the `.native` leaf, so the web module is unreachable that
        // way — and an assertion that silently compared native to itself would prove nothing.
        const webPath = pathToFileURL(resolve(process.cwd(), 'src/voiceControl.ts')).href;
        const webModule = (await import(/* @vite-ignore */ webPath)) as WebVoiceControlModule;

        expect(webModule.MAX_CONSECUTIVE_RESTARTS).toBe(POLICY_MAX_CONSECUTIVE_RESTARTS);
    });

    it.each(['src/voiceControl.ts', 'src/voiceControl.native.ts'])(
        '%s delegates the session policy instead of re-implementing it',
        (relativePath) => {
            const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');

            // Structural, because a behavioural check cannot catch a copy that happens to agree today.
            // If either adapter grows its own listener wiring or its own budget, the platforms have
            // started to drift and a fix to one will silently miss the other.
            expect(source).toContain("from './voiceControlPolicy'");
            expect(source).not.toMatch(/addEventListener\(/);
            expect(source).not.toMatch(/MAX_CONSECUTIVE_RESTARTS\s*=/);
        },
    );
});
