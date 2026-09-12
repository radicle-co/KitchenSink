# 21 — Adversarial performance review (PR #91)

**Reviewer:** PER-1 (Performance Engineer) · **Date:** 2026-08-14 · **Posture:** adversarial; default to "will not meet target" when uncertain.

**Decisions under attack:** Tesseract.js-on-Lambda over Textract (cost); nutrition as a live reference; per-domain async processors; scale-to-1-or-zero under a ~$300/mo account budget.

---

## Measurement provenance — read before citing any number here

Everything labelled **MEASURED** was run by me on this host during this review. Everything labelled **ESTIMATED** is arithmetic on top of a measurement, with the assumption stated inline. I have no AWS access from this session, so **no number in this document was measured on Lambda.**

| Item                | Value                                                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host CPU            | Intel Core Ultra 7 265K, 20 cores, 48 GB RAM (WSL2)                                                                                                                                                                                                         |
| Isolation           | `taskset -c 0` — one physical core, parent + tesseract worker thread contending, as a 1-vCPU stand-in                                                                                                                                                       |
| Node                | v24.16.0 (matches the repo's `Node 24.x` target, `specs/011-recipe-digitization/plan.md:92`)                                                                                                                                                                |
| Libraries           | `tesseract.js@7.0.0`, `tesseract.js-core` (bundled), `sharp@0.35.3` / libvips 8.18.3                                                                                                                                                                        |
| Corpus              | **Synthetic.** Rendered recipe text + programmatic degradations. Clean vector-rendered glyphs OCR _better and faster_ than real photographs, so **every timing here is a floor, not a typical case.**                                                       |
| Not measurable here | Lambda cold start, Lambda fractional vCPU (I attempted `systemd-run -p CPUQuota=`; **it does not throttle in this WSL2 environment** — verified with a spin loop: 84.13 s at 100 % vs 86.10 s at 29 %, so the emulation was discarded rather than reported) |

**The single largest uncertainty is the host→Lambda single-thread ratio.** A Lambda vCPU is a share of a Xeon Platinum / Graviton core; this host is a current-generation desktop core. I use a slowdown factor **S = 2.5×** as a mid estimate and show S = 2.0 / 3.0 sensitivity. **S is an assumption, not a measurement, and it is the first thing to replace with real data.**

---

## Tesseract vs NFR-001

**NFR-001** (`specs/011-recipe-digitization/spec.md:292`, restated at `:305`): _"OCR processing completes within 10 s for a 4 MB JPEG on cold Lambda"_, measured as _"CloudWatch `Duration` filtered by `cold=true` p95"_.

### First: the premise about the port is half-right

The `OcrProvider` port exists, but **not where the decision assumes**, and not in a shape a Tesseract adapter fits cleanly.

- It is **not** in a `digitization-workers` package. `packages/services/` contains only `food`, `food-service`, `identity`, `identity-webhooks`, `recipe-service`, `recipe-workers`. The plan's proposed `@kitchensink/digitization-workers` (`plan.md:22`) **does not exist**.
- The real port is `.worktrees/004-recipe-importing/packages/services/recipe-service/src/imports/ocr/ocr-provider.port.ts:47`, on the **004 worktree**, not on the checked-out branch. The plan's sketched interface (`plan.md:73-77`, `process(input: OcrInput)` taking bytes + `timeoutMs`) and the shipped one are **different interfaces**.
- **The shipped port takes an S3 location, not bytes** — `OcrSource { bucket, objectKey }` (`ocr-provider.port.ts:39-44`), and the module doc says why (`:9-11`): _"It does not take bytes (the async provider APIs read from object storage, and streaming megabytes through our own process to hand them straight back is work for nothing)."_

    **Tesseract.js cannot read from S3.** A Tesseract adapter must `GetObject` into the process and hand the buffer to WASM — precisely the "work for nothing" the port was shaped to avoid. The port survives structurally; its stated rationale is Textract-specific and a Tesseract adapter inverts it. Add one S3 GET of the preprocessed JPEG (measured output 0.36–0.80 MB) inside the function's billed duration.

- **`OcrTextLine.handwritten: boolean` (`:29`) cannot be populated by Tesseract.** Tesseract has no print-vs-handwriting classifier. `isMostlyHandwritten` (`:114`) would return a constant `false`, silently. That signal is load-bearing for a channel whose own preprocessing doc names _"a fading hand-written card"_ as a target input (`ocr-image.ts:17`). Tesseract's LSTM is trained on print and is weak on cursive — so the adapter would be both worst-in-class at handwriting **and** unable to report that it was looking at any.

### MEASURED — the clean case passes easily

Running the **exact** `OCR_BUDGET` pipeline (`ocr-budget.config.ts:19-41`: `rotate → greyscale → normalise → resize(3000px inside) → jpeg(q90)`), 1 core, 3 reps, median:

| Input                          | In px     | Preprocess | Recognize  | Conf | Chars   |
| ------------------------------ | --------- | ---------- | ---------- | ---- | ------- |
| 12 MP photo, 2.78 MB           | 3024×4032 | 389 ms     | **884 ms** | 95   | 1080    |
| 12 MP photo, 0.58 MB           | 2850×4032 | 343 ms     | **755 ms** | 95   | 1080    |
| Skew 7°                        | 3320×4349 | 382 ms     | **677 ms** | 78   | 1073    |
| Blur+shadow+low-contrast combo | 3320×4349 | 386 ms     | **398 ms** | 71   | **490** |
| 2× screenshot                  | 1807×2556 | 203 ms     | **669 ms** | 95   | 1080    |

End-to-end in one process (import sharp + import tesseract.js + preprocess + worker init + recognize), 1 core: **1.00–1.18 s wall, max RSS ~205 MB.**

**Degradation costs accuracy, not time.** The combo image returned in _less_ time (398 ms) with 490 of 1080 characters at confidence 71 — a fast return is a _failed_ read, not a good one. So a latency-only p95 dashboard (`spec.md:305`) will look healthiest exactly when OCR is failing worst. NFR-001 as specified cannot see this.

### ⛔ MEASURED — the case that breaks it: text density, not file size

Same page dimensions (2121×3000), same file-size class, varying only how much text is on the page:

| Chars on page | Recognize (1 core, median) | Notes                           |
| ------------- | -------------------------- | ------------------------------- |
| 2,661         | **1,649 ms**               | 0.99 MB                         |
| 6,131         | **2,985 ms**               | 1.32 MB                         |
| 15,283        | **6,329 ms**               | 1.80 MB — dense two-column page |

Recognizer throughput is roughly linear in characters (~2,000 chars/s on this core at 3000 px). **All three inputs are legal**: under `maxImageBytes` 10 MB and `maxImagePixels` 40 MP (`ocr-budget.config.ts:24,34`).

**This is the finding that decides the question.** NFR-001 bounds _megabytes_. Megabytes do not predict recognizer cost — characters do, and the two are uncorrelated (my 1.80 MB dense page costs 7× my 2.78 MB recipe card). **A requirement expressed in MB cannot bound the variable that drives the cost**, so NFR-001 is unfalsifiable as written: it can be met on the stated test input and missed in production by a wide margin.

And a text-dense page is not an exotic input for **this** feature. The owner's stated use case is _web_ OCR — long-scroll screenshots of recipe blogs are among the most text-dense images a user could plausibly submit.

### ESTIMATED — where it passes and where it fails, by memory tier

Lambda allocates CPU proportionally, reaching ~1 vCPU at 1,769 MB (AWS Lambda documentation, _Configuring function memory_; also the basis of the AWS Lambda pricing page's memory/CPU note). Estimated Lambda duration = `host_seconds × S ÷ (MB ÷ 1769)`, with S = 2.5.

| Memory  | vCPU | Typical card (1.27 s host) | Dense page (6.72 s host) |
| ------- | ---- | -------------------------- | ------------------------ |
| 512 MB  | 0.29 | ~11.0 s ❌                 | ~58 s ❌                 |
| 1024 MB | 0.58 | ~5.5 s ⚠️                  | ~29 s ❌                 |
| 1769 MB | 1.00 | **~3.2 s ✅**              | **~16.8 s ❌**           |
| 3538 MB | 2.00 | ~3.2 s ✅ (no gain)        | ~16.8 s ❌ (no gain)     |

Sensitivity at 1,769 MB: typical card **2.5 s (S=2.0) / 3.8 s (S=3.0)**; dense page **13.4 s / 20.2 s**. The dense page misses at every S in range.

**Two structural conclusions:**

1. **512 MB fails on memory alone, before CPU.** Measured max RSS reached **489 MB** across a five-image run and **343 MB** on a 25-invocation single-image run. WASM linear memory never shrinks, so a warm container's floor is set by the largest image it has ever processed (measured plateau: 223 → 311 → 332 → **334 MB** by invocation 25; and 301 → 351 → 398 → 458 → 478 MB when image sizes vary). This is a high-water mark, **not** an unbounded leak — but it means 512 MB will OOM a warm container that eventually sees a big page.
2. **Buying memory above 1,769 MB buys nothing.** `worker.recognize()` runs in a **single** worker thread. Beyond 1 vCPU the extra capacity is unreachable by this workload. So the owner's assumed 2 GB is ~13 % better than 1,769 MB on latency while costing 16 % more per ms — and **no memory tier rescues the dense page.**

### Verdict

**Tesseract.js at 1,769 MB meets NFR-001 as literally written** (a 4 MB JPEG of a recipe card: ~3.2 s estimated vs a 10 s budget) **and fails the requirement NFR-001 was trying to express** (p95 over real user submissions), because the tail is driven by character count, which NFR-001 does not bound and the dashboard does not measure.

**Smallest change that would make it pass**, in order of preference:

1. **Fix the requirement first.** Restate NFR-001 against a _corpus_ with a stated character-count distribution, not "a 4 MB JPEG". Nothing else can be evaluated until the target is falsifiable.
2. **Bound the work, not just the input.** Enforce a character/line ceiling and return a typed partial-result rather than running the LSTM to completion. This is the only change that makes the tail bounded _by construction_ rather than by luck.
3. **Split the page across workers.** Two half-page tesseract workers at 3,538 MB (2 vCPU) is the _only_ way more memory helps, and would roughly halve the dense case (~8.4 s estimated) — still thin against 10 s.
4. **Drop `preprocessMaxEdgePx` from 3,000 to ~1,600.** MEASURED: 509 ms vs 880 ms on the same 1,080-char page (~1.7×), which would bring the dense page to ~9.9 s estimated at 1,769 MB. Marginal, and `ocr-budget.config.ts:36-38` warns it costs small print — the wrong trade for aged cards.
5. **Textract**, which moves the work off our CPU entirely and makes the tail a vendor SLA rather than our sizing problem.

**Higher memory and provisioned concurrency do not fix this** — the first is capped by single-threadedness, the second addresses only cold start, which (below) is not the binding constraint.

---

## Cold start & the cost flip

### MEASURED — cold start is NOT the real risk, contrary to the brief

The brief asserts cold start is the main risk. My measurements say it is the _least_ of the problems, with one sharp exception.

Phase breakdown from tesseract.js' own progress logger, 1 core:

| Phase                            | Model on CDN | Model on local disk |
| -------------------------------- | ------------ | ------------------- |
| loading tesseract core (WASM)    | 26 ms        | 25 ms               |
| initializing tesseract           | 22 ms        | 21 ms               |
| **loading language traineddata** | **224 ms**   | **2 ms**            |
| initializing api                 | 105 ms       | 98 ms               |
| **total `createWorker`**         | **377 ms**   | **146 ms**          |

`import sharp` 54–58 ms; `import tesseract.js` 2–3 ms (both MEASURED).

The traineddata is **5,199,098 bytes on disk** (MEASURED) — not the 15–30 MB the brief assumes. The default LSTM path fetches `4.0.0_best_int/eng.traineddata.gz` = **2,952,873 bytes** (MEASURED via `curl -sIL` against the CDN). The 10,923,060-byte variant applies only if the legacy core is requested.

So Tesseract's own init is ~150 ms warm-disk. Even adding Lambda runtime init + sharp's native binary, cold overhead is plausibly ~1–2 s against a 10 s budget with ~3.2 s of work. **Provisioned concurrency is not required, so the free-tier saving survives on those grounds.**

### ⛔ MEASURED — the actual cold-start defect: a public CDN in the OCR hot path

`tesseract.js@7.0.0` **fetches its language model over the network at worker-creation time, from jsDelivr, by default** — and in Node it does not ship a bundled copy.

- Source: `worker-script/index.js:130` — `langPath || (lstmOnly ? 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int' : '.../4.0.0')`, with the comment at `:127`: _"If `langPath` if not explicitly set by the user, the jsdelivr CDN is used."_
- **Proven by measurement:** with the network namespace removed (`unshare -rn`) and no cached model, `createWorker('eng')` throws `Error: TypeError: fetch failed` at `createWorker.js:217`. With the model present on disk, the same call succeeds **fully offline** in 89 ms and recognizes normally (507–551 ms).

Consequences, all of which land on this repo specifically:

1. **A third-party CDN becomes a hard dependency of OCR.** jsDelivr down or rate-limiting ⇒ every cold OCR invocation fails. The plan's circuit breaker (`plan.md:432`, `ocr-budget.config.ts:64`) guards the _OCR provider_; it does not know about this fetch.
2. **It collides with ADR-0004.** If the OCR Lambda is VPC-attached to reach the private RDS, its only egress is the **single `t4g.nano` NAT instance** — explicitly _"a deliberate single-AZ SPOF + ~5 Gbps cap"_ (`docs/architecture/decisions/0004-minimize-nat-egress.md:12`), and ADR-0004:39 states any VPC Lambda needing internet _"joins the NAT set"_. Every cold start would then pull ~2.95 MB through that instance. Whether this binds depends on an undecided design point — `plan.md:389` says the worker writes _"via internal API/DB client"_, and the "internal API" variant avoids VPC attachment. **Flag, not yet a defect.**
3. **Supply-chain**: an unpinned, unverified binary model fetched at runtime into a process that then parses attacker-influenced images.

**Fix is trivial and I verified it works:** bake `eng.traineddata` (5.0 MB) into the artifact and set `langPath` to that directory. Cold init drops 377 ms → ~146 ms, the CDN dependency disappears, and the NAT question goes away. **If Tesseract ships, this is non-negotiable.**

Artifact size is a non-issue (MEASURED): `tesseract.js` 1.4 MB + `tesseract.js-core` 43.2 MB (all variants; only one ~6.5 MB `simd-lstm` triple loads at runtime) + `sharp` 0.9 MB + `@img` platform binaries 17.9 MB + model 5.0 MB ≈ **68 MB unzipped**, or ~32 MB pruned — comfortably inside Lambda's 250 MB unzipped limit.

### The cost flip — computed at the tier that actually works

Prices from the [AWS Lambda pricing page](https://aws.amazon.com/lambda/pricing/) and [Textract pricing page](https://aws.amazon.com/textract/pricing/), us-east-1, verified during this review: Lambda **$0.0000166667/GB-s**, free tier **400,000 GB-s + 1M requests/month**; provisioned concurrency **$0.015/GB-hour**; Textract `DetectDocumentText` **$0.0015/page** (first 1M).

**Key arithmetic result: for a purely CPU-bound function, GB-seconds are invariant across memory tiers below 1 vCPU.** Halving memory doubles duration; the product is constant. At S=2.5 the typical card costs **≈5.5 GB-s at 512, 1024, _and_ 1769 MB** — you do not save money by under-provisioning, you only wait longer. So size for latency (1,769 MB) and stop worrying about the tier's cost.

At ~5.5 GB-s/image, the 400,000 GB-s free tier covers **~73,000 images/month** (ESTIMATED). Same volume on Textract: 73,000 × $0.0015 = **$110/month**.

**But that is the free-tier ceiling, not this system's volume.** The brief states there is **no production traffic** and services scale to 1 or zero. At a realistic pre-launch volume of ~1,000 OCR jobs/month:

|                | Tesseract on Lambda                          | Textract  |
| -------------- | -------------------------------------------- | --------- |
| 1,000 jobs/mo  | 5,500 GB-s = **1.4 % of free tier** → **$0** | **$1.50** |
| 10,000 jobs/mo | 55,000 GB-s → **$0**                         | $15.00    |
| 73,000 jobs/mo | 400,000 GB-s → **$0**                        | $110.00   |

**⛔ The decision saves ~$1.50/month at realistic volume, against a $300/month account budget — about 0.5 %.** The cost case is directionally correct and materially irrelevant at this system's scale. It is being paid for with a measurably worse engine on the feature's hardest input class (handwriting), a domain signal (`handwritten`) that cannot be populated, a runtime CDN dependency, and a tail that misses the NFR on dense pages.

**Does provisioned concurrency flip it?** Yes, decisively — if it were ever needed:

- One provisioned instance at 1,769 MB = 1.728 GB × 730 h × $0.015 = **$18.92/month**, billed whether or not anything runs, _plus_ execution.
- $18.92 buys **12,600 Textract pages/month**.
- **So a single provisioned-concurrency instance makes Textract cheaper until ~12,600 pages/month** — a volume this system is nowhere near. (At 1,024 MB: $10.95/mo ⇒ break-even ~7,300 pages.)

My measurements say provisioned concurrency is **not** needed (cold overhead ~1–2 s vs a 10 s budget), so the free-tier saving survives — but the saving is $1.50/month, and the moment anyone reaches for provisioned concurrency to defend the p95, the entire economic rationale inverts.

---

## Downscale cost

**The brief's premise is already satisfied — the downscale exists, and it bounds both Textract limits.** `preprocessForOcr` (`.worktrees/004-recipe-importing/.../imports/ocr/ocr-image.ts:93`) enforces, in order: byte bound before any decode (`:96`), magic-byte typing (`:100-106`, never the client's `Content-Type`), header-only pixel bound (`:114-126`), then `rotate → greyscale → normalise → resize(3000px inside, withoutEnlargement) → jpeg(q90)` (`:131-148`).

Against Textract's caps (10 MB synchronous document size — verified on the pricing/limits docs this review; ≤10,000 px per side per the _Hard Limits in Amazon Textract_ doc, taken from the brief's statement and not independently re-verified): `maxImageBytes` is exactly 10 MB (`ocr-budget.config.ts:24`) and output is capped at 3,000 px per side, so **post-preprocessing output is inside both caps with large margin.** MEASURED outputs: 0.36–0.80 MB. This attack line does not land as a _correctness_ gap.

### MEASURED — cost of the downscale

| Input          | Pixels    | `metadata()` | Full preprocess |
| -------------- | --------- | ------------ | --------------- |
| 12 MP, 2.78 MB | 3024×4032 | 1 ms         | **389 ms**      |
| 12 MP, 0.58 MB | 2850×4032 | 0 ms         | **343 ms**      |
| 46 MP, 1.44 MB | 5701×8064 | 0 ms         | _rejected_      |
| 2× screenshot  | 1807×2556 | 0 ms         | **203 ms**      |

Peak RSS for sharp alone: ~210 MB at 46 MP. The header-only `metadata()` guard costs **≤1 ms** — the decompression-bomb control is effectively free, as its docstring claims (`ocr-image.ts:11-13`).

**It does not push past NFR-001 or past a sensible memory tier.** 343–389 ms is ~11 % of the estimated 3.2 s typical-card budget at 1,769 MB, and sharp's peak is below Tesseract's.

### Two real findings inside the downscale

1. **⚠️ `normalise()` runs at FULL resolution, before the resize** (`ocr-image.ts:137-146`). It computes a histogram across all 12 MP, then throws away 87 % of those pixels. This is the bulk of the 343–389 ms. Comparison point (MEASURED, different chain — `rotate → resize(2000) → jpeg`, no greyscale/normalise): **35–118 ms**. Reordering to `rotate → greyscale → resize → normalise` should recover a large share. Caveat, stated honestly: normalising _after_ downscale changes the histogram slightly and therefore the output, so this needs an accuracy check against the fixture corpus, not just a stopwatch. **Not a free win — a candidate with a required A/B.**

2. **⛔ HEIC is accepted by the allowlist and (per the code's own comment) cannot be decoded.** `SUPPORTED_IMAGE_MEDIA_TYPES` includes `image/heic` and `image/heif` (`ocr-budget.config.ts:94`), with a docstring calling HEIC _"the single most common real-world photo format"_. But `ocr-image.ts:156-158` says the catch-all handles _"a container whose codec is not compiled into our libvips (HEIC/HEVC on the current build)"_. If that comment is accurate, **every iPhone HEIC upload passes the allowlist and then fails with a typed 415** — the format is nominally supported and actually broken, which is exactly what the config docstring says it is trying to avoid.

    I could not settle this from here. MEASURED on the npm prebuilt `sharp@0.35.3`/libvips 8.18.3: `sharp.format.heif.input.buffer === true`. But that flag reports _container_ support; sharp's prebuilt binaries have historically excluded HEVC decode for patent reasons, which matches the code comment. **The format table and the code comment disagree, and only a real HEIC decode settles it.** See "What must be measured".

3. **A 48 MP phone photo is rejected.** `maxImagePixels: 40_000_000` (`ocr-budget.config.ts:34`) — I hit this: a 5701×8064 (46 MP) input threw `Input image exceeds pixel limit`. The docstring reasons _"a 48 MP phone sensor bins to 12 MP for HEIC"_, which holds in default mode but **not** for iPhone "48 MP Max" (8064×6048 = 48.8 MP) or Samsung 200 MP modes. It fails **closed** with a typed 413 naming pixels, which is correct behaviour — but the stated rationale is out of date, and this is a real user hitting a wall.

---

## Live-reference read amplification

**⛔ The brief's premise is wrong, and I am not going to manufacture the finding it expects.** I traced the actual read paths; the performance case against live reference **does not hold**, and there is no N+1.

### What the code actually does

**Detail** (`GET /api/v1/recipes/{id}`): `RecipesController.getById` (`packages/services/recipe-service/src/recipes/recipes.controller.ts:75`) → `RecipesService.getById` (`recipes.service.ts:565`) → `RecipesDal.findById` (`dal/recipes.dal.ts:249`). Nutrition is attached at `recipes.service.ts:426` via `computeDetailNutrition` (`:367`) → `assembleNutritionLines` (`:379`):

```ts
382: const ids = [...new Set(lines.map((line) => line.ingredientId))];
383: const catalog = new Map((await this.ingredientsDal.findByIds(ids)).map((ing) => [ing.id, ing]));
385: return lines.map(({ ingredientId, ...measure }) => toNutritionLine(measure, catalog.get(ingredientId)));
```

- **One** `WHERE id IN (…)` query, deduplicated, **independent of ingredient count**. Not N+1.
- It hits the recipe-service's **own local `ingredients` table**, served by the table's **primary key** btree (`database/schema/ingredients.ts:51`). Adequately indexed; no missing index.
- **It is not a cross-service call.** No food-service HTTP request occurs on any recipe read path.

**List** (`GET /api/v1/recipes`): `recipes.service.ts:592`. **Zero nutrition work** — the extras object passed to `toRecipeResponse` (`:597-606`) carries only `coverPhotoUrl`. The list serves a **write-time denormalized** `lead_calories_per_serving` (`mappers/recipe-row-to-domain.ts:130-131`), and the contract says so explicitly: _"Present on the DETAIL reads; absent on list/search"_ (`dto/recipe-response.dto.ts:115-116`). Search likewise projects only the denormalized column (`search/dal/search.dal.ts:201`).

**Answer to "how many food rows to render a 20-recipe list": zero.** The list touches no ingredient or food rows for nutrition at all.

Total detail read ≈ 6 local queries, of which nutrition contributes exactly **one**. Every recipe→food-service call site is in the _ingredients_ vertical (`ingredients.service.ts:342,370,404,444,488`; `food-catalog.gateway.ts:129`) — request-scoped, one per request, none in a loop, **none on a read path**.

### The real cost of live reference is correctness, not latency

There is a genuine defect here, and it is the mirror image of the one the brief expected:

**Detail is live; list and search are pinned — and they disagree.** Detail recomputes from current catalog rows on every read (`recipes.service.ts:383`), while list/search serve `lead_calories_per_serving` frozen at the last write (`recipes.service.ts:488, 649, 779`). When a catalog nutrition value changes, **the list and the detail page for the same recipe show different calories, indefinitely**, until that recipe happens to be written again. No backfill exists.

That is a user-visible inconsistency produced by having _both_ strategies rather than either one. It is a **data-consistency finding, not a performance one**, and it belongs to whoever owns the nutrition contract.

**No caching exists on any of it** (grepped: `cache-control`, `lru`, `redis`, `CacheModule`, `etag`, `Distribution(` — zero hits on read paths). At current traffic that is fine and I am not recommending a cache; it is recorded so nobody assumes one is protecting these paths.

---

## Bulk load

### The bulk processor does not exist

`docs/architecture/decisions/0019-recipe-import-spine.md:43-60` (_"One bulk import processor"_) and `specs/004-recipe-importing/spec.md:211-218` (**FR-047**) are **specification only**. Commit `4a979422` is docs-only. The checked-out branch has no `imports/` directory at all; the 004 implementation lives on the `.worktrees/004-recipe-importing` worktree, and there:

- The channel registry is a **one-element array** — `useFactory: (url: UrlImportChannel) => [url]` (`imports/imports.module.ts:253-254`). File, OCR and Instagram channels are constructed but **wired to no route**.
- The only ingest route is `POST /api/v1/recipes/import/url` (`imports/imports.controller.ts:78`).
- `FileParserService` exists and enforces `maxRecipesPerFile = 1_000` (`imports/files/file-limits.config.ts:32`) but **nothing outside tests calls it**.
- Confirmation is strictly **one draft → one recipe** (`imports/confirm/draft-confirmation.service.ts:156-175`).

**So the 1,000-recipe import cannot be load-tested, because it cannot be invoked.** Everything below is therefore _code analysis of the path a bulk processor would traverse_, explicitly **not** measurement.

### ⛔ Confirmed: one food call per ingredient name, sequential, batch method unused

`imports/imports.module.ts:298-303`:

```ts
submitForCatalogResolution: async (caller, names) => {
    for (const name of names) {
        await ingredients.addByName(caller, name);
    }
},
```

The comment at `:297` justifies it: _"Fire-and-forget, sequential: a bulk confirm must not fan a burst at the shared catalog (HAZ-059)."_ The reasoning is sound about _bursts_ — but the choice it frames is sequential-vs-parallel, and **the option it never considers is batched.**

`FoodServiceClient.batch(names: readonly string[])` (`packages/clients/food-service/src/client.ts:167`) accepts up to 100 names against `POST /api/v1/foods/batch`, and the server already deduplicates intra-batch (`food-service/src/foods/foods.service.ts:248`). **It has zero non-test callers repo-wide.**

Each `addByName` is itself 3 sequential round-trips — HTTP (`ingredients.service.ts:370`), then `findByFoodId` (`:371`), then `createFoodBacked` (`:377`) — each HTTP call bounded at `DEFAULT_TIMEOUT_MS = 8_000` (`client.ts:82`), **with no retry and no backoff** (the client parses `Retry-After` at `:345-350` and surfaces it without ever acting on it).

**Quantified cost of the unused `batch`:**

| Scale                              | Current (1 call/name)       | With `batch(100)` | Reduction |
| ---------------------------------- | --------------------------- | ----------------- | --------- |
| 1 recipe, 12 ingredients           | 12 HTTP + 24 DB             | 1 HTTP            | 12×       |
| 1 recipe, 60 ingredients           | 60 HTTP + 120 DB            | 1 HTTP            | 60×       |
| **1,000 recipes × 10 ingredients** | **10,000 HTTP + 20,000 DB** | **100 HTTP**      | **100×**  |

Worst-case wall time for a single 60-ingredient recipe if every call reaches its timeout: **60 × 8 s = 480 s**, sequential, with no ceiling on the loop. It is fire-and-forget (`draft-confirmation.service.ts:172`, `void`-ed, errors only logged at `:276-279`), so it does not block the user — it silently occupies a worker for eight minutes.

### Placeholder writes are per-row everywhere

- **Recipe side**, on the _synchronous_ confirm path (`draft-confirmation.service.ts:210-220`): `for (const line of lines) { … await this.ingredients.resolveLocalIngredient(line.name) }`. Each iteration is `createFreeform` (`ingredients/dal/ingredients.dal.ts:279`) = read-then-conditional-insert, **2–3 queries**, single-row `VALUES`. No multi-row insert exists on this path.
- **Food side**: `FoodDao.createByName` (`food-service/src/foods/dao/food.dao.ts:239-289`) opens **its own transaction and advisory lock per row**. Even `batchAdd` (`foods.service.ts:263-284`) loops `createByName` — up to 100 sequential transactions — and calls `admit()` **once, after the whole loop** (`:287`), so one shed batch strands up to 100 committed rows (independently noted in `02-food-service.md:144-145`).
- **Enqueue**: `enqueueOne` (`foods/enqueue.emitter.ts:126-174`) is 3 round-trips per name, and recomputes `request_count` via a correlated `SELECT count(*) FROM fetch_requesters` inside the insert (`:167,:169`) — deliberate per FR-044, but O(requesters) each time.

### Emit path: per-item, fire-and-forget, no outbox

`publishFoodFetchCompleted` (`food-service/src/events/food-event-emitter.ts:169-177`) is **one EventBridge `PutEvents` per food**, with the failure swallowed (`:174-176`). A 10,000-name import produces **10,000 separate `PutEvents` calls**. There is no outbox and no batching (`PutEvents` accepts 10 entries per call, so this is a 10× avoidable API-call multiplier).

Per-recipe/per-ingredient import **status** emission (ADR-0019 §4, FR-048/049) **does not exist** — corroborated by `09-data-model.md:275` (F-DB5).

### Where a 1,000-recipe import would actually break

1. **The queue ceiling is the binding constraint.** `FOOD_MAX_QUEUE_DEPTH = 10_000` (`food-service/src/config/env.schema.ts:74`), with flood-shed starting at 90 % (`admission.service.ts:28`). 1,000 recipes × ~10 ingredients = **exactly 10,000 names** — the import lands precisely on the ceiling, so a meaningful fraction is shed with `Retry-After` (`:31`) that **the client never honours** (`client.ts:345-350`).
2. **The drain is the bottleneck, and it is bounded low.** Worker concurrency is clamped to **[2, 8]** (`worker/concurrency.ts:79-90`, `MAX = 8` at `:25`) with a documented reason (USDA latency), and exactly one drainer holds the advisory lock. Outbound is capped at **1,000 USDA requests/hour** (`env.schema.ts:58`). **At that rate, 10,000 new names take ≥10 hours to drain** regardless of how fast anything upstream runs.
3. **⚠️ Correction to a figure in circulation.** The "541 ms per claim at depth 1,000 and 7.6–11 s at the 10,000 ceiling" numbers are the **pre-fix T-195** measurement, _not_ current behaviour. `packages/services/food-service/tests/drain-claim-scaling.integration.test.ts:1-46` documents that defect as **fixed** (T-197/T-201) and regression-gates it three ways — cost ratio, semantics, and an `EXPLAIN (ANALYZE, FORMAT JSON)` tuple-count assertion (`MAX_PRIORITY_INDEX_TUPLES = 10`). **Do not cite those numbers as live.**
4. **Garbage amplification.** `normalizeName` is only trim/collapse/lowercase (`foods/merge/merge-engine.ts:130-132`), so an unparsed line becomes a permanent global food shell cycling `PENDING → FAILED → (30 d) → PENDING` (`food.dao.ts:183`), each burning a queue slot and a USDA call forever. `09-data-model.md:545-600` ("Parse before you enqueue") already owns this.
5. **No concurrency control on the import side at all.** `InProcessImportJobQueue.publish` (`imports/jobs/import-job.queue.ts:83-120`) dispatches in-process, unbounded, at-most-once, **no DLQ** (its own doc, `:21-27`); shutdown does `Promise.all` over an unbounded set (`:131`). No `p-limit`/`p-queue`/semaphore exists anywhere in the repo. No SQS, no Lambda, no autoscaling for imports (`recipe-service/infra/lib/recipe-service-stack.ts` has only `desiredCount`).

**Net:** a 1,000-recipe import is not a CPU or query-plan problem. It is a **fan-out and admission problem** — 10,000 sequential HTTP calls feeding a queue whose ceiling it exactly saturates, drained by ≤8 workers behind a 1,000/hour external rate limit, with no backpressure signal reaching the producer.

---

## What must be measured before committing

Ordered by how much each would change the decision.

1. **Lambda single-thread ratio (S).** Everything in the first two sections is scaled by an _assumed_ 2.5×. Deploy a trivial function at 1,769 MB running one `worker.recognize()` on a fixed image and compare to this host. **One afternoon; collapses the largest uncertainty in this review.**
2. **A real corpus with a character-count distribution.** Fifty real user-style inputs — phone photos of cookbook pages and cards, plus **long recipe-blog screenshots** — recorded as (chars, recognize_ms, confidence). NFR-001 cannot be evaluated, and the dense-page failure cannot be sized, without this. **This is the gate, not a nice-to-have.**
3. **`Duration` p95 tagged `cold=true` at 1,024 / 1,769 / 3,538 MB**, over that corpus, plus **`MaxMemoryUsed`**. Confirms or refutes the tier table and the 512 MB OOM claim directly.
4. **Accuracy A/B: Tesseract vs Textract on the same corpus**, scored by character error rate, **segmented by print vs handwriting.** The cost saving is ~$1.50/month; the only thing that can justify it is evidence the accuracy gap is small. On present evidence I expect the gap to be largest exactly where this feature is most differentiated.
5. **Does a real HEIC decode?** Take an actual iPhone HEIC through `preprocessForOcr` on the **deployed** image, not on a dev laptop. `sharp.format.heif.input.buffer` reports `true` while `ocr-image.ts:157` says the codec is absent — one of them is wrong, and if the comment is right, the most common consumer photo format is broken end-to-end.
6. **`normalise()` reorder A/B** — move it after `resize`, then compare _both_ preprocess ms **and** OCR confidence/CER on the corpus. Reject the reorder if accuracy moves.
7. **Bake the traineddata and re-measure cold init** (expect 377 → ~146 ms) and confirm the function runs with egress blocked. Cheap, and it removes a CDN from the hot path.
8. **The `batch()` conversion**, once a bulk processor exists: 1,000-recipe import wall-clock, food `fetch_queue` peak depth, `admit()` shed count, and EventBridge `PutEvents` call count, before and after.
9. **k6 on the OCR endpoint.** The repo's own testing policy requires k6 for services (`CLAUDE.md`, testing policy) and per `ci-heavy-tiers-and-sandbox-hosts` it needs the `heavy-e2e` PR label. Concurrency ≥20 is already an explicit requirement (**NFR-006**, `spec.md:297`) and is **completely unexercised** today.

---

## Not examined

- **Anything on real AWS.** No Lambda, Textract, S3, EventBridge, RDS or CloudWatch measurement — no account access from this session. Every Lambda figure is arithmetic on host measurements.
- **Real-world OCR accuracy.** My corpus is synthetic and clean. I measured _latency_ honestly and make **no claim** about Tesseract's accuracy on genuine photographs or handwriting beyond noting the architectural gap (`handwritten` unpopulatable) and Tesseract's documented print-training.
- **Mobile on-device OCR.** The brief states mobile submits raw text; I did not examine the mobile path, its engine, or whether its confidence values normalize onto the same 0–100 scale the port assumes (`ocr-provider.port.ts:27`). **That normalization is a real open question** — the plan's own confidence rule (`plan.md:79`) was written for a different interface than the one that shipped.
- **The 004 worktree's overall state.** I read the OCR and import modules only. The worktree is uncommitted work on a different branch; I did not assess whether it is current or merge-ready.
- **Textract's own latency.** I verified pricing and the 10 MB cap but measured no Textract call, so "Textract makes the tail a vendor problem" is an architectural claim, not a measured comparison. Its async `StartDocumentTextDetection` polling loop (`ocr-budget.config.ts:43-58`, up to 12 attempts / 120 s) has its own latency profile I did not evaluate against NFR-001.
- **Per-domain async processors as a topology.** The brief lists this as a decision under attack; with the bulk processor unimplemented there was nothing running to measure. Covered structurally in "Bulk load" only.
- **Circles, audience, versioning, and the `raw_ocr_json` purge job** (FR-036/NFR-008) — out of scope for the five attack lines.

---

## Recommended next agents

- `staff-architect` — the `OcrProvider` port takes an S3 location for a Textract-shaped reason and cannot express `handwritten` under Tesseract; that is a port-contract decision, not a tuning one.
- `be-1` — the unused `FoodServiceClient.batch()` conversion, the `normalise()` reorder, baking the traineddata, and the missing `Retry-After` handling in the food client.
- `db-arch-1` — the live-detail vs pinned-list nutrition divergence (`recipes.service.ts:383` vs `recipe-row-to-domain.ts:131`). Data consistency, not performance.
- `sre-1` / `devops-1-devops-engineer` — whether the OCR Lambda is VPC-attached, and therefore whether it lands on the ADR-0004 `t4g.nano` NAT.
- `qse` — the k6 tier for NFR-006 (≥20 concurrent jobs), currently unexercised.

**Confidence: Medium-High.** High on the host measurements and on the code-path tracing (both re-verified at file:line). Medium on every Lambda-scaled figure, which rests on an assumed 2.5× slowdown factor that nobody has measured — item 1 above exists to fix precisely that.

**Sources:** [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/) · [Amazon Textract pricing](https://aws.amazon.com/textract/pricing/) · [Hard Limits in Amazon Textract](https://docs.aws.amazon.com/textract/latest/dg/limits.html) · [DetectDocumentText API](https://docs.aws.amazon.com/textract/latest/APIReference/API_DetectDocumentText.html)
