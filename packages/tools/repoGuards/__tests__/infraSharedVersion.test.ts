// @vitest-environment node
/**
 * Unit tests for `scripts/infraSharedVersion.mjs` — the semver derivation behind publishing
 * `@radicle-co/infra-shared`.
 *
 * ## Why this exists at all
 *
 * The package was added with a hardcoded `0.1.0` and no mechanism to produce a second version. A publishable
 * library without a versioning rule is not a small omission: consumers pin ranges, and a range only means
 * something if the numbers behind it follow a rule the publisher actually applies. This is that rule, as a
 * pure function, so it can be argued with rather than discovered after a bad publish.
 *
 * ## The rule
 *
 * The repository already enforces Conventional Commits (`@commitlint/config-conventional`), so the bump is
 * DERIVED from commit subjects rather than chosen by whoever runs the pipeline:
 *
 * | commit                              | bump  |
 * |-------------------------------------|-------|
 * | `feat!:` / `BREAKING CHANGE:` body  | major |
 * | `feat:`                             | minor |
 * | anything else (`fix`, `perf`, …)    | patch |
 *
 * ⚠️ WITH THE 0.x DEMOTION, which is the part most likely to look like a bug. While the major version is 0,
 * semver treats the API as unstable and the conventional practice (semantic-release, changesets) is to shift
 * every bump down one: a breaking change moves the MINOR, a feature moves the PATCH. `0.1.0` + `feat!:` is
 * therefore `0.2.0`, not `1.0.0` — reaching 1.0.0 is a deliberate act, not something a commit message can
 * trigger by accident.
 *
 * ## Channels
 *
 * Merging to prod publishes a RELEASE (`0.2.0`). A sandbox publishes a PRERELEASE of the version that release
 * would be (`0.2.0-alpha.47`), so the two sort correctly: semver orders `0.2.0-alpha.47` BEFORE `0.2.0`, and
 * a stable range like `^0.1.0` never resolves a prerelease. A sandbox build can therefore be installed
 * explicitly by a preview without any chance of a production consumer picking it up.
 *
 * DESIGN PATTERN: Specification module over a pure function — {@link deriveVersion} is a verdict over plain
 * data, exercised against a table of commit sets rather than against the working tree.
 */
import semver from 'semver';
import { describe, expect, it } from 'vitest';

import { deriveVersion, bumpFor } from '../../../../scripts/infraSharedVersion.mjs';

describe('bumpFor', () => {
    it('reads a breaking change from the ! marker', () => {
        expect(bumpFor(['feat(infra)!: drop the alb re-export'])).toBe('major');
    });

    it('reads a breaking change from the body footer', () => {
        expect(bumpFor(['feat(infra): rework priorities\n\nBREAKING CHANGE: bands moved'])).toBe('major');
    });

    it('reads a feature', () => {
        expect(bumpFor(['feat(infra): add a nag suppression helper'])).toBe('minor');
    });

    it('treats every other conventional type as a patch', () => {
        expect(bumpFor(['fix(infra): correct the ephemeral slot order'])).toBe('patch');
        expect(bumpFor(['perf(infra): memoise the host resolver'])).toBe('patch');
        expect(bumpFor(['chore(infra): tidy imports'])).toBe('patch');
    });

    it('takes the HIGHEST bump across a set, not the last one', () => {
        expect(bumpFor(['fix(infra): a', 'feat(infra): b', 'chore(infra): c'])).toBe('minor');
        expect(bumpFor(['fix(infra): a', 'feat(infra)!: b'])).toBe('major');
    });

    it('reports no bump for an empty set — nothing to publish is not a patch', () => {
        expect(bumpFor([])).toBe('none');
    });
});

describe('deriveVersion — release channel', () => {
    it('applies the 0.x demotion: a breaking change moves the minor', () => {
        expect(deriveVersion({ current: '0.1.0', commits: ['feat!: x'], channel: 'release' }).version).toBe('0.2.0');
    });

    it('applies the 0.x demotion: a feature moves the patch', () => {
        expect(deriveVersion({ current: '0.1.0', commits: ['feat: x'], channel: 'release' }).version).toBe('0.1.1');
    });

    it('applies the 0.x demotion: a fix moves the patch', () => {
        expect(deriveVersion({ current: '0.1.3', commits: ['fix: x'], channel: 'release' }).version).toBe('0.1.4');
    });

    it('uses the standard rules once the major is 1 or above', () => {
        expect(deriveVersion({ current: '1.4.2', commits: ['feat!: x'], channel: 'release' }).version).toBe('2.0.0');
        expect(deriveVersion({ current: '1.4.2', commits: ['feat: x'], channel: 'release' }).version).toBe('1.5.0');
        expect(deriveVersion({ current: '1.4.2', commits: ['fix: x'], channel: 'release' }).version).toBe('1.4.3');
    });

    it('refuses to publish a release with nothing to release', () => {
        expect(() => deriveVersion({ current: '0.1.0', commits: [], channel: 'release' })).toThrow(
            /nothing to release/i,
        );
    });
});

