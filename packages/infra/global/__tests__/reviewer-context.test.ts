/**
 * Repo-wide guard: the context files that AI review bots ingest must be TRUE.
 *
 * `AGENTS.md` and `.github/copilot-instructions.md` are not documentation for humans who can spot a
 * stale line — they are auto-ingested as authoritative repository context by GitHub Copilot code
 * review, CodeRabbit and Qodo. A false claim in them is not a typo; it is an instruction. A bot told
 * the repo uses Auth0 will "helpfully" propose Auth0 wiring for a Clerk codebase, and a bot told the
 * sandbox uses path routing will file a bug against a 404 that ADR-0001 makes deliberate — then a
 * human has to spend review budget rejecting confidently-wrong advice.
 *
 * That is exactly what was happening. `AGENTS.md` (auto-generated, stamped "Last updated 2026-04-29")
 * claimed THREE technologies the repo does not have — `@auth0/nextjs-auth0`, `react-native-auth0`
 * (this repo has used Clerk since feature 002) and `jwks-rsa` (left over from the API Gateway
 * authorizer model that PR #39 deleted in favour of in-service session-token verification) — and
 * asserted the exact INVERSE of ADR-0001's live ruling: "Sandbox front-ends use path routing …, NOT
 * per-PR subdomains." Since the 2026-07-13 cutover the subdomain form is the real one and the path
 * form 404s BY DESIGN.
 *
 * Why the tech check is generalized rather than an auth0 denylist: the defect class is not "Auth0 got
 * mentioned", it is "AGENTS.md's technology claims were never verified against the dependency graph".
 * Banning one vendor string would have missed `jwks-rsa` entirely — this guard found that third stale
 * claim on its own. Asserting that every package AGENTS.md claims actually resolves in some workspace
 * manifest catches vendor drift, removed dependencies and renamed packages with one rule, and it stays
 * true as the repo evolves instead of needing a new denylist entry per incident.
 *
 * Scope note: only the AUTO-GENERATED tech sections ("Active Technologies", "Recent Changes") are
 * scanned for package claims. The hand-written "MANUAL ADDITIONS" prose deliberately backticks things
 * that are not npm packages (`deploy-food`, `paths-filter`, `RECIPE_FOOD_SERVICE_URL`), and treating
 * those as dependency claims would fail the guard for the wrong reason — a guard that cries wolf gets
 * disabled, which is worse than no guard.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

// .../packages/infra/global/__tests__ → repo root is four levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const agentsMd = readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
const copilotInstructionsPath = path.join(repoRoot, '.github/copilot-instructions.md');
const instructionsDir = path.join(repoRoot, '.github/instructions');

/**
 * Every package name declared anywhere in the workspace — own `name` fields plus all four dependency
 * kinds, across every tracked `package.json`. This is the ground truth a tech claim is checked against.
 */
