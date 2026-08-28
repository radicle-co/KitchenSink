/**
 * @module synthEnv — the placeholder environment a CDK app needs to synthesise, derived rather than listed.
 *
 * ⛔ NOT A CONSTANT. The first attempt hardcoded the variables apps need and got three of eight to
 * synthesise; the rest failed one variable at a time (`RECIPE_VPC_ID`, then `RECIPE_LAMBDA_SG_ID`, then the
 * next). Every one of those is a hand edit outside the CDK — the exact artefact this package exists to
 * abolish.
 *
 * So the KEYS are read out of the app's own source, and the VALUE is inferred from the key's NAME. A new
 * `*_VPC_ID` gets a syntactically valid VPC id the day someone writes it, with no edit here.
 *
 * ⚠️ These are SHAPES, not truths. Each value feeds an address, an account or a tag, none of which changes
 * which resource TYPES a stack declares — and types are all the inventory reads. The day this is used to
 * derive real addresses, that assumption is the first thing to revisit.
 */

/** `process.env['KEY']` — the bracket form `docs/CODING_STANDARDS.md` requires — and `requireEnv('KEY')`. */
const ENV_READ = /(?:process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]|requireEnv\(\s*['"]([A-Z][A-Z0-9_]*)['"])/gu;

/**
 * Every environment variable a set of sources reads.
 *
 * @param sources - File contents to scan.
 * @returns Sorted, de-duplicated keys. Pure.
 */
export function requiredEnvKeys(sources: readonly string[]): readonly string[] {
    const keys = new Set<string>();

    for (const source of sources) {
        for (const match of source.matchAll(ENV_READ)) {
            const key = match[1] ?? match[2];

            if (key !== undefined) {
                keys.add(key);
            }
        }
    }

    return [...keys].sort();
}

/**
 * Rules, applied in order — the FIRST match wins, so the more specific suffixes come first.
 *
 * ⚠️ Ordered by specificity on purpose: `DISTRIBUTION_ID` must be tried before a bare `_ID`, or a
 * CloudFront distribution would be handed a VPC id.
 */
const SHAPES: readonly (readonly [RegExp, string])[] = [
    // ⚠️ HEX, and the right length. AWS ids are validated by shape at synth time in places, and a
    // placeholder containing the letters of the word "local" is not a hex id — the first draft used one and
    // three shape assertions caught it.
    [/_VPC_ID$/u, 'vpc-0000000000000beef'],
    [/_SG_ID$|_SECURITY_GROUP_ID$/u, 'sg-0000000000000beef'],
    [/_SUBNET_ID$/u, 'subnet-0000000000000beef'],
    [/_DISTRIBUTION_ID$/u, 'ELOCALDISTRIBUTION'],
    [/_ARN$/u, 'arn:aws:sqs:us-east-1:000000000000:local-placeholder'],
    [/_URL$|_ENDPOINT$|_ORIGIN$/u, 'http://localhost:1'],
    [/ACCOUNT(_ID)?$/u, '000000000000'],
    [/REGION$/u, 'us-east-1'],
    // RFC 2606 reserves `.invalid` so it can never resolve. A placeholder domain that might be real is how
    // a local tool ends up talking to somebody else's server.
    [/DOMAIN(_NAME)?$|_HOST$|_ZONE$/u, 'local.invalid'],
    [/_EMAIL$/u, 'local@local.invalid'],
    [/(_TAG|_VERSION)$/u, 'local'],
    [/_COUNT$|_DAYS$|_PORT$/u, '1'],
    [/STAGE$/u, 'local'],
];

/**
 * A syntactically plausible placeholder for one environment variable.
 *
 * @param key - The variable's name.
 * @returns A deterministic value whose SHAPE matches what the name implies. Pure.
 */
export function inferPlaceholder(key: string): string {
    for (const [pattern, value] of SHAPES) {
        if (pattern.test(key)) {
            return value;
        }
    }

    // ⛔ Never an empty string. `process.env['X'] ?? fallback` treats empty as present, so a synth could
    // succeed down a code path no deploy ever takes — a green run proving nothing.
    return 'local-placeholder';
}

/**
 * The full placeholder environment for a set of sources.
 *
 * @param sources - File contents to scan.
 * @returns One entry per variable read. Pure.
 */
export function inferSynthEnv(sources: readonly string[]): Readonly<Record<string, string>> {
    return Object.fromEntries(requiredEnvKeys(sources).map((key) => [key, inferPlaceholder(key)]));
}
