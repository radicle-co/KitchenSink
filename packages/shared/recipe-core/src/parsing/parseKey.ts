/**
 * THE CONTENT KEY a cached ingredient PARSE is stored under (plan U20 / KTD-13, KTD-14).
 *
 * DESIGN PATTERN: **content-addressed idempotency key + value object (smart constructor)**, with the digest
 * injected as a **Port** so this module stays pure and free of a Node dependency. `recipe-core` is imported by
 * the web and mobile bundles through its barrel; pulling `node:crypto` into it for one server-side module
 * would be a dependency the whole package pays for, and `contract.test.ts` asserts the zero-non-zod-dependency
 * leaf property precisely because of that. What must NOT drift is the CANONICAL SERIALIZATION — what goes into
 * the digest and in what order — and that is exactly what lives here.
 *
 * ## ⛔ WHY THE ENGINE IS IN THE KEY, when its nearest precedent puts its model in a COLUMN
 *
 * `verificationKey.ts` keys a JUDGEMENT and stores `model_id` as an ATTRIBUTE, versioning only the derivation:
 * swapping models there does not invalidate cached verdicts, which is right, because a verdict is a verdict.
 *
 * This is a **comparison** pipeline, and the comparison is the product. U19's comparator needs BOTH engines'
 * answers for one line to exist AT THE SAME TIME, as two rows. Keyed the verification table's way — engine as
 * an attribute — the second engine's answer would overwrite the first and the comparator would have nothing to
 * compare. So `(lineDigest, engine, engineVersion)` is the identity, and a CRF version bump re-partitions only
 * the CRF half while every LLM row survives to be re-compared against the new pairing.
 *
 * ## ⚠️ THE LINE IS A DIGEST BEFORE IT IS EVER A KEY, and KTD-14 leans on that
 *
 * `ingredient_parse_cache` holds no owner column, which is what keeps it — like
 * `recipe_ingredient_verifications` — out of the account-erasure sweep. That is only defensible because the
 * row carries no person-to-row link: it is shared installation-wide and addressed by a digest, so there is
 * nothing for a sweep to key on. {@link LineDigest} is branded for exactly this reason — a raw source line
 * cannot be passed where a digest is expected, so "the cook's text ended up in `line_digest`" is a compile
 * error rather than a privacy incident found later.
 *
 * ## ⚠️ THE VERSION PREFIX IS LOAD-BEARING
 *
 * Changing what goes into a preimage re-partitions the table. Without a version, old rows silently become
 * unreachable while new rows collide with nothing — the system appears to work while every cached parse
 * quietly stops applying, both engines are re-invoked for every line, and the only symptom is a bill. The
 * prefix turns that into a visible, additive event: bump it, and the old generation is inert and ENUMERABLE
 * (`WHERE parse_key LIKE 'v1:%'`) rather than invisible.
 *
 * ⛔ Reachable ONLY as `@kitchensink/recipe-core/parsing/parse-key`, and NOT re-exported from the barrel — the
 * rule `./resolution/verification-key` and `./resolution/normalized-key` already follow. `contract-gen`'s
 * composed-sources fingerprint hashes the full text of every recipe-core module a `*.schema.ts` demands, and
 * `src/index.ts` is one of them, so a single added line in the barrel moves the recipe service's
 * `CONTRACT_HASH` and lights up skew warnings on every pinned client for a change with no wire projection.
 */
import { z } from 'zod';

import type { HexDigest } from '../resolution/verificationKey.js';

/**
 * A hex digest function. `createHash('sha256').update(x).digest('hex')` at the worker.
 *
 * ⚠️ ONE definition, shared with `verificationKey` (`../resolution/verificationKey.ts`). Two copies of a Port
 * type is how a caller ends up satisfying one and not the other; the alias is re-exported here so a consumer
 * of the parse key never has to reach into the resolution namespace for it.
 */
export type { HexDigest };

/**
 * The generation of the derivations below.
 *
 * ⛔ BUMP THIS whenever {@link lineDigestPreimage} or {@link parseKeyPreimage} changes what it serializes, in
 * what order, or how it normalizes. Not bumping it is the silent re-partition described in the header: every
 * stored row becomes unreachable, every new row collides with nothing, and NOTHING errors.
 *
 * ⚠️ It has never been bumped. When it is, say WHY here — `VERIFICATION_KEY_VERSION`'s `v2` note is the model:
 * a future reader needs to know which generation their historical rows belong to and what changed under them.
 */
export const PARSE_KEY_VERSION = 'v1';

/**
 * The two engines the comparison pipeline adjudicates between (U17, U18).
 *
 * ⛔ ONE authoritative representation. `ingredient_parse_cache.engine`'s CHECK constraint mirrors this list and
 * the Drizzle schema ties itself to it with `satisfies`, so a third engine is a compile error and a migration —
 * never a value that quietly appears in a cache row nobody can interpret. It lives HERE, in the key module,
 * because the engine is a member of the KEY: adding one re-partitions nothing but does widen what a reader may
 * encounter, and that is a decision, not a default.
 */
export const PARSE_ENGINES = ['crf', 'llm'] as const;

/** Which engine produced a cached parse. */
export type ParseEngine = (typeof PARSE_ENGINES)[number];

