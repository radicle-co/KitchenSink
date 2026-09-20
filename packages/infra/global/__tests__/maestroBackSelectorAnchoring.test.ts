/**
 * ⛔ NO MAESTRO FLOW MAY SELECT `Back` WITHOUT AN ANCHOR — because the OPERATING SYSTEM answers to that name.
 *
 * Two facts that are individually harmless and jointly produce a test that passes while proving nothing:
 *
 *  1. **A Maestro selector matches the WHOLE string, not a substring** (verified in the pinned CLI's
 *     bytecode and the vendor docs — a partial match has to be written `.*Back.*`).
 *  2. **Under THREE-BUTTON navigation Android publishes `com.android.systemui:id/back`, whose accessible
 *     name is exactly `Back`.** Gestural navigation publishes none, which is why this never reproduces on a
 *     gestural emulator and always does in CI.
 *
 * The app labels its recipe-detail and wizard back affordances literally `Back`, so the names COLLIDE, and
 * each selector form fails differently — all three silently, in the PASS direction:
 *
 *  - `assertVisible: 'Back'` is satisfied by the OS on ANY screen, including one where the app drew no
 *    header at all. It passes against precisely the regression it exists to catch.
 *  - `tapOn: 'Back'` has two matches and may tap the OS button, which pops the surface too — so the flow
 *    navigates, goes green, and exercises none of the app's control.
 *  - ⛔ `scrollUntilVisible: element: 'Back'` is the worst: the system bar is visible at ALL times, so the
 *    scroll is satisfied on ENTRY, returns without moving, and the following tap fires at the wrong scroll
 *    position. Two flows used that idiom to scroll back UP to a `Back` living inside a ScrollView.
 *
 * ⚠️ THIS EXISTS BECAUSE A COMMENT COULD NOT HOLD THE LINE. `collectionsPull.yaml` carried a prose note
 * enumerating the flows that still had a bare selector; three of the six it named were anchored in the very
 * commit that shipped the note, so it doubled the apparent residual and sent the next reader at files that
 * were already fixed. A count maintained by hand goes stale the moment anyone fixes one — which is the same
 * way ADR-0004's NAT consumer list rotted. So the rule is asserted over the tree and nothing is enumerated.
 *
 * The fix in every case is to anchor the selector RELATIVELY — `above:` a text only the app draws (the
 * recipe title, the wizard's `Step N of 4`). The app's control sits above that text inside the surface; the
 * system bar sits at the bottom of the display and is above nothing, so position is a clean discriminator.
 *
 * ⚠️ WHAT A GREEN RUN EARNS — stated as the STRUCTURAL limit rather than a list of exceptions, because a
 * list of exceptions is the copied roster that rots (the same failure as the flow count this guard
 * replaced, and as ADR-0004's NAT consumers).
 *
 * ⛔ THIS IS A LINE-ORIENTED SCANNER OVER YAML TEXT, NOT A YAML PARSE. It assumes one key per line, with
 * its value on that line or in a more-indented block beneath it, and it judges a block anchored only by a
 * key naming a position RELATIVE TO ANOTHER ELEMENT. Any spelling that breaks that assumption is invisible
 * to it and no test here claims otherwise — a flow mapping (`- tapOn: { text: Back }`), a trailing comment
 * after the value, an `${E2E_…}` variable that resolves to `Back`, or a regex written to match only it.
 * Those are instances of the one limit, not a roster to keep topped up.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FLOW_ROOT = 'packages/apps/commise/mobile/.maestro';

/** Every committed flow, repo-relative. */
function flowFiles(): readonly string[] {
    return execFileSync('git', ['ls-files', `${FLOW_ROOT}/**/*.yaml`, `${FLOW_ROOT}/*.yaml`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((line) => line.length > 0);
}

/**
 * Every unanchored `Back` selector in one flow, as `file:line`.
 *
 * ⛔ IT MUST CATCH THE MULTI-LINE FORM, because that is the form this guard's own error message tells you
 * to write. An earlier version was a single `$`-anchored line regex, which meant the remediation's taught
 * shape escaped it the moment the anchor was left off:
 *
 *     - tapOn:
 *           text: 'Back'      # no `above:` — unanchored, and a line-scoped detector sees nothing
 *
 * Its good fixture was literally that shape PLUS an anchor, so it could not tell the two apart and the
 * header's claim to close the class was false. Unquoted `- tapOn: Back` — valid YAML — escaped too.
 *
 * So both forms are handled. A selector key with a value on the same line is judged there; a selector key
 * with NO value opens a block, and the block is unanchored unless it carries a relative positional key.
 * Quoting is optional throughout.
 *
 * ⚠️ Comment lines are skipped rather than the file being pre-stripped: every flow now explains this hazard
 * in prose that QUOTES the bad form, and a guard that read its own rationale as a violation would be
 * unfixable. Line numbers are preserved so the report points at the real site.
 *
 * @param source - The flow's YAML.
 * @param file - Repo-relative path, used to build the report.
 * @returns Each offending site as `file:line`. Pure.
 */
export function unanchoredBackSelectors(source: string, file: string): readonly string[] {
    const SELECTOR_KEYS = String.raw`tapOn|assertVisible|assertNotVisible|element`;
    /** `- tapOn: Back` / `- tapOn: 'Back'` — the whole value on the key's own line. */
    const inline = new RegExp(String.raw`^\s*-?\s*(?:${SELECTOR_KEYS}):\s*(['"]?)Back\1\s*$`, 'u');
    /** `- tapOn:` with nothing after it — opens a block whose keys follow, more indented. */
    const opener = new RegExp(String.raw`^(\s*)-?\s*(?:${SELECTOR_KEYS}):\s*$`, 'u');
    /** `text: 'Back'` inside such a block. */
    const backText = /^\s*text:\s*(['"]?)Back\1\s*$/u;
    /**
     * Any RELATIVE positional key — what makes a block anchored.
     *
     * ⛔ `index:` is deliberately NOT here. It is an ordinal among a selector's own matches, so
     * `{ text: Back, index: 0 }` picks one of the OS bar and the app control BY HIERARCHY ORDER and
     * discriminates nothing — admitting it would be a pass-direction hole in a guard whose whole subject is
     * pass-direction holes. Every key below names a position RELATIVE TO ANOTHER ELEMENT, which is what the
     * app's control has and the system bar does not.
     */
    const anchorKey = /^\s*(?:above|below|leftOf|rightOf|containsChild|childOf):/u;

    const lines = source.split('\n');
    const isComment = (line: string): boolean => line.trimStart().startsWith('#');
    const offenders: string[] = [];

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';

        if (isComment(line)) {
            continue;
        }

        if (inline.test(line)) {
            offenders.push(`${file}:${index + 1}`);
            continue;
        }

        const opened = opener.exec(line);

        if (opened === null) {
            continue;
        }

        // Collect the block: every following line indented deeper than the opener, comments skipped.
        const openIndent = (opened[1] ?? '').length;
        let namesBack = false;
        let anchored = false;
        let cursor = index + 1;

        for (; cursor < lines.length; cursor += 1) {
            const candidate = lines[cursor] ?? '';

            if (candidate.trim() === '' || isComment(candidate)) {
                continue;
            }

            const indent = candidate.length - candidate.trimStart().length;

            if (indent <= openIndent) {
                break;
            }

            if (backText.test(candidate)) {
                namesBack = true;
            }

            if (anchorKey.test(candidate)) {
                anchored = true;
            }
        }

        if (namesBack && !anchored) {
            offenders.push(`${file}:${index + 1}`);
        }
    }

    return offenders;
}

describe('Maestro flows — a `Back` selector is anchored, because the OS answers to that name too', () => {
    it('⛔ has no flow selecting a bare `Back`', () => {
        const offenders = flowFiles().flatMap((file) =>
            unanchoredBackSelectors(readFileSync(join(REPO_ROOT, file), 'utf8'), file),
        );

        expect(
            offenders,
            'Anchor each of these with `above:` a text only the app draws — the recipe title on a detail ' +
                'screen, `Step 1 of 4` in the wizard. See `recipes/listDetail.yaml` for the shape.',
        ).toEqual([]);
    });

    /**
     * ⛔ THE DETECTOR IS TESTED, not just run. A guard over a tree that already satisfies it is
     * indistinguishable from a guard whose matcher is wrong in a direction this tree never exercises —
     * which is exactly how the first version shipped claiming to close a class it did not close.
     *
     * ⚠️ The fixtures are DEFENSIVE, not a census: the single-line quoted form and the multi-line form are
     * both live in `.maestro` today, while `assertNotVisible: 'Back'` and the double-quoted spelling have
     * never appeared there (`git log -S` finds nothing). They are covered because they are cheap to cover
     * and legal to write, not because they were measured. An earlier version of this comment claimed all
     * five "HAVE shipped here", which was false for two of them.
     */
    it('catches every unanchored spelling, including the multi-line form it tells you to write', () => {
        const bad = [
            "- tapOn: 'Back'",
            "- assertVisible: 'Back'",
            '- tapOn: "Back"',
            "      element: 'Back'",
            "    - assertNotVisible: 'Back'",
            // ⛔ Unquoted is valid YAML and escaped the first detector entirely.
            '- tapOn: Back',
            // ⛔ THE REMEDIATION'S OWN SHAPE, minus the anchor — the case that made the class claim false.
            '- tapOn:',
            "      text: 'Back'",
        ].join('\n');

        // Eight lines, seven offences: the last two are ONE multi-line selector reported at its opener.
        expect(unanchoredBackSelectors(bad, 'f.yaml')).toHaveLength(7);
    });

    it('passes every anchored spelling, and anything that merely contains the word', () => {
        const good = [
            "# a comment quoting the bad form: - tapOn: 'Back'",
            '- tapOn:',
            "      text: 'Back'",
            '      above:',
            "          text: 'Step 1 of 4'",
            '- assertVisible:',
            '      text: Back',
            '      below:',
            "          text: 'Ingredients'",
            "- tapOn: 'Back to My Collections'",
            "- assertVisible: '.*Back.*'",
        ].join('\n');

        expect(unanchoredBackSelectors(good, 'f.yaml')).toEqual([]);
    });
});
