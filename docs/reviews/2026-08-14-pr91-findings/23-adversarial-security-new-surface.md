# 23 — Adversarial security review: the NEW attack surface (2026-08-14 decisions)

**Scope**: `/home/brandon/Development/KitchenSink` @ `chore/code-quality-enforcement-phase-1-2` (working tree), plus the `004-recipe-importing` worktree at `.worktrees/004-recipe-importing`.
**Posture**: read-only. No exploit was run against any deployed system. Where I measured something, I ran the real library (or the repo's own code) locally in-process and quoted the output; every finding says which.
**Builds on** `08-security.md` (existing surface — `sharp` CVEs, `candidateIds` amplification, the load-shedder key leak, `z.url()` scheme acceptance) and does not repeat it. It also builds on `11-A8` (the FR-025 inversion), `12-A8` (nobody owns the catalog garbage), `13-A9` (no machine-to-machine credential) and `15-A1` (caller-authored catalog display names) rather than restating them.

---

## ⚠️ Premise reconciliation — read this first

Two of the four surfaces I was briefed on **are not in the repository**, and one of them is explicitly _rejected_ there. This is not a quibble: the committed controls were designed for the rejected option, so if the 2026-08-14 decisions stand, several existing controls become inapplicable and one becomes actively misleading.

| Briefed                                                                     | What the repo says                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web runs **Tesseract.js (WASM) on Lambda** behind 011's `OcrProvider`       | The committed provider is **AWS Textract**. Tesseract is named twice, both times as a **rejected** alternative: `specs/004-recipe-importing/research/tech-stack.md:41` (_"Tesseract (self-hosted) \| Textract \| Container + model operations we don't want to own"_) and `specs/004-recipe-importing/plan.md:350`. Zero occurrences of `tesseract.js` anywhere, including `package-lock.json`. |
| A **downscale step (likely sharp)** is required first                       | 011's spec says the opposite: `specs/011-recipe-digitization/spec.md:352` — _"Drizzle ORM + `pg`; **Sharp not required here (no image transformation; Textract takes the raw upload)**."_ A full sharp preprocessing pipeline **does** exist, but in the **004 worktree**, in **recipe-service** — the branch ADR-0019 §3 supersedes.                                                           |
| Mobile does **on-device OCR** and submits **raw text** to a new 004 channel | **No raw-text or on-device-OCR channel is specified anywhere** — not in 004, not in 011, not in ADR-0019, not in the PR-91 reviews. The nearest thing is `manual` provenance, which `imports/policy/import-channel-access.ts:24-26` says is _"deliberately absent from `IMPORT_ENDPOINT_CHANNELS`: it is a provenance channel … not an import endpoint."_                                       |
| A **message substrate** built in PR 91, food produces to it                 | Design only. 014 specifies SQS FIFO + EventBridge + Valkey; **nothing exists in code**. Food's `EventBus` is wired to `ConsoleEventBus` (`packages/services/food-service/src/events/food-event-emitter.ts:212-214`, `src/worker/main.ts:16,64`); repo-wide there is **zero** use of `@aws-sdk/client-eventbridge`.                                                                              |
| **Food placeholder rows** in a shared ownerless catalog from user strings   | ✅ Real and shipped today (`foods.service.ts:207`, `foods.controller.ts:102`).                                                                                                                                                                                                                                                                                                                  |

I reviewed the briefed surfaces as prospective, because they are the decisions being made. **The divergence is itself a finding** (S-1, S-9): the controls that would protect a Tesseract-on-Lambda design were written for Textract-in-recipe-service, and the decision to move the channel is the decision that drops them.

---

## S-1 — The one control that makes untrusted image bytes safe lives in the branch ADR-0019 supersedes, and 011 states it is not needed

**Surface.** Attacker-controlled image bytes reaching an image decoder (libvips, or Tesseract's leptonica-WASM + `bmp-js`).

**Attack scenario.** A user mints a presigned PUT, uploads bytes whose magic prefix is a valid PNG/JPEG but whose body is crafted against the decoder (or is simply a 39-megapixel photograph), and the OCR worker reads the object. If the worker hands the **original bytes** to the provider — which is exactly what `spec.md:352` says Textract does, and what a Tesseract adapter would do by default — then every decoder CVE and every pixel bomb is reachable in the worker process, and the magic-byte check is the _entry condition_, not the mitigation (the same reasoning as `08-security.md` F-SEC3).

**Evidence.**

- The control exists, and it is good: `.worktrees/004-recipe-importing/packages/services/recipe-service/src/imports/ocr/ocr-image.ts:93-152` — `preprocessForOcr` bounds bytes **first** (`:95-99`, _"a check that runs after the work is a bound in name only"_), magic-byte-detects via `file-type` (`:52-56`), fails closed on a full media-type match (`ocr-budget.config.ts:107-114`), header-parses dimensions and rejects above `maxImagePixels = 40_000_000` (`:123-127`, `ocr-budget.config.ts:34`), then **re-encodes** through `sharp(...).rotate().greyscale().normalise().resize({width:3000,height:3000,fit:'inside'}).jpeg({quality:90})` (`:130-149`) and returns `{ bytes, mediaType: 'image/jpeg' }`. The provider never sees the original bytes.
- ADR-0019 §3 (`docs/architecture/decisions/0019-recipe-import-spine.md:74-82`) moves the image branch out of that service into a new 011 deployable.
- 011 has **no pixel cap at all**: `specs/011-recipe-digitization/v-model/module-design.md:794-796` declares `ALLOWED_MIME`, `MAX_BYTES = 20*1024*1024` and `MIN_DIM = 300` — there is no `MAX_DIM`, no megapixel bound. Its byte cap is **20 MB, double** the implemented `maxImageBytes: 10 * 1024 * 1024` (`ocr-budget.config.ts:24`).
- 011's hazard analysis has no entry for a decompression/pixel bomb or a malformed-image CVE; the malicious-image hazard is `HAZ-037` in **004's** hazard analysis (referenced at `ocr-budget.config.ts:87`, `ocr-image.ts:1,7`).

**Severity.** Now: **LOW** — no photo endpoint is reachable (`.worktrees/004-recipe-importing/.../imports.controller.ts` exposes `POST url` and the draft routes only; no `@Post('photo')`). At launch: **HIGH**, and it is the difference between a decoder CVE being a bug and being RCE-adjacent in a service that reads a shared database.

**Control required.** Port `preprocessForOcr` — byte bound → magic-byte type → header-parsed pixel bound → **re-encode to a single canonical format** — into whichever service owns the image branch, and make "the OCR provider is only ever handed re-encoded bytes" a typed invariant (the adapter's input type should be `PreprocessedImage`, never `Uint8Array`). Delete `spec.md:352`'s "Sharp not required here". Add `MAX_DIM`/megapixel to 011's `module-design.md:794` and reconcile 10 MB vs 20 MB to one number.

**Verified how.** Read `preprocessForOcr` end to end in the worktree; read 011's constants block and grepped `specs/011-recipe-digitization/` for `MAX_DIM|megapixel|limitInputPixels` (zero hits). Not executed against a deployed stage.

---

## S-2 — Recognition time is unbounded by any shipped control; the existing preprocessing caps the decode, not the compute, and 011's own NFR is refuted by measurement

**Surface.** Tesseract.js recognition wall-clock and memory, driven by attacker-chosen image _content_ (not size).

**Attack scenario.** Upload a high-entropy image — random black/white pixels, or a densely textured photograph. Tesseract's layout analysis and LSTM recognition run per connected component, so cost tracks visual complexity, not file size. Every bound in the shipped pipeline passes: it is a real JPEG/PNG, under the byte cap, under the pixel cap. The worker then spends tens of seconds of CPU per image.

**Evidence — measured, running the real `tesseract.js@7.0.0` against images produced by the repo's own `sharp@0.34.5` and the _verbatim_ shipped preprocessing pipeline (`greyscale → normalise → resize 3000 inside → jpeg q90`):**

```
{"source":"6300x6300","sourceBytes":7376470,"withinByteCap10MB":true,
 "preprocessMs":558,"preprocessedTo":"3000x3000","recognizeMs":36942,"rssDeltaMB":224.1}
{"source":"3000x3000","sourceBytes":1675376,"withinByteCap10MB":true,
 "preprocessMs":332,"preprocessedTo":"3000x3000","recognizeMs":40963,"rssDeltaMB":46.3}
```

6300×6300 is **39.7 MP — inside** `maxImagePixels: 40_000_000`; 7.4 MB is **inside** `maxImageBytes: 10 MB`. Preprocessing costs 0.5 s and buys nothing: recognition still takes **37 seconds**. Raw (un-preprocessed) scaling for reference: 1 MP → 3.55 s, 4 MP → 15.0 s, 16 MP → 81.2 s (+269 MB RSS) — slightly worse than linear in pixels. Peak process RSS across the pipeline run was **592 MB**.

Three consequences the specs do not account for:

1. **`specs/011-recipe-digitization/spec.md:292` (NFR-001) — _"OCR processing completes within 10 s for a 4 MB JPEG on cold Lambda"_ — is refuted for adversarial input** by an order of magnitude, on a full core. It is a benign-input SLO being used as if it were a bound.
2. **The 30 s / 120 s budgets are Textract-shaped and do not transfer.** `module-design.md:1193` `timeoutMs: env.OCR_TIMEOUT_MS ?? 30000` and `ocr-budget.config.ts:58` `hardDeadlineMs: 120_000` bound an **async HTTP poll loop**. In-process WASM recognition has no such seam.
3. **The abort is available but not free, and it behaves differently on Lambda than on Fargate.** Measured: `worker.terminate()` returns in **0 ms** and does kill the worker thread (node exited at 4.79 s wall instead of running to 81 s) — but the in-flight `recognize()` promise **never settles**, neither resolving nor rejecting. On Lambda that is harmless (the process dies). In a long-lived Fargate process it is a permanent leak of the closure and the image buffer per aborted job. **The implemented code sits in recipe-service's Fargate task**, sized `cpu: 512, memoryLimitMiB: 1024` (`packages/services/recipe-service/infra/lib/recipe-service-stack.ts:317-318`) — half a vCPU and 1 GiB, against a measured 592 MB peak and ≥37 s at a _full_ core. One OCR job would saturate the task that serves every recipe API request.

**Severity.** Now: **LOW** (unreachable). At launch: **HIGH** for availability if OCR runs in-process on Fargate; **MEDIUM** on Lambda, where process isolation genuinely helps — see below.

**Lambda's isolation, weighed honestly.** It is a real mitigation and I do not want to undersell it: one invocation, one microVM, a hard timeout the platform enforces regardless of what the WASM is doing, memory accounted per invocation, and a crashed or corrupted process is discarded rather than reused. That converts "a malicious image degrades the API for everyone" into "a malicious image costs one invocation". It does **not** mitigate cost (S-3), it does **not** mitigate concurrency exhaustion (S-4), and it does **not** mitigate a decoder CVE that reads or exfiltrates within its own invocation — the Lambda still holds the S3 read role and, if VPC-attached, a network path to RDS. Lambda changes the blast radius from the fleet to the invocation; it does not make untrusted-byte decoding safe.

**Control required.** (a) A **hard wall-clock bound per image**, enforced by `worker.terminate()` racing the recognition, with the dangling promise explicitly abandoned and documented — and the Lambda `timeout` set below the platform max as the backstop. (b) Set `preprocessMaxEdgePx` from a **compute** budget, not a legibility one: at 3000 px the measured cost is ~37 s; at 1500 px it is ~4× cheaper. (c) Size `memorySize` from the measured 592 MB peak, not from a guess. (d) Correct NFR-001 to state the input class it holds for.

**Verified how.** Empirically, locally: `tesseract.js@7.0.0` + `sharp@0.34.5` (the repo's installed copy), pipeline transcribed from `ocr-image.ts:130-149`; outputs quoted verbatim. Task sizing read from the CDK stack. The CVE/exfiltration reasoning in the Lambda paragraph is reasoned, not tested.

---

## S-3 — Cost is the strongest available attack, and the two controls that would bound it are (a) deferred by 011 and (b) keyed to the wrong thing

**Surface.** Per-user OCR spend against a $300/month account budget.

**Attack scenario.** An authenticated user (sign-up is open and free) loops image uploads. Each one costs real compute. Nothing durable stops them.

**Evidence.**

- **011 explicitly ships ungated.** `specs/011-recipe-digitization/spec.md:53` — _"Optional entitlement check before enqueuing OCR (**Q-002 deferred to implementation**). **011 ships ungated if 010 is not yet live**."_ `spec.md:607` lists Q-002 as _"defaults to ungated until 010"_. There is **no FR in 011 for a quota** — FR-001..005, FR-006..013, FR-027..030 contain none.
- **The inherited quota is real but keys on the channel literal.** `.../imports/quota/import-quota.policy.ts:67-70` — `DEFAULT_IMPORT_ALLOWANCE = { dailyImports: 200, dailyOcrImports: 50 }`, and only the `'ocr'` channel consults the sub-allowance (`imports.service.ts:246`). It is enforced in **recipe-service**, which is the service ADR-0019 moves the image branch _out of_.
- **The burst limit is not durable.** `@nestjs/throttler` with no custom `ThrottlerStorage` is an in-process `Map`; the repo's own quota docstring says so (`import-quota.policy.ts:9-12`: _"its counter lives in a per-process in-memory store that resets on every deploy and **diverges across Fargate tasks**"_). The photo default is `photoLimit = throttleLimitFromEnv('RATE_LIMIT_PHOTO_UPLOAD', 10)` (`throttle.config.ts:60`) — **10/min**, versus D-006's documented **5/min for photo** (`specs/004-recipe-importing/spec.md:712-719`). Effective rate = limit × task count.
- **The budget alerts; it does not stop.** `packages/infra/global/lib/platform/cost-guardrails-stack.ts:36` `MONTHLY_BUDGET_USD = 300`, implemented as `budgets.CfnBudget` with notification subscribers (`:129-160`) plus a `CfnAnomalySubscription` at a ≥$20 impact threshold (`:172-184`). There are **no `budgetActions`** — no IAM deny, no stop. Cost Anomaly Detection is a daily-batch service.
- **Food's own admission control does not bound a user below 90% saturation.** `AdmissionService.admit` (`packages/services/food-service/src/foods/admission.service.ts:63-75`) checks a **global** `FOOD_MAX_QUEUE_DEPTH` (default 10,000) and only consults `pendingCountForRequester` once depth ≥ 90% of it. A single user can enqueue ~9,000 food fetches before any per-user shed engages.

**The arithmetic.** Measured 37 s per in-budget adversarial image. At 1769 MB (1 vCPU) that is 65.5 GB-s ⇒ **≈ $0.0011/image** at $0.0000166667/GB-s (Lambda cost is roughly memory-invariant for CPU-bound work, so a smaller function costs about the same and takes longer). Textract `DetectDocumentText` at $1.50/1,000 pages is **$0.0015/page** — the same order, so **this finding is provider-independent**.

| Scenario                                            | Images/day | Cost/day | Cost/month |
| --------------------------------------------------- | ---------: | -------: | ---------: |
| One account, 011 ungated, at the implemented 10/min |     14,400 |    $15.8 |   **$475** |
| Same, at D-006's documented 5/min                   |      7,200 |     $7.9 |       $237 |
| Same, ×2 Fargate tasks (in-memory throttler)        |     28,800 |    $31.7 |   **$950** |
| Quota enforced (50/day OCR), **182 free accounts**  |      9,100 |    $10.0 |   **$300** |

The last row is the one that matters: the per-user quota is correct and does **not** bound account spend, because account creation is free and unlimited. The Lambda free tier (400,000 GB-s/month) absorbs only ~6,100 such images.

**Severity.** Now: **LOW** (no endpoint). At launch: **HIGH** — this is the single cheapest way to take the platform down, and it takes the budget with it. It is an availability _and_ billing attack.

**Control required, smallest first.**

1. **Do not ship the image channel ungated.** Resolve Q-002 before the channel is reachable; the premium gate (`channelRequiresPremium`, `import-channel-access.ts:71-73`) already exists and already yields `true` for `ocr` — it just has to be enforced wherever the branch lands.
2. **Move the quota to a durable store** and enforce it in the service that owns the image branch, not only in recipe-service.
3. **Add an account-level circuit breaker** that per-user quotas cannot substitute for: a CloudWatch metric-math alarm on aggregate OCR invocations/GB-seconds per hour that trips a kill switch (SSM flag read at enqueue), plus AWS Budgets **Actions** on the $300 budget so it applies an IAM deny rather than only emailing.
4. **Gate the channel on account age / verified email**, so a burn attack costs the attacker more than a signup.

**Verified how.** All repo claims read directly at the cited lines. Per-image cost derived from my own S-2 measurement; unit prices from AWS pricing (see Sources). No AWS bill was inspected.

---

## S-4 — No Lambda in this account has reserved or maximum concurrency, so an OCR flood starves user provisioning and GDPR deletion

**Surface.** The account-wide Lambda concurrency pool (default 1,000), shared by the OCR fleet and the identity-critical Lambdas.

**Attack scenario.** The cost attack in S-3, run through an SQS-triggered OCR Lambda, scales out to the account concurrency limit. Every other Lambda in the account is then throttled: the Clerk webhook (`identityWebhook.ts` — user provisioning), the deletion worker (GDPR erasure), reconciliation, and the log forwarder that feeds Sentry. The attacker does not need to touch identity at all; user sign-up simply stops, and the alerting that would tell you also stops.

**Evidence.** `grep -rn "reservedConcurrent|reservedConcurrency" --include="*.ts" packages` → **zero matches** repo-wide. 011 asks for it without a number: `specs/011-recipe-digitization/v-model/architecture-design.md:157` — _"SQS fan-out to Lambda with **reserved concurrency**"_, and the only related constraint is a _relation_, `MOD-090 dbPoolMax × maxLambdaConcurrency ≤ RDS max_connections − reserved` (`module-design.md:4759`). `HAZ-012` (`hazard-analysis.md:107`) rates the connection-storm variant **Critical/Occasional**; there is no hazard entry for starving sibling functions.

**Severity.** Now: **INFO** (no OCR Lambda exists). At launch: **HIGH** — this is a cross-service availability failure with an auth-critical blast radius, and it is one CDK property to fix.

**Control required.** Set `reservedConcurrentExecutions` on the OCR function to a number derived from the RDS pool relation _and_ the cost ceiling; independently set a floor for the identity-critical functions by reserving concurrency for them too (reserving on the webhook/deletion-worker is what actually guarantees them capacity — capping OCR alone does not). Add a synth test asserting every Lambda in the account declares one.

**Verified how.** Exhaustive grep of the repo; spec lines read directly. The 1,000 default is AWS's documented account default, not read from this account.

---

## S-5 — Tesseract.js downloads its language model from a public CDN at runtime with no integrity check, and silently re-downloads it on every Lambda invocation

**Surface.** Runtime supply chain and cold-start availability for the OCR worker.

**Attack scenario.** The recognition model is fetched at worker init from a third-party CDN over the public internet. There is no hash, no signature, no SRI. A CDN compromise, a registry-account compromise of `@tesseract.js-data/*`, or a DNS/TLS interception in the egress path yields **attacker-controlled model weights** that silently mistranslate every user's recipe — a low-observability integrity attack, since wrong OCR output looks like ordinary OCR error. Independently, a CDN outage takes OCR down entirely.

**Evidence — read from `tesseract.js@7.0.0` source:**

- `node_modules/tesseract.js/src/worker-script/index.js:130` — _"If `langPath` if not explicitly set by the user, the jsdelivr CDN is used"_ → `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0[_best_int]`.
- `:139-146` — plain `fetch`; the only check is `resp.ok`. `:159-163` — the response is gunzipped on a magic-byte sniff and written straight into the WASM FS at `:176`. **No integrity verification anywhere in the path.**
- `:112` / `:181` — the on-disk cache is `${cachePath || '.'}/${lang}.traineddata`, i.e. **the process CWD**. On Lambda that is `/var/task`, which is read-only. The write is wrapped in `try/catch` that only **logs** (`:182-187`), so the failure is silent and every worker init re-downloads.

Measured: the cold start fetched **`eng.traineddata`, 5,199,098 bytes**, in 280 ms on a warm home connection. On a per-invocation Lambda with the default `cachePath`, that is ~5 MB of egress and added latency **per image**, plus a hard dependency on jsdelivr for every OCR call. (The WASM core itself is _not_ a network dependency in Node — `worker-script/node/getCore.js` `require`s `tesseract.js-core`, ~44 MB of local binaries.)

**Severity.** Now: **INFO** (not adopted). At launch: **MEDIUM** for integrity, **MEDIUM** for availability — and it is trivially closed.

**Control required.** Ship `eng.traineddata` **inside the deployment artifact** and set `langPath` to that local directory (`worker-script/index.js:148-152` supports a local path), plus `cachePath: '/tmp'` and `cacheMethod: 'none'`. Pin and checksum the model file in the repo the way a binary asset should be. Add a network-egress test asserting the worker makes **zero** outbound requests at init. If the model must ever be fetched, verify a pinned SHA-256 before it reaches the WASM FS.

**Verified how.** Source read from the installed package (line numbers above are from `tesseract.js@7.0.0`); cold-start size and timing measured locally. The read-only-`/var/task` consequence is reasoned from Lambda's documented filesystem, not executed on Lambda.

---

## S-6 — Adopting `tesseract.js` adds a network-touching postinstall script to CI jobs that hold production deploy credentials, plus four unmaintained transitive dependencies

**Surface.** Build-time supply chain.

**Attack scenario.** `npm ci` executes lifecycle scripts by default. A compromise of any package in the new subtree — most cheaply `opencollective-postinstall`, last published 2022 — executes with the job's full privileges. Several of this repo's `npm ci` invocations are in jobs that assume AWS deploy roles via OIDC (`.github/workflows/prod-deploy.yml:161`, `:733`).

**Evidence.**

- `tesseract.js@7.0.0` declares `"postinstall": "opencollective-postinstall || true"` (read from the installed `package.json`).
- `.npmrc` contains only `engine-strict=true` — **no `ignore-scripts`**. All 16 `npm ci` call sites across `.github/workflows/*.yml` run unflagged.
- Staleness of the new subtree (from `npm view <pkg> time.modified`): `bmp-js` 2022-06-13, `opencollective-postinstall` 2022-06-22, `zlibjs` 2022-06-29, `is-url` 2023-04-08, `node-fetch@2` 2023-11-30. Thirteen packages added in total.
- To be fair: `npm audit --omit=dev` on the isolated tesseract tree reports **`found 0 vulnerabilities`** today. The risk is unmaintained code plus an install-time execution primitive, not a current CVE.

**Severity.** Now: **INFO** (not adopted). At launch: **MEDIUM**. Note this compounds with `08-security.md` F-SEC3/F-SEC9's root cause — there is still no `npm audit` gate in `_ci.yml`.

**Control required.** If `tesseract.js` is adopted: add `ignore-scripts=true` to `.npmrc` (and an explicit allowlist for `sharp`'s legitimate install step), or pin the postinstall away with an `overrides` entry. Independently, land the `npm audit --omit=dev --audit-level=high` CI gate that F-SEC3 already asked for, so the next stale-subtree advisory fails the build.

**Verified how.** Installed the package tree in an isolated scratch directory with `--ignore-scripts`; read `package.json` scripts and queried publish times from the registry; grepped `.npmrc` and every workflow.

---

## S-7 — Tesseract.js decodes BMP in JavaScript, in-process, via an unmaintained decoder that allocates from unvalidated header dimensions

**Surface.** The one image format Tesseract.js handles **outside** WASM, on the Node heap.

**Attack scenario.** Upload bytes beginning `BM`. `setImage` routes them to `bmp-js` — a pure-JS decoder — _before_ any WASM sandbox is involved, and `parseRGBA` allocates `width * height * 4` from header fields it never checks against the buffer length.

**Evidence.** `node_modules/tesseract.js/src/worker-script/utils/setImage.js:13-27` — the branch is chosen on the two magic bytes alone, then `bmp.decode(buf)`. `node_modules/bmp-js/lib/decoder.js:22-27` reads `width`/`height` straight from the header; `:75-79` does `var len = this.width * this.height * 4; this.data = new Buffer(len);` with no validation.

**Measured, honestly — this is weaker than it looks.** Crafting 60-byte BMPs declaring up to 65535×65535 and decoding under `/usr/bin/time`:

```
{"declared":"65535x65535","threw":"RangeError","msg":"The value of \"offset\" is out of range..."}   peakRSS=47MB
```

The huge `Buffer` is allocated but the pages are never touched (calloc is lazy), and the pixel read throws immediately, so peak RSS stayed flat at ~47 MB across every size. **This is not a memory bomb.** The realistic amplification is the 1-bpp path (`decoder.js:82-105`: one input byte → eight pixels → 32 output bytes, ≈32×), which at a 10 MB cap tops out around 320 MB — material but not decisive. The genuine residual is that an unmaintained 2022 JS decoder parses attacker bytes in-process, and its failure mode is an uncaught `RangeError`.

**Severity.** Now: **INFO**. At launch: **LOW** — listed because it compounds with S-1: if the re-encode control is dropped, this is a decoder nobody chose, reached by two magic bytes.

**Control required.** Free, if S-1's control is in place: after re-encoding to JPEG, `bmp-js` is unreachable. Additionally keep BMP out of the media-type allowlist — `ocr-budget.config.ts:95` already omits it.

**Verified how.** Source read; allocation behaviour measured locally with crafted headers under `/usr/bin/time` (output quoted). I set out to prove a decompression bomb here and could not — reported as it measured.

---

## S-8 — The image allowlist admits HEIC, which the installed toolchain cannot decode; the workaround that gets written is "pass the original bytes through"

**Surface.** Format support versus the allowlist, and the shape of the fallback that a failed decode invites.

**Attack scenario.** Not a direct exploit — a control-erosion path. 011 FR-001 (`spec.md:186`) and `module-design.md:794` admit `image/heic`; `ocr-budget.config.ts:95` admits `image/heic` and `image/heif` with the comment that HEIC is _"the single most common real-world photo format"_. When iPhone uploads fail at the preprocessing step, the pressure is to add a bypass — and the cheapest bypass is to send the original bytes to the provider, which deletes S-1's control for the single most common upload.

**Evidence — measured on the repo's installed `sharp@0.34.5`:**

```
{"heif":"1.20.2","aom":"3.13.1",...}   sharp.format.heif.input.fileSuffix: [".avif"]
de265 present: false | x265 present: false
```

libheif is present but built with the **AOM (AV1)** codec only. Classic iPhone HEIC is **HEVC**-coded, and no HEVC decoder is compiled in — libvips advertises only `.avif`. The 004 code already knows: `ocr-image.ts:155-159` — _"a container whose codec is not compiled into our libvips (**HEIC/HEVC on the current build** — see `__tests__/ocr/ocr-image.test.ts`)"_ → typed `415`. 011's hazard analysis rates the user-facing half `HAZ-007` (`hazard-analysis.md:92`, Serious/Occasional) but frames it as a _"false rejection … due to MIME sniff mismatch"_, which misdiagnoses the cause as sniffing rather than a missing codec.

**Severity.** Now: **INFO**. At launch: **MEDIUM** — a product-blocking bug whose likely fix is a security regression.

**Control required.** Decide the HEIC story **before** the channel ships, and write the decision down: either (a) build/ship a libheif with an HEVC decoder and keep the re-encode, or (b) drop HEIC from the allowlist and convert on-device (both iOS and Android can export JPEG at the picker), or (c) accept HEIC and transcode through a dedicated, sandboxed step. Whichever is chosen, add a test asserting the OCR adapter's input type is the _preprocessed_ type, so option (d) — "pass it through" — will not compile.

**Verified how.** Read `sharp.versions` and `sharp.format.heif` from the repo's installed binary; quoted the 004 code comment. I did not obtain a real HEVC-HEIC file to fail the pipeline with.

---

## S-9 — A device-declared raw-text channel inverts FR-025 and bypasses both the premium gate and the OCR sub-quota, because every provenance and entitlement decision keys on the server-observed channel

**Surface.** A new channel where the _client_ has done the extraction and the server has no channel to observe.

**Attack scenario.** Mobile does on-device OCR and posts text. The server cannot see a photograph, so it must take the caller's word that the content came from one. That single inversion cascades:

1. **Provenance.** Every `sourceType` today is a **compile-time literal chosen by the endpoint** — `imports.controller.ts:89-92` hardcodes `'url'` in the method body, and `imports.service.ts:299-302` does `classifyProvenance({ channel: 'url' })`, persisting the result at `:314-317`. **No request DTO has a `sourceType` field** (the full `dto/import-requests.dto.ts` has `url`, draft-correction fields, `attestedExternal`, `sourceCitation` — nothing else). A text endpoint has no channel to derive from.
2. **Which is exactly what FR-025 forbids.** `specs/004-recipe-importing/spec.md:294-298`: _"A caller MUST NOT be able to declare `imported_public` … or `imported_physical` (which would grant a free-tier caller a private recipe that C-004 reserves for premium). Those classifications are set **only** by the server from the channel it observed."_
3. **The premium gate is derived from provenance and would simply not fire.** `import-channel-access.ts:71-73` — `channelRequiresPremium(channel) = isNonPublicByPolicy(classifyProvenance({channel}).sourceType)`, and `provenance.policy.ts:101-103` makes `imported_physical` non-public. A `text` channel classified `user_created` yields free-tier private recipes; classified `imported_physical` on the caller's say-so, it hands a free caller the premium class.
4. **The OCR sub-quota would not fire either.** `imports.service.ts:246` consults `dailyOcrImports: 50` only for the `'ocr'` channel literal (`import-quota.policy.ts:67-70`). Device-side OCR is the _cheap_ path for us — but it is also the path that pays for none of the gate that D-014 built to _"confine Textract spend to paying users"_ (`spec.md:670-677`).
5. **`11-A8` already found the ADR wording that authorises this** (`11-adversarial-004-011-split.md:361-391`): ADR-0019 `:69-70` says _"`sourceType` is declared by the surface, never inferred from the payload"_, which A-8 verdicts **WEAKENED** because it _"authorises a mass-assignment `FR-025` exists to prevent."_ A raw-text channel is the case where that wording stops being a wording problem and becomes a live bypass.

**And there is no input validation for a text blob, because nothing has ever accepted one.** No max length for a whole-text field (the per-field caps are title 200 / description 5,000 / citation 500, `dto/import-requests.dto.ts:46-57`); `steps` array items carry `.min(1)` and **no `.max()`**; no control-character stripping anywhere in `imports/` (grepped); no `.normalize()` (grepped); UTF-8/charset handling exists only for _fetched HTML_ (`imports/fetch/decode-html.ts`). The one sanitizer, `normalize/content-sanitizer.ts:32-33`, states it _"is NOT safe to re-run"_ — so a text channel must enter the shared normalizer at the right seam or corrupt content.

**Severity.** Now: **LOW** — nothing is specified or built. At launch: **HIGH** — this is a paid-tier bypass and a provenance-integrity failure, and it is far cheaper to prevent at design time than to unwind after `source_type` rows exist.

**Control required.**

1. **Give the text channel its own `ImportChannel` member and its own `sourceType`,** derived server-side from that endpoint like every other channel — never a body field. If the product wants "I photographed this", that is an **attestation** (`attestedExternal` + citation) that fails closed to `imported_paid`, exactly as FR-014a already does; it must not be a claim that unlocks `imported_physical`.
2. **Gate and meter it on its own terms** — its own premium decision and its own sub-quota — rather than inheriting `ocr`'s, which measures a cost it does not incur.
3. **Parse the blob at the boundary**: total byte cap, per-line and line-count caps, reject unpaired surrogates / `U+0000` / C0 control characters except `\n`/`\t`, NFC-normalise once.
4. Adopt `11-A8`'s rewording in ADR-0019 §2 first — _the surface declares the **channel**; the server derives `sourceType` from the channel it served; the **format** is determined by content inspection_ — because the current sentence is what a raw-text channel would cite as authorisation.

**Verified how.** All controller/service/policy/DTO lines read directly in the 004 worktree; FR-025/FR-028/D-014 and the `11-A8` verdict quoted from source. Absence of a raw-text channel established by exhaustive grep across 004, 011, the ADRs and the PR-91 reviews.

---

## S-10 — The substrate's producer-authentication design is sound on paper and has no credential to implement it with; and once authenticated, any producer can address any user

**Surface.** The status-message bus (ADR-0019 §4; 014's SQS FIFO + EventBridge ingress).

**Attack scenario.** Three, in descending order of how much I believe them:

1. **Any principal with bus access addresses any user.** Once a producer authenticates, nothing scopes _whom_ it may notify. 014 records this as granted-by-registration: `specs/014-notification-service/spec.md:830` — _"the registry is where a producer's quota and its **authority to address any user** are declared"_ — and `spec.md:683`'s `ProducerRegistryEntry` has no allowed-recipient field. A compromised or buggy producer (or an over-broad IAM grant) can push a `global` broadcast or impersonate a system message into any user's feed. 014's own `HAZ-035` (`v-model/hazard-analysis.md:273`) rates this **Catastrophic**, status **⬜ Untested**.
2. **`occurredAt` is producer-assigned with no clock discipline and no age bound.** `plan.md:606-618` makes it REQUIRED and producer-set, and it is _"the FIFO ordering key (FR-029)"_. Grepping 014 for `skew|replay|maxAge|too old` returns only unresolved acknowledgements (`v-model/peer-review-hazard-analysis.md:60` — _"`occurredAt` is producer-assigned and producers do not share a clock"_). A producer can backdate or future-date to reposition itself in another producer's ordering, and nothing rejects an ancient replayed envelope.
3. **ADR-0019's supersession key does not exist in the envelope it delegates to.** ADR-0019 `:108` requires supersession _"decided by a monotonic sequence carried in the envelope"_. 014's `sequence` is assigned by the **consumer at dequeue** (`plan.md:151`) and is a per-_user_ ordering score (`plan.md:161`); the envelope has **no `entityId` and no supersession key**, and 014 forbids itself from inspecting `payload` (`plan.md:651`, FR-023). So the per-entity latest-wins guarantee has no mechanism today. `12-A1` reached this from the design side; the security consequence is that "latest wins" would fall back to arrival order, and on an at-least-once bus a redelivery silently reverts `succeeded` → `processing`.

**What the design gets right, and I want it on the record.** 014 does **not** trust the self-declared producer field. `plan.md:575-578` requires a **dual signal** — transport identity (Ed25519 service-principal token principal, or EventBridge `source` + bus resource policy) resolved through a version-controlled registry to a name, which **MUST equal** the envelope's `producer`, _"mismatch rejects"_ — with injectivity asserted at boot as a security property (`spec.md:567`). `FR-027` (`spec.md:406-411`) states plainly that without both controls _"the event path is an unauthenticated publish channel."_ That is the correct model.

**But there is nothing to build it with, and nothing built.**

- `13-A9` already established there is no machine-to-machine credential (`food-service-clients.factory.ts:6-13`, `:68-71` _"There is deliberately no fallback credential"_; `config.types.ts:405-407` _"There is deliberately NO `FOOD_SERVICE_TOKEN`"_). I confirm both.
- Implementation status: `packages/services/` has no `notification-service`; `packages/schemas/` has `food, identity, recipe` only; `specs/014-notification-service/tasks.md` has **75 unchecked / 1 checked**, and the one checked is a docs task.
- The one bus that exists has **no resource policy at all**: `packages/services/food-service/infra/lib/food-service-stack.ts:266` creates `FoodEventBus` with identity-based grants only (`:366`, `:431`, `:492`). Repo-wide, `addToResourcePolicy|CfnEventBusPolicy|CfnQueuePolicy` in non-test source appears exactly once, on the cost-alerts topic (`cost-guardrails-stack.ts:82`). So FR-027's control (a) does not exist for the only bus we have.
- Food does not actually publish: `food-event-emitter.ts:212-214` is `ConsoleEventBus`, wired at `worker/main.ts:16,64`; **zero** repo-wide use of `@aws-sdk/client-eventbridge`. ⚠️ 014's research asserts the opposite — `research/codebase-analysis.md:98` claims _"003 publishes `FoodFetchCompleted` to EventBridge against a deployed rule"_ — and a Q-004 decision was closed partly on that claim. It is false in both halves (`food-service-stack.ts:264`: _"there is deliberately NO rule consumer on the bus right now"_).
- Publishes are fire-and-forget: `food-event-emitter.ts:11-12` — _"a bus failure is logged via the optional error sink and swallowed."_ ADR-0019 `:162` requires an outbox per emitter; none exists.

**Severity.** Now: **INFO** (nothing built). At launch: **HIGH** for #1 (spoofed/broadcast notifications are directly user-visible and indistinguishable from legitimate ones), **MEDIUM** for #2 and #3.

**Control required, in order.**

1. **Decide the service-to-service credential in an ADR before any spine code is written** — as `13-A9` demands. The repo already contains the right model and it is better than what 014 specifies: the Ed25519 erasure token (`packages/shared/recipe-core/src/serviceErasureToken.ts:29-31`) _"bind[s] the capability to a single event: one target `ownerId`, one correlation/event id, a short `exp`, and a fixed issuer + audience."_ Generalise **that**, with its recipient binding intact.
2. **Bind publish authority to a recipient**, not just to a producer name: the envelope's `recipient.id` must be inside the token's authorised scope, and `kind: 'global'` must require a distinct capability nobody holds by default. This is the one place 014's design is materially weaker than code the repo already ships.
3. **Put a resource policy on every bus and queue**, scoped to named principals — starting with the existing `FoodEventBus`, which has none today.
4. **Bound envelope age and reject future-dated `occurredAt`** beyond a small skew, and make the dedup claim window ≥ the age bound so replay is actually refused rather than merely deduped.
5. **Write the status-envelope contract ADR-0019 `:168` promises** (entity id + supersession key + stage vocabulary) before either 004 or 011 emits, or §4's guarantee is unimplementable.
6. Correct `research/codebase-analysis.md:98` and re-open anything decided on it.

**Verified how.** All specs and infra read at the cited lines; implementation absence established by directory listing and exhaustive grep for the AWS SDK client. Nothing was probed on a deployed bus.

---

## S-11 — The shared ownerless catalog has no Unicode discipline, so its dedup key is trivially bypassed and its global display names are attacker-authored — and OCR is the amplifier that makes this a volume problem

**Surface.** `POST /api/v1/foods` → a globally visible, ownerless catalog row named by the caller.

**Attack scenario.** `15-A1` established that the display name is caller-authored and never reconciled. The _security_ consequence it did not reach is that the dedup key has no normalisation beyond case and ASCII whitespace, so an attacker can mint **unlimited rows that render identically to real foods**:

- **Homograph impersonation.** "сhicken breast" with Cyrillic `U+0441` produces a different dedup key and an indistinguishable label. Users pick the attacker's row; its nutrition is whatever the attacker's disambiguation resolves to, for everyone.
- **Zero-width dedup bypass.** `U+200B` is not in JavaScript's `\s` class and is not stripped by `.trim()`, so "chi​cken breast" is a distinct row that renders as "chicken breast".
- **Invisible rows.** A name consisting solely of zero-width characters passes `.min(1)` after `.trim()`.
- **Rendering attacks that output-escaping does not stop.** `U+202E` (RTL override) and ANSI CSI sequences are accepted verbatim into a string shown in typeahead and written to logs. React escaping is the wrong control for both.
- **A NUL byte reaches a PostgreSQL `text` parameter**, which PostgreSQL cannot store — the same "500 that owed a 400" class as `08-security.md` F-SEC6/F-SEC7.

**Evidence — measured against the installed `zod@4.4.3` and the repo's own `normalizeName`:**

The validator is `addFoodRequestSchema.name = z.string().max(MAX_FOOD_NAME_LENGTH).trim().min(1)` (`packages/services/food-service/src/foods/foods.schema.ts:254`, `:34`). The dedup key is `normalizeName` (`packages/services/food-service/src/foods/merge/merge-engine.ts:130-132`) — `name.trim().replace(/\s+/g, ' ').toLowerCase()`, used at `foods.service.ts:208`.

```
zwsp only              "​​"                     ← accepted
rtl override           "chicken ‮breast"             ← accepted
newline+tab            "chick\nen\tbreast"                ← accepted
null byte              "chicken\u0000 breast"             ← accepted
ansi escape            "\u001b[31mchicken\u001b[0m"       ← accepted
cyrillic homograph     "сhicken breast"              ← accepted
200 astral chars                                          ← REJECTED (max counts UTF-16 units)

normalizeName dedup keys
"chicken breast"    => "chicken breast"
"сhicken breast"    => "сhicken breast"     ← distinct row
"chi​cken breast"    => "chi​cken breast"     ← distinct row
"ｃhicken breast"    => "ｃhicken breast"     ← distinct row
"CHICKEN  BREAST"   => "chicken breast"     ← correctly deduped
```

**Why OCR makes this new rather than pre-existing.** Today a name is typed by a human, one at a time. An import channel submits **machine-extracted ingredient strings in bulk, unreviewed** — and OCR output is _exactly_ where confusables, stray control characters and mojibake come from naturally, before any attacker gets involved. Volume is unbounded: `AdmissionService.admit` (`admission.service.ts:63-75`) applies no per-user limit until the **global** queue reaches 90% of `FOOD_MAX_QUEUE_DEPTH` (10,000), so one user can create thousands of rows; and `12-A8` establishes that **shells are never deleted**. Every one of those rows is also a candidate USDA fetch against a 1,000/hour key quota (the same scarce budget `08-security.md` F-SEC2 drains).

**Severity.** Now: **LOW** (verified reachable today via `POST /api/v1/foods`, but the catalog has no real users). At launch: **MEDIUM**, rising to **HIGH** the moment an import channel writes to it in bulk — impersonation of a real food is a nutrition-integrity attack on every user, and it is not correctable through the API (`patchResolve` is an idempotent no-op once `RESOLVED`, `foods.service.ts:325-327`).

**Control required, smallest first.**

1. **Normalise before keying**: `.normalize('NFKC')`, strip default-ignorable code points (`\p{Default_Ignorable_Code_Point}`), strip C0/C1 controls, collapse all Unicode whitespace — then lowercase. This alone collapses the ZWSP, fullwidth and invisible-name cases into the existing dedup.
2. **Reject at the boundary** what normalisation should not silently fix: mixed-script names (Unicode TR-39 confusable/restriction-level check), unpaired surrogates, `U+0000`, and bidi overrides. Fail closed with a typed `400`.
3. **Do not let an import channel author a global display name.** The pick path already refuses this and says why — `ingredients.service.ts:258-262`: _"Accepting a caller-supplied name would let any authenticated client attach an arbitrary label to a real food in a catalog that is ownerless and shared by every user — mislabeled nutrition for everyone."_ Apply the same rule to bulk add-by-name: hold the caller's string as a **per-recipe line label** (`recipe_ingredients.ingredient_name` already exists, `schema/ingredients.ts:97-127`) and only promote a name to the shared catalog once a source has resolved it.
4. **Per-user creation quota on the catalog**, independent of the global queue-depth shed.

**Verified how.** Empirically, locally: ran the installed `zod@4.4.3` against the real `addFoodRequestSchema` shape and the real `normalizeName` implementation; outputs quoted verbatim. The PostgreSQL NUL-byte rejection is **reasoned from PostgreSQL semantics, not executed** (no local database available) — same limitation as F-SEC6/F-SEC7.

---

## S-12 — Upload preflight validates the client's claims about bytes the server has never seen, and the S3 key is derived from the wrong identifier

**Surface.** The presigned-PUT upload path for images.

**Attack scenario.** Two, both modest but cheap to close.

1. **Preflight is theatre if the read-time check is ever skipped.** `module-design.md:780-796` — `validateImagePreflight(meta)` checks `meta.mime`, `meta.byte_size`, `meta.width/height` and a 64-char `checksum_sha256`. Every one of those is a **client-supplied claim**; the bytes do not exist yet. 011's plan says so itself (`plan.md:349-352`): _"**Pre-signed upload URLs do not validate content.** A pre-signed `PUT` … bypasses our service entirely, so the object's real type and size are not established by the request that minted the URL."_ The risk is that `PREFLIGHT_MIME`/`PREFLIGHT_SIZE`/`PREFLIGHT_DIMENSIONS` error codes and their acceptance tests (`acceptance-plan.md:22-39`, `:90-106`) _look_ like validation coverage, so the read-time check becomes the thing nobody notices is missing. Note the declared `checksum_sha256` is never verified against the object — it is length-checked only.
2. **The S3 prefix uses the raw Clerk `sub`, not the app-user ULID.** `module-design.md:631` — `userId = req.user.sub` — and `:637` — `key = users/${userId}/jobs/${jobId}/original.${ext(item.mime)}`. This repo has an explicit rule against exactly that: food's `resolveRequesterId` refuses to fall back to `sub` (`authenticated-principal.ts:52-73`), and the 004 code derives every object key by appending to `ownerMediaPrefix` precisely so erasure can find it — `ocr-object-key.ts:4-19`: _"every per-object key is built by appending to `ownerMediaPrefix`, so it necessarily begins with the prefix a right-to-erasure sweep lists … a second addressing root at the bucket level would recreate the `verticals-8` defect on the worst possible payload."_ A `users/{clerk_sub}/…` root **is** that second addressing root, on photographs of people's handwriting. `HAZ-024` (`hazard-analysis.md:149`) rates a discard-that-fails-to-delete Critical; this would make the sweep miss by construction.

**On `HAZ-004`** (`hazard-analysis.md:84`, cross-user upload, Catastrophic, _"accepted on basis that S3 server-side prefix is enforced and audited"_): the stated rationale is wrong — S3 does not enforce a prefix on a presigned PUT — but the **real** control is stronger than the rationale claims, because SigV4 signs the object key, so a presigned URL cannot be redirected to another key. The residual is only "a leaked URL can write its own key for ≤15 min", bounded further by the signed `content-type`/`content-length` (`module-design.md:699-710`). I am recording this as a **mis-stated mitigation, not a vulnerability** — but a hazard accepted on a false premise should be re-accepted on the true one.

**Severity.** Now: **INFO** (spec only). At launch: **MEDIUM** for the key derivation (a GDPR-erasure miss on image data — see `dpo-1`), **LOW** for the preflight framing.

**Control required.** (a) Key on the **app-user ULID** via the existing `ownerMediaPrefix` derivation, and add a test asserting no object key is built from `req.user.sub`. (b) Rewrite `validateImagePreflight`'s docstring to say it is a **UX fast-fail on client claims**, and make the read-time `preprocessForOcr` the named authority; add a test that a preflight-passing object with mismatched real bytes is still rejected at read. (c) Verify the declared `checksum_sha256` against the stored object, or drop the field rather than imply it is checked. (d) Re-accept `HAZ-004` with the SigV4 rationale.

**Verified how.** Spec lines read directly; the 004 key-derivation code read in the worktree. The SigV4 key-binding property is reasoned from AWS's documented canonical request, not tested.

---

## Controls that must exist before web image upload ships

Ordered by what I would refuse to ship without. Items 1–4 are gates; 5–8 are strongly required.

1. **The OCR provider is only ever handed re-encoded bytes.** Port `preprocessForOcr` (byte bound → magic-byte type → header-parsed pixel bound → re-encode to one canonical format) into whichever service owns the image branch, and make it a **type-level** obligation so a "pass the original through" fallback cannot compile. Delete `spec.md:352`. Give 011 a megapixel cap and one byte cap. **[S-1, S-7, S-8]**
2. **A hard per-image compute bound**, enforced by terminating the worker, plus a platform timeout below it — and `preprocessMaxEdgePx` chosen from a measured compute budget, not a legibility one. Measured today: 37 s at 3000 px for an input that passes every existing bound. **[S-2]**
3. **The channel is not ungated.** Resolve Q-002 before the endpoint is reachable; enforce the premium gate and a **durable** OCR sub-quota in the service that owns the branch. **[S-3]**
4. **An account-level spend circuit breaker that a per-user quota cannot substitute for**: an aggregate invocation/GB-second alarm wired to a kill switch, AWS Budgets **Actions** on the $300 budget, and channel gating on account age or verified email. **[S-3]**
5. **`reservedConcurrentExecutions` on the OCR function, and reserved floors for the identity-critical Lambdas**, so an OCR flood cannot starve user provisioning, GDPR deletion or the Sentry drain. **[S-4]**
6. **No runtime model download.** Ship `eng.traineddata` in the artifact, set `langPath` local and `cachePath: '/tmp'`, and assert zero egress at worker init. If it is ever fetched, verify a pinned hash. **[S-5]**
7. **`ignore-scripts` in `.npmrc` (with an explicit exception for `sharp`) plus the `npm audit --audit-level=high` CI gate F-SEC3 already asked for**, before `tesseract.js` and its thirteen packages enter the lockfile. **[S-6]**
8. **Unicode normalisation and a mixed-script/confusable check on every string that becomes a shared catalog name**, and no bulk import channel authoring global display names — hold the caller's string as a per-recipe line label instead. **[S-11]**
9. **Object keys derived from the app-user ULID via `ownerMediaPrefix`**, never `req.user.sub`. **[S-12]**

Not a gate for image upload, but a gate for the spine: **the service-to-service credential ADR must land before any spine code is written**, and it must carry the erasure token's recipient binding rather than 014's "any registered producer may address any user". **[S-10]**

---

## Not examined

Stated so nothing here reads as coverage I did not have.

- **Anything already covered by `08-security.md`** — the `sharp`/libvips CVEs, `candidateIds`, the load-shedder key leak, `z.url()`, the collections/versions param pipes. I re-confirmed the two `food-service-clients.factory.ts` / `config.types.ts` claims and nothing else.
- **The actual 2026-08-14 decision records for Tesseract.js and the raw-text channel.** They are not in the repository (see Premise reconciliation). Everything in S-1/S-2/S-5/S-6/S-7/S-9 about them is prospective analysis of the briefed design plus measurement of the real library — **not** a review of a written design I could read.
- **CVE reproduction.** None. `npm audit` on the isolated tesseract tree reports zero vulnerabilities today; I did not fuzz leptonica-WASM, libvips, or `bmp-js` beyond the header cases quoted.
- **Live-system verification of anything.** No AWS account, bucket policy, IAM state, task definition, SSM value, Clerk setting or bill was inspected. S-3's cost table is arithmetic over a local measurement and public unit prices.
- **The PostgreSQL NUL-byte step in S-11**, and by extension whether it produces a 500 or a caught error. No local PostgreSQL/Docker.
- **HEVC-HEIC decode failure** was inferred from `sharp.versions` and `sharp.format.heif.input.fileSuffix`; I had no real HEVC-HEIC sample to fail the pipeline with.
- **Tesseract accuracy/confidence handling** (`ocr-text.ts`, `minLineConfidence`, `reviewConfidenceThreshold`) — a correctness and product surface, not reviewed here. Adversarial _content_ attacks on OCR output (prompt-injection-shaped text flowing into feature 005's AI path) were **not** examined and deserve their own pass.
- **011's Family Circles half**, the mobile client, `@commise/ui`, and any client-side handling of uploaded images.
- **`recipe-workers`, the food change-refresh consumers, and the Instagram/file channels** in the 004 worktree.
- **Full review of the 004 worktree's SSRF guard, DNS pinning, redirect and robots policies** — `08-security.md` flagged these as unaudited and they remain so; I read only the OCR subtree.

---

**Confidence: Medium-High.**
High on S-2, S-5, S-7 and S-11 (measured locally, outputs quoted) and on S-1, S-3, S-9, S-10, S-12 as _repo claims_ (read at the cited lines, absences established by exhaustive grep).
Medium on the launch-severity calls, which rest on the briefed design rather than a written one, and on S-4/S-8 (mechanism reasoned, not executed).
**Low on the premise itself** — two of four briefed surfaces contradict the committed artifacts. Per the standing rule, low confidence on a security question is a flag to escalate: **confirm the Tesseract-on-Lambda and raw-text decisions in writing before anyone implements against them**, because the controls that exist today were built for the option those decisions replace.

**Suggested follow-ups**: `ssec-1-security-engineer` to implement the S-1/S-2/S-4/S-5/S-6 controls; `staff-architect` for the service-to-service credential ADR that S-10 gates on; `dpo-1` on S-12's key derivation (photographs of handwriting under a prefix the erasure sweep does not list is a personal-data retention failure, not just a bug); `cto-1` or the owner to rule on S-3's Q-002 before the channel is reachable.

**Sources for external pricing** (used only in S-3's arithmetic):
[AWS Lambda pricing 2026 — CloudZero](https://www.cloudzero.com/blog/lambda-pricing/) · [AWS Lambda cost breakdown — Wiz](https://www.wiz.io/academy/cloud-cost/aws-lambda-cost-breakdown) · [Amazon Textract pricing](https://aws.amazon.com/textract/pricing/) · [AWS Textract per-page cost math](https://www.braincuber.com/blog/aws-textract-pricing-what-ocr-actually-costs)
