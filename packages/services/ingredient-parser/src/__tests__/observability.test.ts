/**
 * `observability.scrub_event` — the Sentry `before_send` that keeps a cook's ingredient line out of Sentry.
 *
 * ## Why it is driven through a real interpreter
 *
 * The scrubber is Python and the repository's Python is exercised through its own interpreter (the handler's
 * integration tier does the same); there is no pytest in the toolchain. The module imports `sentry_sdk` only
 * inside `init`, so this runs on a bare `python3` with no SDK and no engine installed.
 *
 * ## What must hold, and why each case exists
 *
 * `report(failure)` hands Sentry a real exception, and the engine's exceptions can ECHO the line they choked on
 * (the handler's own comment on `str(failure)` says so). Three places carry that text: the exception VALUE, the
 * stack frames' captured local VARIABLES (`parse_line(line)` has the sentence in scope), and any log entry or
 * breadcrumb. Each is asserted separately, because a scrubber that clears only the value passes a test that only
 * looks at the value.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHRASE = '2 cups of grandma’s secret flour';

/** Run `scrub_event` over an event in a real interpreter and return what it answers. */
function scrub(event: unknown): Record<string, unknown> {
    const program = [
        'import json, sys',
        'sys.path.insert(0, sys.argv[1])',
        'from observability import scrub_event',
        'print(json.dumps(scrub_event(json.loads(sys.argv[2]), {})))',
    ].join('\n');

    return JSON.parse(
        execFileSync('python3', ['-I', '-c', program, sourceDirectory, JSON.stringify(event)], { encoding: 'utf8' }),
    ) as Record<string, unknown>;
}

const frame = { filename: 'handler.py', function: 'parse_line', lineno: 110, vars: { line: PHRASE, n: 3 } };
const chained = {
    exception: {
        values: [
            { type: 'KeyError', value: `no such unit in '${PHRASE}'`, stacktrace: { frames: [frame] } },
            { type: 'ValueError', value: PHRASE, stacktrace: { frames: [frame, frame] } },
        ],
    },
};

describe('scrub_event', () => {
    it('⛔ removes every exception value, including the chained cause, and keeps the type', () => {
        const values = (scrub(chained)['exception'] as { values: Record<string, unknown>[] }).values;

        expect(values.map((value) => value['type'])).toEqual(['KeyError', 'ValueError']);
        expect(values.map((value) => value['value'] ?? null)).toEqual([null, null]);
    });

    it('⛔ keeps the stack (file, function, line) and drops the captured local variables', () => {
        const values = (scrub(chained)['exception'] as { values: { stacktrace: { frames: object[] } }[] }).values;
        const frames = values.flatMap((value) => value.stacktrace.frames);

        expect(frames).toHaveLength(3);

        for (const kept of frames) {
            expect(kept).toMatchObject({ filename: 'handler.py', function: 'parse_line', lineno: 110 });
            expect(kept).not.toHaveProperty('vars');
        }
    });

    it('⛔ leaves the phrase nowhere in the serialized event', () => {
        const event = {
            ...chained,
            logentry: { message: `failed on ${PHRASE}`, params: [PHRASE] },
            message: `failed on ${PHRASE}`,
            breadcrumbs: { values: [{ category: 'log', message: PHRASE }] },
        };

        expect(JSON.stringify(scrub(event))).not.toContain('grandma');
    });

    it('is a no-op on an event with no exception (never throws on an unexpected shape)', () => {
        expect(scrub({ level: 'info', tags: { a: 'b' } })).toEqual({ level: 'info', tags: { a: 'b' } });
        expect(scrub({ exception: { values: [{ type: 'E' }] } })).toEqual({ exception: { values: [{ type: 'E' }] } });
    });

    it('⛔ init() installs the scrubber and refuses to capture frame locals (the wiring, not just the function)', () => {
        // A stand-in `sentry_sdk` records the keywords `init` was called with: a scrubber nobody registered
        // scrubs nothing, and the function-level cases above would stay green.
        const program = [
            'import json, os, sys, types',
            'sys.path.insert(0, sys.argv[1])',
            'seen = {}',
            'stub = types.ModuleType("sentry_sdk")',
            'stub.init = lambda **kw: seen.update(kw)',
            'sys.modules["sentry_sdk"] = stub',
            'os.environ["SENTRY_DSN"] = "https://k@example.invalid/1"',
            'import observability',
            'ok = observability.init("v1")',
            'print(json.dumps({"ok": ok, "beforeSendIsScrubber": seen.get("before_send") is observability.scrub_event,',
            '  "locals": seen.get("include_local_variables"), "pii": seen.get("send_default_pii")}))',
        ].join('\n');
        const answer = JSON.parse(
            execFileSync('python3', ['-I', '-c', program, sourceDirectory], { encoding: 'utf8' }),
        ) as Record<string, unknown>;

        expect(answer).toEqual({ ok: true, beforeSendIsScrubber: true, locals: false, pii: false });
    });
});
