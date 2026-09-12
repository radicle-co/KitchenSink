/**
 * An ADR records a DECISION, at a moment, with the reasoning that justified it. It is not the operational
 * memory of the system.
 *
 * These documents drifted, and the drift had a mechanism rather than a cause: there was nowhere else to
 * write "what is true right now", so it went into the ADR, and because an ADR is prose nobody rejected it.
 * The corpus reached 9,923 lines carrying 259 dated inline markers, 35 `## Update (…)` sections, 173
 * imperative `⛔ do not` lines and — in one bullet of ADR-0025 — five successive layers of strike-through
 * and re-annotation on the single sentence "no deployment has been performed".
 *
 * Nygard's form is immutable after acceptance precisely to prevent that: a decision record is a snapshot of
 * reasoning, so anything that CHANGES over time does not belong inside one. The rule this file enforces:
 *
 *   > A consequence is what follows from the decision and stays true while it stands.
 *   > A status is what happens to be true today.
 *   > ADRs record the first. The second belongs where it is CHECKED — CI, a guard test, or the code.
 *
 * ⛔ This guard deliberately enumerates NO ADR filenames and carries no allowlist. The repository's own
 * standard is that "a copy of a list cannot detect that the list is incomplete" (ADR-0025 §3); an exemption
 * list here would be that failure applied to the very documents that record it. Every ADR on disk is
 * discovered and every ADR is subject to the same rules, so a new one cannot be born non-conforming.
 *
 * @see docs/architecture/decisions/README.md — the same rule, stated where an author reads it
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ADR_DIR = join(__dirname, '..', '..', '..', '..', 'docs', 'architecture', 'decisions');

/** Every numbered ADR on disk, discovered rather than listed. */
const adrFiles = (): readonly string[] =>
    readdirSync(ADR_DIR)
        .filter((name) => /^\d{4}-.+\.md$/.test(name))
        .sort();

const read = (name: string): string => readFileSync(join(ADR_DIR, name), 'utf8');

/**
 * The four statuses an ADR may hold. `Accepted` says the DECISION stands — it says nothing about whether
 * the code exists, which is the conflation that put implementation state into these files.
 */
const LEGAL_STATUS = /^- \*\*Status\*?\*?:?\*?\*?:? *(Proposed|Accepted|Deprecated|Superseded by \d{4})\b/m;

describe('ADRs record decisions, not status', () => {
    it('discovers the corpus (a vacuous pass here would hide every rule below)', () => {
        expect(adrFiles().length).toBeGreaterThan(25);
    });

    describe.each(adrFiles())('%s', (name) => {
        it('carries exactly one Status, drawn from the four legal values', () => {
            const body = read(name);
            const statusLines = body.split('\n').filter((line) => /^- \*\*Status/.test(line));

            expect(statusLines).toHaveLength(1);
            expect(body).toMatch(LEGAL_STATUS);
        });

        it('states no implementation state in its Status — that is derived from code, not asserted here', () => {
            const status = read(name)
                .split('\n')
                .find((line) => /^- \*\*Status/.test(line));

            // "Accepted — implemented at path X" and "Accepted — NOT IMPLEMENTED" are both status of the
            // WORK, and both go stale silently. Whether the code exists is a question for the code.
            expect(status).not.toMatch(
                /\b(implemented|unbuilt|not yet built|no deploy|never been deployed|in flight|shipped|pending)\b/i,
            );
        });

        it('carries Context, Decision and Consequences', () => {
            const body = read(name);

            for (const section of ['Context', 'Decision', 'Consequences']) {
                expect(body).toMatch(new RegExp(`^##+ +${section}`, 'm'));
            }
        });

        it('is not edited in place — no strike-through, no dated amendment sections', () => {
            const body = read(name);

            // A decision that changed is a NEW ADR that supersedes this one. Striking a sentence out and
            // writing the new one beside it leaves a document that states both, and a reader who stops
            // early reads the reversed one as current. ADR-0001's TITLE asserted the reversed decision for
            // eight weeks this way.
            expect(body).not.toMatch(/~~/);
            expect(body).not.toMatch(/^##+ .*\b(Update|AMENDED|SUPERSEDED IN PART|CORRECTED|STALE)\b/m);
        });

        it('carries no dated AUDIT annotation — that is a changelog entry wearing a date', () => {
            const body = read(name);
            const afterHeader = body.slice(body.indexOf('\n## '));

            // Not every date is rot: a date inside a plan's FILENAME, an external fact ("AWS added Valkey
            // 9.0 on 2026-06-02"), and the provenance of a ruling ("owner ruling, 2026-08-15") are all
            // legitimate — they describe the world the decision was made in, and they do not go stale.
            //
            // ⚠️ ADJACENCY is the whole rule, and a wider window was wrong twice over. The rot has ONE
            // shape — an audit verdict stamped with the date it was reached, `STALE (2026-09-04)` — and it
            // is that stamp, not the date, that re-scores the document against a later reading of reality.
            // A 150-character window instead flagged "Verified against primary AWS documentation on
            // 2026-08-20", which is the provenance of a MEASUREMENT and exactly what an ADR should carry,
            // because ordinary prose ("no longer", "as of") drifted into range. So the marker must sit
            // within a few characters of the date, which is the form a stamp takes and prose does not.
            const AUDIT =
                /(STALE|CORRECTED|AMENDED|DISCHARGED|RE-VERIFIED|UNVERIFIABLE|SUPERSEDED IN PART|RETRACTED|DEPRECATED|\bFALSE\b|\bas of\b)[^.\n]{0,12}$/i;

            const annotations = [...afterHeader.matchAll(/\b(?:19|20)\d{2}-\d{2}-\d{2}\b/g)]
                .filter((match) => AUDIT.test(afterHeader.slice(Math.max(0, match.index - 40), match.index)))
                .map((match) =>
                    afterHeader.slice(Math.max(0, match.index - 60), match.index + 30).replace(/\s+/g, ' '),
                );

            expect(annotations).toEqual([]);
        });
    });
});