describe('deriveVersion — prerelease channel', () => {
    it('prereleases the version the release WOULD be', () => {
        expect(
            deriveVersion({ current: '0.1.0', commits: ['feat!: x'], channel: 'prerelease', buildId: 47 }).version,
        ).toBe('0.2.0-alpha.47');
    });

    it('still produces a build when there is nothing to release — a sandbox always has something to test', () => {
        // ⛔ Deliberately NOT the release behaviour. A PR that only touches a consumer still needs a
        // resolvable prerelease to install, or its preview silently tests the last published version.
        expect(deriveVersion({ current: '0.1.0', commits: [], channel: 'prerelease', buildId: 3 }).version).toBe(
            '0.1.1-alpha.3',
        );
    });

    it('requires a build id, so two sandbox publishes can never collide', () => {
        expect(() => deriveVersion({ current: '0.1.0', commits: ['fix: x'], channel: 'prerelease' })).toThrow(
            /buildId/i,
        );
    });

    it('sorts BEFORE the release it anticipates, and outside a stable range', () => {
        const pre = deriveVersion({
            current: '0.1.0',
            commits: ['feat: x'],
            channel: 'prerelease',
            buildId: 9,
        }).version;

        // ⛔ Asserted with a real semver comparator, not `<`. String order says `0.1.1-alpha.9` is GREATER
        // than `0.1.1` — the release is a prefix of the prerelease — so a lexicographic assertion here would
        // be testing the opposite of the property and would have passed for the wrong reason on any version
        // where the two happen to compare the other way.
        expect(pre).toBe('0.1.1-alpha.9');
        // Semver §11: a version with a prerelease sorts below the same version without one.
        expect(semver.lt(pre, '0.1.1')).toBe(true);
        // The property that keeps a sandbox build out of production: a stable range never resolves a
        // prerelease unless it is named explicitly.
        expect(semver.satisfies(pre, '^0.1.0')).toBe(false);
        expect(semver.satisfies('0.1.1', '^0.1.0')).toBe(true);
    });
});

describe('deriveVersion — the FIRST release', () => {
    // ⛔ Found by running the CLI against real history rather than by reasoning: with no tag yet, the
    // manifest's version is the DECLARED STARTING POINT, not a version already in the registry. Bumping past
    // it would publish 0.1.1 first and leave 0.1.0 — the number written in the manifest, and the one a reader
    // would expect — permanently missing.
    it('publishes the declared version itself, not the one after it', () => {
        expect(
            deriveVersion({ current: '0.1.0', commits: ['feat: x'], channel: 'release', firstRelease: true }),
        ).toEqual({ version: '0.1.0', bump: 'initial' });
    });

    it('prereleases the declared version, so a sandbox precedes the first release too', () => {
        expect(
            deriveVersion({
                current: '0.1.0',
                commits: [],
                channel: 'prerelease',
                buildId: 5,
                firstRelease: true,
            }).version,
        ).toBe('0.1.0-alpha.5');
    });

    it('does not refuse an empty commit set — there is nothing to compare against yet', () => {
        expect(deriveVersion({ current: '0.1.0', commits: [], channel: 'release', firstRelease: true }).version).toBe(
            '0.1.0',
        );
    });
});

describe('deriveVersion — input validation', () => {
    it('rejects a current version that is not semver', () => {
        expect(() => deriveVersion({ current: 'v1', commits: ['fix: x'], channel: 'release' })).toThrow(/semver/i);
    });

    it('rejects an unknown channel', () => {
        // ⚠️ The cast is the point, not a workaround. TypeScript already refuses `'nightly'` here — that is
        // the first line of defence and it is working. The runtime guard exists for the caller TypeScript
        // never sees: the CLI, which hands this function whatever `process.argv` contained.
        const fromArgv = (value: string): 'release' | 'prerelease' => value as 'release' | 'prerelease';

        expect(() => deriveVersion({ current: '0.1.0', commits: ['fix: x'], channel: fromArgv('nightly') })).toThrow(
            /channel/i,
        );
    });
});