/**
 * ⛔ Non-empty by construction, and the check is NOT vacuous.
 *
 * A misconfigured {@link HexDigest} port returning `''` would mint the key `v1:` for EVERY line — one cache row
 * shared by the whole corpus, serving one line's parse to all of them. That is the worst failure this module
 * can have, it is silent, and this is where it is caught.
 */
const lineDigestSchema = z.string().min(1).brand<'LineDigest'>();

/**
 * The digest of one source line — the grain a cached parse is addressed by, and the ONLY form of a cook's line
 * that is ever persisted.
 *
 * Structurally a `string` at runtime (it serializes, logs and binds as a query parameter as one); a distinct
 * type at compile time, so it cannot be produced by anything but {@link lineDigest}.
 */
export type LineDigest = z.infer<typeof lineDigestSchema>;

/** Everything a cached parse is ABOUT — change any of it and it is a different parse. */
export interface ParsedLineIdentity {
    /** The digested source line. ⛔ Branded, so a raw line cannot be passed here (see the header). */
    readonly lineDigest: LineDigest;
    /** Which engine produced the parse. A member of the KEY, not an attribute (KTD-13). */
    readonly engine: ParseEngine;
    /**
     * The engine's own version — the CRF package + model pin, or the LLM's model id + prompt version.
     *
     * ⚠️ Deliberately opaque to this module: what constitutes "a different version" is the engine's business,
     * and a key that tried to parse it would have to change every time an engine's versioning scheme did. The
     * database refuses an empty one (`ingredient_parse_cache_engine_version_nonempty`), because an unversioned
     * parse can never be re-partitioned out.
     */
    readonly engineVersion: string;
}

/**
 * Normalize a source line so one line has one digest.
 *
 * NFC because the same text typed with a precomposed `é` and with `e` + a combining acute is the same line to a
 * cook and to a parser; two digests for it would double the engine spend and halve the hit rate, invisibly.
 * Whitespace is collapsed and trimmed because indentation is not part of the line.
 *
 * ⛔ Case is NOT folded, and that is the deliberate opposite of `normalizedIngredientKey`. That one destroys
 * case because it is an equivalence-class key for MATCHING two cooks' phrases. This one identifies the exact
 * text handed to a parser, and both engines read a capitalised proper noun differently from a lowercase one.
 *
 * @param line - The raw source line.
 * @returns The normalized line. Pure.
 */
function normalizeLine(line: string): string {
    return line.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * The exact string {@link lineDigest} is taken over.
 *
 * A JSON array with the version as its first member, not a bare string. The version is INSIDE as well as in
 * front of the digest so two generations differ in the digest BODY, not only in a prefix a query could strip —
 * enumerable AND distinct. Exported so a test can assert what is hashed rather than only that hashing happened.
 *
 * @param sourceLine - The raw source line.
 * @returns The canonical preimage. Pure.
 */
export function lineDigestPreimage(sourceLine: string): string {
    return JSON.stringify([PARSE_KEY_VERSION, normalizeLine(sourceLine)]);
}

/**
 * The digest a line's cached parses are grouped under.
 *
 * @param sourceLine - The raw source line.
 * @param digest - The hash. Injected so this module carries no crypto dependency.
 * @returns `{version}:{digest}`, branded. Pure, given a pure digest.
 * @throws If the injected digest returns an empty string — see {@link lineDigestSchema}.
 */
export function lineDigest(sourceLine: string, digest: HexDigest): LineDigest {
    return lineDigestSchema.parse(`${PARSE_KEY_VERSION}:${digest(lineDigestPreimage(sourceLine))}`);
}

/**
 * The exact string {@link parseKey} is taken over.
 *
 * ⛔ A JSON ARRAY, never a concatenation. With a naive `a + b` join, `engine: 'crf'` + `engineVersion: 'X'` and
 * `engine: 'crfX'` + `engineVersion: ''` produce the same string, so two different parses would share one row —
 * the worst possible cache hit, because it looks like a saving. JSON's own escaping makes that unrepresentable,
 * and it distinguishes an empty member from an absent one for free.
 *
 * ⛔ It serializes the LINE DIGEST, never the raw line. That is what keeps the PRIMARY KEY and the
 * `(line_digest, engine, engine_version)` UNIQUE index describing the same thing — `parse_key` is a function of
 * exactly the triple that index constrains — and it is why no cook's text reaches the preimage at all.
 *
 * @param identity - The cached parse's subject.
 * @returns The canonical preimage. Pure.
 */
export function parseKeyPreimage(identity: ParsedLineIdentity): string {
    return JSON.stringify([PARSE_KEY_VERSION, identity.lineDigest, identity.engine, identity.engineVersion]);
}

/**
 * The key one engine's parse of one line is stored under.
 *
 * @param identity - The cached parse's subject.
 * @param digest - The hash. Injected so this module carries no crypto dependency.
 * @returns `{version}:{digest}`. Pure, given a pure digest.
 */
export function parseKey(identity: ParsedLineIdentity, digest: HexDigest): string {
    return `${PARSE_KEY_VERSION}:${digest(parseKeyPreimage(identity))}`;
}
