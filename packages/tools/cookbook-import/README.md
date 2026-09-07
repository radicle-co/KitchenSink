# `@kitchensink/cookbook-import`

Imports recipes from **public-domain cookbooks** into the recipe service, through the real
`POST /api/v1/recipes`, as a **curator**.

It exists to exercise two things end to end that nothing else does:

1. **Parsing recipes out of prose.** These books do not have ingredient lists. A recipe is a paragraph —
   _"Cut one large beet and one-half pound of onion in thick pieces and put in kettle with one pound of fat
   brisket of beef; cover with water and let cook slowly two hours"_ — and the quantities are spelled out,
   fractional, and frequently not at the start of their clause.
2. **The product's own food association.** Every parsed ingredient name is submitted to the recipe
   service's ingredient-resolution endpoints **exactly as the prose gave it**, and the SYSTEM decides what
   it matches in the USDA catalog. See [What this tool deliberately does not do](#what-this-tool-deliberately-does-not-do).

---

## ⛔ Step 1 — download the book yourself, once

**Nothing in this repository fetches Project Gutenberg, and nothing we deploy ever may.**

Gutenberg's `robots.txt` disallows only `/ebooks/search`, so a robots check **passes** on `/cache/epub/…`
— but [its Terms](https://www.gutenberg.org/policy/robot_access.html) state the site "is intended for human
users only" and that perceived automated access "will result in a temporary or permanent block of your IP
address". **robots.txt compliance is not terms-of-use compliance.** The egress identity that would earn the
block is shared and stage-level (a VPC Lambda leaves through the single `t4g.nano` NAT instance's address —
ADR-0004; Fargate through an address the task does not choose; CI through GitHub's pools), so the cost of
getting this wrong is paid by every service in the stage.

The persisted `sourceUrl` is therefore a **citation**, not a fetch target. See
[ADR-0023](../../../docs/architecture/decisions/0023-curator-declared-provenance.md).

```bash
curl -fL -o /tmp/pg12350.txt https://www.gutenberg.org/cache/epub/12350/pg12350.txt
```

Registered books (`--book`), all verified public domain by reading their own headers:

| key                    | ebook  | work                                                               |
| ---------------------- | ------ | ------------------------------------------------------------------ |
| `international-jewish` | #12350 | _The International Jewish Cook Book_ — Florence Kreisler Greenbaum |
| `jewish-manual`        | #12327 | _The Jewish Manual_ — Lady Judith Cohen Montefiore                 |
| `golden-rule`          | #55555 | _The Golden Rule Cook Book_ — M. R. L. Sharpe                      |
| `mrs-wilson`           | #17438 | _Mrs. Wilson's Cook Book_ — Mary A. Wilson                         |
| `sunday-dinners`       | #31534 | _Fifty-Two Sunday Dinners_ — Elizabeth O. Hiller                   |

The registry lives in [`src/cookbooks.ts`](./src/cookbooks.ts), and `assertPublicDomain` re-checks the
licence header against the **actual bytes** on every run — a copyrighted Gutenberg ebook must never be
published as `imported_public` under a user-visible attribution line.

⛔ **A public-domain header is the floor for membership, not the bar.** `segmentCookbook` recognises a
heading only as a lone ALL-CAPS line, so a book that sets its titles in Title Case collapses whole
chapters into ONE block — which then imports as a single "recipe" carrying dozens of ingredients from a
dozen different dishes, and passes every skip rule on the way. The tell is **ingredient lines per accepted
candidate**: a registered book sits at 3.5–6.5, an unsegmentable one at 20–180. `src/cookbooks.ts` records
which Gutenberg texts were rejected on that measure and which on sampled output quality.

## Step 2 — mint a curator credential

`imported_public` is declarable only by a principal holding `recipes:import:public` in its token's **signed**
`public_metadata` (ADR-0023). A curator is an ordinary app user with a real owner ULID; the grant is
administered out of band, in Clerk.

For a local run, reuse the cross-service harness:

```bash
LINKAGE_SCOPES=recipes:import:public \
  npx tsx packages/tools/cross-service-e2e/scripts/mintLinkageCredentials.ts /tmp/linkage
```

## Step 3 — run it

⛔ **This writes recipes.** Point it at a local or sandbox origin. It has no production affordance, and that
is enforced in code rather than asked of the operator: `--recipe-url` is checked by `src/writableOrigin.ts`,
which admits only a `localhost`, `pr-{N}` or `sandbox.commise.app` host and refuses everything else —
including hosts it does not recognise, because "not obviously production" is not "safe to write to". There is
deliberately no override flag.

```bash
npm run import --workspace=@kitchensink/cookbook-import -- \
    --book international-jewish \
    --file /tmp/pg12350.txt \
    --recipe-url http://localhost:3000 \
    --token-file /tmp/linkage/linkage-credentials.json \
    --ledger .cookbook-import-ledger.json \
    --report /tmp/cookbook-report.json \
    --limit 200
```

| flag           | meaning                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `--book`       | A key from the registry above.                                                 |
| `--file`       | The plain text you downloaded in step 1.                                       |
| `--recipe-url` | Recipe service origin.                                                         |
| `--token-file` | The minted credentials JSON (or pass a raw bearer with `--token`).             |
| `--ledger`     | Idempotency ledger. Re-running skips whatever it already created.              |
| `--report`     | Optional path for the machine-readable report.                                 |
| `--limit`      | Stop after this many creates.                                                  |
| `--settle-ms`  | How long to keep polling non-terminal ingredient resolutions (default 30 000). |

## What this tool deliberately does not do

- **It never calls the food service.** Recipe-service performs the food lookup on the caller's behalf,
  forwarding the caller's own bearer — exactly as it does for the app.
- **It never re-ranks the suggestions.** The blending and scoring are the service's; the tool takes the
  first one offered.
- **It never rewrites an ingredient name to find a friendlier match.** "sifted flour" is submitted as
  "sifted flour".
- **It never drops a line for failing to resolve.** Every name ends as a catalog row — food-backed,
  pending, or freeform — so the resolution rate's denominator is honest.

Together these make the reported resolution rate **a measurement of the product**, not a score for this
tool. A change that raised the rate by doing any of the above would turn the report into a lie told with
real data. `src/__tests__/resolveIngredient.test.ts` pins each one.

## What it refuses to import, and why

`recipes.servings`, `prep_time_minutes`, `cook_time_minutes` and `total_time_minutes` are all `NOT NULL`,
and `recipe_ingredients.quantity` is `numeric(10,3) NOT NULL CHECK (quantity > 0)`. So a value the book does
not state cannot be left empty — it must either be read from the text or the recipe must be declined.
Fabricating a plausible number is not an option: on screen it is indistinguishable from a measured one.

| skip reason           | meaning                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| `no_body`             | A heading with nothing (or almost nothing) under it.                     |
| `too_few_ingredients` | Fewer than three quantified ingredients — prose cookery with no numbers. |
| `too_few_steps`       | Fewer than two instruction steps.                                        |
| `no_stated_duration`  | The text never states a cooking time.                                    |

Two consequences are recorded rather than hidden:

- **An ingredient line with no quantity is DROPPED and reported verbatim** ("a little citric acid", "salt to
  taste"). The shipped schema cannot represent it — see ADR-0023's finding against 004-FR-020.
- **When the source states no yield, `servings` is `1`**, meaning _the quantities exactly as printed_, and
  the recipe's own description says so. `1` is not a guess dressed as a measurement: scaling is a ratio over
  the authored servings, so `1` is the only value under which the stored quantities are the printed ones and
  "scale to 2" doubles them. Any other value silently rescales every quantity by a factor nobody measured.

## The parse model comparison (`src/parseComparison/`, `scripts/parseModelComparison.ts`)

A **measurement harness**, not part of the import. It asks three Amazon Bedrock models to parse the same
ingredient lines this package extracts, and reports three things that need no labelled answer: **contract
compliance** (is the response a bare JSON document of the declared shape), **determinism** (the same line
twice at `temperature: 0`), and **agreement with the `ingredient-parser-nlp` CRF parser**, field by field on
normalised text. Neither parser is declared correct where they differ — the point is to size and characterise
the disagreement.

It lives here because its subject is this package's subject: the corpus, the prose→clause extraction and the
operator-downloaded-file rule are all already here. It is dev-only and ships nowhere.

⛔ **It spends real money on developer credentials, outside ADR-0024's counter.** Use `--limit` first and read
the printed worst-case estimate. ⛔ **Do not commit corpus dumps or raw response logs** — `--out` writes to a
scratch path.

⚠️ **Pin the CRF parser.** Its model file ships inside the package, so an unpinned upgrade changes what
"the CRF said" means and moves every agreement figure without a line of our code changing. The report was
measured against **`ingredient-parser-nlp==2.3.0`**, which is what CI installs.

```bash
pip3 install --user 'ingredient-parser-nlp==2.3.0'
curl -fL -o /tmp/pg12350.txt https://www.gutenberg.org/cache/epub/12350/pg12350.txt   # by hand, once

AWS_REGION=us-east-1 npm run parse-comparison --workspace=@kitchensink/cookbook-import -- \
  --book /tmp/pg12350.txt --limit 20
```

Findings: [`docs/reports/2026-08-23-002-ingredient-parse-model-comparison.md`](../../../docs/reports/2026-08-23-002-ingredient-parse-model-comparison.md).

## Tests

```bash
npm run test --workspace=@kitchensink/cookbook-import              # pure: adapter, mapper, ladder, ledger

export COOKBOOK_IMPORT_RECIPE_URL=http://localhost:3000
export COOKBOOK_IMPORT_CREDENTIALS=/tmp/linkage/linkage-credentials.json
npm run test:integration --workspace=@kitchensink/cookbook-import  # real API; SKIPS when unset
```