function dependencyUniverse(): Set<string> {
    const manifests = execFileSync('git', ['ls-files', '*package.json'], { cwd: repoRoot, encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter((file) => file.length > 0 && !file.includes('node_modules'));

    const universe = new Set<string>();
    for (const file of manifests) {
        let manifest: Record<string, unknown>;
        try {
            manifest = JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'));
        } catch {
            continue;
        }
        if (typeof manifest['name'] === 'string') {
            universe.add(manifest['name']);
        }
        for (const kind of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            const block = manifest[kind];
            if (block !== null && typeof block === 'object') {
                for (const dep of Object.keys(block as Record<string, unknown>)) {
                    universe.add(dep);
                }
            }
        }
    }
    return universe;
}

/**
 * Backticked tokens inside AGENTS.md's tech sections that are unambiguously npm package claims:
 * SCOPED (`@aws-sdk/client-s3`) or HYPHENATED (`expo-secure-store`). Tokens carrying a `.` or `_` are
 * config/identifier noise (`.nvmrc`, `package.json`, `db.t4g.small`, `pg_trgm`).
 *
 * KNOWN LIMITATION, stated deliberately rather than papered over: bare single-word tokens are NOT
 * checked, because nothing lexical separates a package (`pg`, `jose`, `svix`, `sharp`) from a code
 * identifier the prose legitimately backticks (`any`, `azp`, `tsvector`). An earlier revision of this
 * guard checked them and immediately produced three false positives on correct documentation. A guard
 * that cries wolf gets disabled, so the rule is narrowed to what it can prove: if `svix` were dropped
 * from the repo while still claimed here, this test would not catch it.
 *
 * The narrowing costs nothing against the observed defect class — all three stale claims that motivated
 * this guard (`@auth0/nextjs-auth0`, `react-native-auth0`, `jwks-rsa`) are scoped or hyphenated.
 */
function claimedPackages(): string[] {
    const sections: string[] = [];
    const active = agentsMd.match(/## Active Technologies([\s\S]*?)(?=\n## )/);
    if (active?.[1] !== undefined) {
        sections.push(active[1]);
    }
    const recent = agentsMd.match(/## Recent Changes([\s\S]*?)(?=\n<!--|$)/);
    if (recent?.[1] !== undefined) {
        sections.push(recent[1]);
    }

    const tokens = new Set<string>();
    for (const section of sections) {
        for (const match of section.matchAll(/`([^`]+)`/g)) {
            const token = match[1];
            if (token === undefined) {
                continue;
            }
            const wellFormed =
                /^(@[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9-]*$/.test(token) &&
                !token.includes('_') &&
                !token.includes('.');
            // Scoped or hyphenated only — see the limitation note above.
            const unambiguous = token.startsWith('@') || token.includes('-');
            if (wellFormed && unambiguous) {
                tokens.add(token);
            }
        }
    }
    return [...tokens].sort();
}

/** ADR filenames CLAUDE.md flags as deliberate decisions a reviewer must not advise reverting. */
function deliberateAdrs(): string[] {
    const claudeMd = readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
    const cited = new Set<string>();
    for (const match of claudeMd.matchAll(/decisions\/(\d{4}-[a-z0-9-]+)\.md/g)) {
        if (match[1] !== undefined) {
            cited.add(match[1]);
        }
    }
    return [...cited].sort();
}

const universe = dependencyUniverse();
const claimed = claimedPackages();
const adrs = deliberateAdrs();

describe('AI-reviewer context files are accurate', () => {
    it('finds tech claims and ADRs to check (the guard is not vacuously passing)', () => {
        expect(claimed.length).toBeGreaterThan(5);
        expect(adrs.length).toBeGreaterThan(5);
        expect(universe.size).toBeGreaterThan(50);
    });

    it('every technology AGENTS.md claims actually resolves in a workspace manifest', () => {
        const absent = claimed.filter((pkg) => !universe.has(pkg));

        expect(
            absent,
            `AGENTS.md claims package(s) that exist nowhere in this repo's dependency graph: ` +
                `${absent.join(', ')}. Review bots ingest this file as authoritative context, so a stale ` +
                `claim becomes an instruction — a bot told the repo uses Auth0 will propose Auth0 wiring ` +
                `for a Clerk codebase. Remove or correct the claim.`,
        ).toEqual([]);
    });

    it('any Expo SDK major AGENTS.md names matches the installed one', () => {
        // Version ranges are deliberately NOT checked in general (`^6.39` vs `^6.39.4` are both true
        // and asserting on them would be brittle). The Expo SDK MAJOR is the exception: it selects a
        // whole API surface, and a stale "Expo 53+" line tells a bot to reach for SDK-53 APIs on an
        // SDK-57 app. That exact confusion fed the wrong expo plugin to Gradle and cost a full task.
        const claims = [...agentsMd.matchAll(/Expo\s+(\d+)/g)].map((match) => match[1]);
        if (claims.length === 0) {
            return;
        }

        const mobileManifest = JSON.parse(
            readFileSync(path.join(repoRoot, 'packages/apps/commise/mobile/package.json'), 'utf8'),
        );
        const declared: string = mobileManifest.dependencies?.expo ?? '';
        const installedMajor = declared.match(/(\d+)/)?.[1];
        expect(installedMajor, 'could not read the expo major from the mobile manifest').toBeDefined();

        const wrong = [...new Set(claims)].filter((major) => major !== installedMajor);
        expect(
            wrong,
            `AGENTS.md names Expo SDK ${wrong.join('/')} but the mobile app declares expo ${declared} ` +
                `(major ${installedMajor}). A stale SDK major points bots at the wrong API surface.`,
        ).toEqual([]);
    });

    it('AGENTS.md does not assert the pre-cutover path-routing form as current (ADR-0001)', () => {
        // The cutover made per-PR SUBDOMAINS the real addressing form; the path form 404s by design.
        // A context file asserting the inverse actively directs bots to "fix" that deliberate 404.
        expect(
            /NOT\s+per-PR\s+subdomains/i.test(agentsMd),
            'AGENTS.md asserts "NOT per-PR subdomains", the exact inverse of ADR-0001 since the ' +
                '2026-07-13 cutover. Previews live at pr-{N}.sandbox.commise.app and the ' +
                'sandbox.commise.app/pr-{N} path form 404s BY DESIGN.',
        ).toBe(false);

        // If the file discusses sandbox addressing at all, it must name the form that is actually live.
        if (/sandbox\.commise\.app/.test(agentsMd)) {
            expect(
                /pr-\{N\}\.sandbox\.commise\.app/.test(agentsMd),
                'AGENTS.md discusses sandbox addressing but never names the live subdomain form ' +
                    '(pr-{N}.sandbox.commise.app). Name it explicitly, or a bot will infer the path form.',
            ).toBe(true);
        }
    });

    it('every deliberate ADR is surfaced in a file review bots ingest', () => {
        // Copilot cannot follow links out of an instructions file, so each ruling must be INLINED
        // somewhere ingested — AGENTS.md or a path-scoped .github/instructions/*.instructions.md.
        const ingested = [agentsMd];
        if (existsSync(copilotInstructionsPath)) {
            ingested.push(readFileSync(copilotInstructionsPath, 'utf8'));
        }
        if (existsSync(instructionsDir)) {
            for (const entry of readdirSync(instructionsDir)) {
                if (entry.endsWith('.instructions.md')) {
                    ingested.push(readFileSync(path.join(instructionsDir, entry), 'utf8'));
                }
            }
        }
        const corpus = ingested.join('\n');

        const uncovered = adrs.filter((adr) => {
            const number = adr.slice(0, 4);
            // Either the filename or a conventional "ADR-0004" reference counts as surfacing it.
            return !corpus.includes(adr) && !new RegExp(`ADR[-\\s]?${number}`, 'i').test(corpus);
        });

        expect(
            uncovered,
            `CLAUDE.md marks these ADRs as deliberate decisions, but no bot-ingested context file ` +
                `mentions them: ${uncovered.join(', ')}. A reviewer that cannot see the ruling will ` +
                `advise reverting it.`,
        ).toEqual([]);
    });

    it('each path-scoped instruction file declares an applyTo glob', () => {
        if (!existsSync(instructionsDir)) {
            return;
        }
        const files = readdirSync(instructionsDir).filter((entry) => entry.endsWith('.instructions.md'));

        const malformed = files.filter((file) => {
            const body = readFileSync(path.join(instructionsDir, file), 'utf8');
            const frontmatter = body.match(/^---\n([\s\S]*?)\n---/);
            if (frontmatter?.[1] === undefined) {
                return true;
            }
            // `applyTo` is what scopes the instructions to paths; without it the file either applies
            // nowhere or everywhere, and per-path ADR binding silently stops working.
            return !/^applyTo:\s*\S+/m.test(frontmatter[1]);
        });

        expect(
            malformed,
            `.github/instructions files missing a valid applyTo frontmatter glob: ${malformed.join(', ')}`,
        ).toEqual([]);
    });
});
