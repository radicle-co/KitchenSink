#!/usr/bin/env node
/**
 * Semver derivation for `@radicle-co/infra-shared` — the one published package in this repository.
 *
 * ## What this exists to fix
 *
 * The package shipped with a hardcoded `0.1.0` and no rule for producing a second version. That is not a
 * cosmetic gap: consumers pin ranges, and a range is only meaningful if the numbers behind it follow a rule
 * the publisher actually applies. Every other artefact here is identified by commit SHA (`IMAGE_TAG`), which
 * works precisely because nothing depends on an image by range. A library is the first thing here that does.
 *
 * ## The rule, and why it is derived rather than chosen
 *
 * The repository already enforces Conventional Commits, so the bump comes from the commits themselves and
 * not from whoever runs the pipeline. `feat!:` or a `BREAKING CHANGE:` footer is major, `feat:` is minor,
 * everything else is patch — the highest bump across the set wins.
 *
 * ⚠️ THE 0.x DEMOTION is the part most likely to be read as a bug. While the major is 0 the API is unstable
 * by semver's own definition, and the conventional practice is to shift each bump down one step: a breaking
 * change moves the minor, a feature moves the patch. So `0.1.0` + `feat!:` is `0.2.0`, not `1.0.0`. Reaching
 * 1.0.0 stays a deliberate act rather than something a commit message can trigger by accident.
 *
 * ## Two channels, and the property that keeps them apart
 *
 * A merge to prod publishes a RELEASE (`0.2.0`). A sandbox publishes a PRERELEASE of whatever that release
 * would be (`0.2.0-alpha.47`). Semver orders a prerelease BELOW its release, and `^`/`~` ranges never resolve
 * a prerelease unless it is named explicitly — so a preview can install a sandbox build by exact version
 * while no production consumer can drift onto one.
 *
 * ⛔ A prerelease is produced even when no commit touched this package, and a release is not. They are asked
 * different questions. A release with nothing to release is a no-op that should not mint a version; a
 * sandbox always needs something resolvable to install, because the alternative is a preview that silently
 * tests the LAST PUBLISHED version of a shared construct instead of the branch's.
 *
 * DESIGN PATTERN: Specification module — {@link deriveVersion} is a pure verdict over plain data; the impure
 * git and manifest reads live in {@link main} and are never in the path the tests exercise.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** The package this derives versions for, and the tag prefix that anchors "since the last release". */
export const PACKAGE_DIR = 'shared/infra';

/** Git tags are the release ledger; the registry is a consequence, not the source of truth. */
export const TAG_PREFIX = 'infra-shared-v';

/** Prerelease identifier for sandbox builds. */
export const PRERELEASE_ID = 'alpha';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const BREAKING = /^[a-z]+(\([^)]*\))?!:/i;
const FEATURE = /^feat(\([^)]*\))?:/i;
const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

/**
 * The highest semantic bump a set of commit messages implies.
 *
 * @param {readonly string[]} commits - Full commit messages (subject, optionally followed by a body).
 * @returns {'none'|'patch'|'minor'|'major'} The bump, `none` when the set is empty.
 */
export function bumpFor(commits) {
    let highest = 'none';

    for (const message of commits) {
        const subject = message.split('\n')[0] ?? '';
        let bump = 'patch';

        if (BREAKING.test(subject) || /^BREAKING[ -]CHANGE:/m.test(message)) {
            bump = 'major';
        } else if (FEATURE.test(subject)) {
            bump = 'minor';
        }

        if (RANK[bump] > RANK[highest]) {
            highest = bump;
        }
    }

    return highest;
}

/**
 * Apply a bump to a version, honouring the 0.x demotion.
 *
 * @param {string} current - The current version, `major.minor.patch`.
 * @param {'patch'|'minor'|'major'} bump - The bump to apply.
 * @returns {string} The next version.
 */
function applyBump(current, bump) {
    const match = SEMVER.exec(current);

    if (match === null) {
        throw new Error(`current version ${current} is not semver (major.minor.patch)`);
    }

    const [major, minor, patch] = match.slice(1, 4).map(Number);
    // While the major is 0 the API is unstable: every bump shifts down one step, so 1.0.0 is only ever
    // reached deliberately.
    const effective = major === 0 ? { major: 'minor', minor: 'patch', patch: 'patch' }[bump] : bump;

    if (effective === 'major') {
        return `${major + 1}.0.0`;
    }

    if (effective === 'minor') {
        return `${major}.${minor + 1}.0`;
    }

    return `${major}.${minor}.${patch + 1}`;
}

/**
 * Derive the version to publish.
 *
 * @param {object} input - Derivation inputs.
 * @param {string} input.current - The last released version.
 * @param {readonly string[]} input.commits - Commits touching this package since that release.
 * @param {'release'|'prerelease'} input.channel - Prod merge, or sandbox.
 * @param {number} [input.buildId] - Monotonic build number; required for a prerelease.
 * @param {boolean} [input.firstRelease] - True when no release tag exists yet.
 * @returns {{ version: string, bump: string }} The version to publish and the bump it came from.
 */
export function deriveVersion({ current, commits, channel, buildId, firstRelease = false }) {
    if (SEMVER.exec(current) === null) {
        throw new Error(`current version ${current} is not semver (major.minor.patch)`);
    }

    if (channel !== 'release' && channel !== 'prerelease') {
        throw new Error(`unknown channel ${channel}; expected 'release' or 'prerelease'`);
    }

    // ⛔ THE FIRST RELEASE PUBLISHES THE DECLARED VERSION, NOT THE ONE AFTER IT. With no tag, the manifest's
    // version is a starting point that has never been published — bumping past it would ship 0.1.1 first and
    // leave 0.1.0, the number written in the manifest, permanently missing from the registry. Found by
    // running the CLI against real history, not by reasoning about it.
    if (firstRelease) {
        if (channel === 'release') {
            return { version: current, bump: 'initial' };
        }

        return { version: `${current}-${PRERELEASE_ID}.${requireBuildId(buildId)}`, bump: 'initial' };
    }

    const bump = bumpFor(commits);

    if (channel === 'release') {
        if (bump === 'none') {
            throw new Error('nothing to release: no commits touched this package since the last tag');
        }

        return { version: applyBump(current, bump), bump };
    }

    // A sandbox with no qualifying commit still needs an installable version — hence the patch floor.
    const next = applyBump(current, bump === 'none' ? 'patch' : bump);

    return { version: `${next}-${PRERELEASE_ID}.${requireBuildId(buildId)}`, bump };
}

/**
 * A build id, or a refusal.
 *
 * @param {number | undefined} buildId - The candidate.
 * @returns {number} The same value, once it is known to exist.
 */
function requireBuildId(buildId) {
    if (buildId === undefined || buildId === null) {
        throw new Error('a prerelease requires a buildId, so two sandbox publishes cannot collide');
    }

    return buildId;
}

/**
 * The last released version, from the git tag ledger.
 *
 * @returns {{ version: string, tag: string | null }} The version and the tag it came from.
 * @sideEffect Runs git against the working tree.
 */
export function lastRelease() {
    const tags = execFileSync('git', ['tag', '--list', `${TAG_PREFIX}*`, '--sort=-v:refname'], {
        encoding: 'utf8',
    })
        .split('\n')
        .filter(Boolean);
    const tag = tags[0];

    if (tag === undefined) {
        // No release yet. The manifest's version is the starting point, and it is NOT re-published.
        const manifest = JSON.parse(readFileSync(`${PACKAGE_DIR}/package.json`, 'utf8'));

        return { version: manifest.version, tag: null };
    }

    return { version: tag.slice(TAG_PREFIX.length), tag };
}

/**
 * Commits touching this package since a tag (or all of them, when there is no tag yet).
 *
 * @param {string | null} tag - The tag to measure from.
 * @returns {string[]} Full commit messages, newest first.
 * @sideEffect Runs git against the working tree.
 */
export function commitsSince(tag) {
    const range = tag === null ? 'HEAD' : `${tag}..HEAD`;
    const out = execFileSync('git', ['log', range, '--format=%B%x00', '--', PACKAGE_DIR], {
        encoding: 'utf8',
    });

    return out
        .split('\0')
        .map((message) => message.trim())
        .filter(Boolean);
}

/**
 * CLI: print the version to publish as `version=<v>` and `bump=<b>` for a workflow to read.
 *
 * @sideEffect Reads git and the manifest, writes stdout.
 */
function main() {
    const channel = process.argv[2] === 'prerelease' ? 'prerelease' : 'release';
    const buildId = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
    const { version: current, tag } = lastRelease();
    const commits = commitsSince(tag);
    const { version, bump } = deriveVersion({
        current,
        commits,
        channel,
        buildId,
        firstRelease: tag === null,
    });

    process.stdout.write(`current=${current}\n`);
    process.stdout.write(`commits=${commits.length}\n`);
    process.stdout.write(`bump=${bump}\n`);
    process.stdout.write(`version=${version}\n`);
    process.stdout.write(`tag=${TAG_PREFIX}${version}\n`);
}

if (process.argv[1]?.endsWith('infraSharedVersion.mjs')) {
    main();
}
