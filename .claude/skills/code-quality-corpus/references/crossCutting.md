# Cross-cutting taxonomies — naming and grading findings

<!-- GENERATED INDEX (scripts/buildIndex.py) — edit the entries below, then regenerate. -->

## Index — scan this, then open only the entries that apply (`rg -n '^### <ID>' <this file>`)

| ID    | Smell                                                                      | Section                                  | Detected by | Default severity | Architecture |
| ----- | -------------------------------------------------------------------------- | ---------------------------------------- | ----------- | ---------------- | ------------ |
| XC-01 | Mysterious Name                                                            | Fowler & Beck's 24 smells (Refactoring,… | partial     | minor            | no           |
| XC-02 | Duplicated Code                                                            | Fowler & Beck's 24 smells (Refactoring,… | partial     | minor            | yes          |
| XC-03 | Long Function                                                              | Fowler & Beck's 24 smells (Refactoring,… | partial     | minor            | no           |
| XC-04 | Long Parameter List                                                        | Fowler & Beck's 24 smells (Refactoring,… | partial     | minor            | yes          |
| XC-05 | Global Data                                                                | Fowler & Beck's 24 smells (Refactoring,… | partial     | major            | no           |
| XC-06 | Mutable Data                                                               | Fowler & Beck's 24 smells (Refactoring,… | partial     | minor            | no           |
| XC-07 | Divergent Change                                                           | Fowler & Beck's 24 smells (Refactoring,… | judgement   | major            | yes          |
| XC-08 | Shotgun Surgery                                                            | Fowler & Beck's 24 smells (Refactoring,… | judgement   | major            | yes          |
| XC-09 | Feature Envy                                                               | Fowler & Beck's 24 smells (Refactoring,… | judgement   | minor            | no           |
| XC-10 | Data Clumps                                                                | Fowler & Beck's 24 smells (Refactoring,… | judgement   | minor            | no           |
| XC-11 | Primitive Obsession                                                        | Fowler & Beck's 24 smells (Refactoring,… | partial     | major            | yes          |
| XC-12 | Repeated Switches                                                          | Fowler & Beck's 24 smells (Refactoring,… | partial     | minor            | no           |
| XC-13 | Loops                                                                      | Fowler & Beck's 24 smells (Refactoring,… | tool        | minor            | no           |
| XC-14 | Lazy Element                                                               | Fowler & Beck's 24 smells (Refactoring,… | judgement   | minor            | no           |
| XC-15 | Speculative Generality                                                     | Fowler & Beck's 24 smells (Refactoring,… | partial     | minor            | no           |
| XC-16 | Temporary Field                                                            | Fowler & Beck's 24 smells (Refactoring,… | partial     | minor            | no           |
| XC-17 | Message Chains                                                             | Fowler & Beck's 24 smells (Refactoring,… | judgement   | minor            | no           |
| XC-18 | Middle Man                                                                 | Fowler & Beck's 24 smells (Refactoring,… | judgement   | minor            | no           |
| XC-19 | Insider Trading                                                            | Fowler & Beck's 24 smells (Refactoring,… | partial     | major            | yes          |
| XC-20 | Large Class                                                                | Fowler & Beck's 24 smells (Refactoring,… | partial     | major            | yes          |
| XC-21 | Alternative Classes with Different Interfaces                              | Fowler & Beck's 24 smells (Refactoring,… | judgement   | minor            | no           |
| XC-22 | Data Class                                                                 | Fowler & Beck's 24 smells (Refactoring,… | judgement   | minor            | no           |
| XC-23 | Refused Bequest                                                            | Fowler & Beck's 24 smells (Refactoring,… | partial     | minor            | no           |
| XC-24 | Comments (as deodorant)                                                    | Fowler & Beck's 24 smells (Refactoring,… | partial     | minor            | no           |
| XC-25 | Conditional Complexity                                                     | Kerievsky additions (Refactoring to Pat… | partial     | major            | no           |
| XC-26 | Indecent Exposure                                                          | Kerievsky additions (Refactoring to Pat… | partial     | minor            | yes          |
| XC-27 | Solution Sprawl                                                            | Kerievsky additions (Refactoring to Pat… | judgement   | major            | no           |
| XC-28 | Combinatorial Explosion                                                    | Kerievsky additions (Refactoring to Pat… | partial     | major            | no           |
| XC-29 | Oddball Solution                                                           | Kerievsky additions (Refactoring to Pat… | partial     | minor            | no           |
| XC-30 | Brain Method                                                               | Metric-based strategies beyond Fowler    | partial     | major            | no           |
| XC-31 | Intensive Coupling / Dispersed Coupling                                    | Metric-based strategies beyond Fowler    | judgement   | minor            | yes          |
| XC-32 | Tradition Breaker                                                          | Metric-based strategies beyond Fowler    | judgement   | minor            | no           |
| XC-33 | Cognitive vs cyclomatic complexity — using the right one                   | Metric-based strategies beyond Fowler    | tool        | ?                | no           |
| XC-34 | Metric gaming and aggregate-index misuse (MI, TDR, coverage %)             | Metric-based strategies beyond Fowler    | judgement   | minor            | no           |
| XC-35 | The Blob                                                                   | Architecture & process anti-patterns     | tool        | major            | yes          |
| XC-36 | Lava Flow                                                                  | Architecture & process anti-patterns     | partial     | minor            | no           |
| XC-37 | Poltergeists                                                               | Architecture & process anti-patterns     | judgement   | minor            | no           |
| XC-38 | Golden Hammer                                                              | Architecture & process anti-patterns     | judgement   | major            | yes          |
| XC-39 | Boat Anchor                                                                | Architecture & process anti-patterns     | partial     | minor            | no           |
| XC-40 | Dead End (modified third-party component)                                  | Architecture & process anti-patterns     | partial     | major            | no           |
| XC-41 | Spaghetti Code                                                             | Architecture & process anti-patterns     | partial     | major            | yes          |
| XC-42 | Cut-and-Paste Programming / Swiss Army Knife                               | Architecture & process anti-patterns     | tool        | major            | no           |
| XC-43 | Big Ball of Mud                                                            | Architecture & process anti-patterns     | partial     | major            | yes          |
| XC-44 | Distributed monolith / system-scale Shotgun Surgery                        | Architecture & process anti-patterns     | judgement   | major            | yes          |
| XC-45 | Strong connascence across a boundary (Meaning, Position, Algorithm)        | Connascence as a grading tool            | partial     | major            | yes          |
| XC-46 | Dynamic connascence (Execution, Timing, Value, Identity)                   | Connascence as a grading tool            | judgement   | major            | no           |
| XC-47 | Assertion Roulette                                                         | Test smells, mocking and test-effective… | partial     | minor            | no           |
| XC-48 | Eager Test / General Fixture / Obscure Test                                | Test smells, mocking and test-effective… | tool        | minor            | no           |
| XC-49 | Mystery Guest / Resource Optimism                                          | Test smells, mocking and test-effective… | tool        | minor            | no           |
| XC-50 | Conditional Test Logic                                                     | Test smells, mocking and test-effective… | tool        | major            | no           |
| XC-51 | Sleepy Test / Erratic Test                                                 | Test smells, mocking and test-effective… | tool        | major            | no           |
| XC-52 | Empty / Unknown (assertion-free) test, disabled tests, redundant assertion | Test smells, mocking and test-effective… | partial     | major            | no           |
| XC-53 | Sensitive Equality / Magic Number Test / snapshot overuse                  | Test smells, mocking and test-effective… | tool        | minor            | no           |
| XC-54 | Mock overuse / change-detector tests / mocked boundary                     | Test smells, mocking and test-effective… | partial     | major            | no           |
| XC-55 | Coverage theatre — mutation testing as the detector                        | Test smells, mocking and test-effective… | tool        | major            | no           |
| XC-56 | Test Logic in Production / Hard-to-Test Code                               | Test smells, mocking and test-effective… | partial     | major            | no           |
| XC-57 | Commented-out code and stale TODOs                                         | Comment & naming smells                  | tool        | minor            | no           |
| XC-58 | Linguistic anti-patterns (name/type/comment/behaviour disagree)            | Comment & naming smells                  | partial     | minor            | no           |

<!-- END GENERATED INDEX -->

Domain prefix: `XC-`. These entries are language-agnostic vocabulary and grading scales. Every threshold carries
its source; thresholds that could only be found in a secondary source are labelled as such, and book-only
numbers that could not be opened are `UNVERIFIED`.

## Scope & sources consulted

| Source                                                                                                                                         | Version / date                         | URL                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fowler & Beck, _Refactoring_ 2nd ed., ch. 3 "Bad Smells in Code" (24 smells + suggested refactorings with page numbers) — publisher excerpt    | InformIT, 19 Nov 2018; read 2026-09-13 | https://www.informit.com/articles/article.aspx?p=2952392                                                                                                                                                                                                                                           |
| Fowler refactoring catalog                                                                                                                     | read 2026-09-13                        | https://refactoring.com/catalog/                                                                                                                                                                                                                                                                   |
| Industrial Logic "Smells to Refactorings Quick Reference" (Fowler 1st ed. + Kerievsky _Refactoring to Patterns_ smells)                        | © 2005                                 | https://www.industriallogic.com/img/blog/2005/09/smellstorefactorings.pdf                                                                                                                                                                                                                          |
| Lanza & Marinescu, _Object-Oriented Metrics in Practice_ — Springer reading sample (ch. 4 detection-strategy method, God Class worked example) | Springer 2006 excerpt                  | https://beckassets.blob.core.windows.net/product/readingsample/187724/9783540244295_excerpt_001.pdf                                                                                                                                                                                                |
| Secondary: V. Chircu, "How to identify … using NDepend" series (quotes each L&M strategy and the book's Java-statistics thresholds)            | 2016–2017                              | https://simpleorientedarchitecture.com/how-to-identify-common-code-smells-using-ndepend/ (+ linked God Class, Feature Envy, Data Class, Brain Method, efferent coupling, Shotgun Surgery, Refused Parent Bequest, Tradition Breaker posts)                                                         |
| G. Ann Campbell, _Cognitive Complexity — a new way of measuring understandability_ (SonarSource white paper)                                   | v1.7, 29 Aug 2023                      | https://www.sonarsource.com/docs/CognitiveComplexity.pdf                                                                                                                                                                                                                                           |
| McCabe & Watson, NIST SP 500-235 _Structured Testing_                                                                                          | 1996                                   | https://www.mccabe.com/pdf/mccabe-nist235r.pdf                                                                                                                                                                                                                                                     |
| Microsoft Learn — Maintainability index range and meaning                                                                                      | updated 2025-10-30                     | https://learn.microsoft.com/en-us/visualstudio/code-quality/code-metrics-maintainability-index-range-and-meaning                                                                                                                                                                                   |
| eslint-plugin-sonarjs (rule defaults read from package source)                                                                                 | 4.2.0                                  | https://www.npmjs.com/package/eslint-plugin-sonarjs                                                                                                                                                                                                                                                |
| SonarQube Server — Quality gates (Sonar way conditions, fudge factor)                                                                          | docs read 2026-09-13                   | https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates                                                                                                                                                                |
| SonarQube Server — Metrics definitions (technical debt ratio, rating grids)                                                                    | read 2026-09-13                        | https://docs.sonarsource.com/sonarqube-server/user-guide/code-metrics/metrics-definition                                                                                                                                                                                                           |
| SonarQube glossary — coding attributes (consistency / intentionality / adaptability / responsibility)                                          | read 2026-09-13                        | https://docs.sonarsource.com/sonarqube-for-ide/vs-code/concepts/clean-code/definition/                                                                                                                                                                                                             |
| Qlty docs — code smells, complexity, duplication, maintainability metrics & ratings                                                            | read 2026-09-13                        | https://docs.qlty.sh/code-smells ; https://docs.qlty.sh/complexity ; https://docs.qlty.sh/duplication ; https://docs.qlty.sh/cloud/maintainability/metrics                                                                                                                                         |
| Qlty default thresholds (source `qlty-config/default.toml`)                                                                                    | qlty v0.644.0, main 2026-09-13         | https://github.com/qltysh/qlty/blob/main/qlty-config/default.toml                                                                                                                                                                                                                                  |
| Code Climate Quality (legacy) default maintainability checks & thresholds (docs.codeclimate.com now redirects to Qlty)                         | Wayback snapshot 2023-12-16            | https://web.archive.org/web/2023/https://docs.codeclimate.com/docs/default-analysis-configuration                                                                                                                                                                                                  |
| connascence.io (Page-Jones / Weirich taxonomy)                                                                                                 | read 2026-09-13                        | https://connascence.io/                                                                                                                                                                                                                                                                            |
| ISO/IEC 25010:2023 (official preview: foreword change list + clauses 3.1–3.4)                                                                  | 2023                                   | https://cdn.standards.iteh.ai/samples/78176/13ff8ea97048443f99318920757df124/ISO-IEC-25010-2023.pdf                                                                                                                                                                                                |
| arc42 quality model — ISO 25010:2023 characteristic table (secondary, for clauses beyond the preview)                                          | read 2026-09-13                        | https://quality.arc42.org/standards/iso-25010                                                                                                                                                                                                                                                      |
| Brown et al. _AntiPatterns_ — SourceMaking summaries (Wayback) + antipatterns.com tutorial index                                               | 2019 / 2021 snapshots                  | https://web.archive.org/web/2019/https://sourcemaking.com/antipatterns/software-development-antipatterns ; https://web.archive.org/web/2019/https://sourcemaking.com/antipatterns/software-architecture-antipatterns ; https://web.archive.org/web/2021/http://antipatterns.com/briefing/index.htm |
| Foote & Yoder, _Big Ball of Mud_                                                                                                               | PLoP '97, laputan.org                  | https://www.laputan.org/mud/                                                                                                                                                                                                                                                                       |
| C. Richardson, microservices adoption anti-patterns ("More the merrier")                                                                       | 2019                                   | https://microservices.io/post/antipatterns/2019/05/21/antipattern-more-the-merrier.html                                                                                                                                                                                                            |
| testsmells.org / tsDetect catalog (19 smells + detection rules)                                                                                | read 2026-09-13                        | https://testsmells.org/pages/testsmells.html                                                                                                                                                                                                                                                       |
| Meszaros, xUnit Test Patterns — Test Smells index / Obscure Test                                                                               | xunitpatterns.com                      | http://xunitpatterns.com/Test%20Smells.html ; http://xunitpatterns.com/Obscure%20Test.html                                                                                                                                                                                                         |
| Google _Software Engineering at Google_ ch. 11 (coverage note), ch. 13 (Test Doubles)                                                          | abseil.io                              | https://abseil.io/resources/swe-book/html/ch11.html ; https://abseil.io/resources/swe-book/html/ch13.html                                                                                                                                                                                          |
| Stryker — mutant states & metrics; StrykerJS configuration (`thresholds`)                                                                      | @stryker-mutator/core 10.0.0           | https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/ ; https://stryker-mutator.io/docs/stryker-js/configuration/                                                                                                                                                   |
| eslint-plugin-jest rule list; @vitest/eslint-plugin (same rule names present)                                                                  | 29.16.6 ; 1.6.27                       | https://github.com/jest-community/eslint-plugin-jest/tree/main/docs/rules ; https://www.npmjs.com/package/@vitest/eslint-plugin                                                                                                                                                                    |
| Arnaoudova — Linguistic Anti-patterns list (LAPD)                                                                                              | read 2026-09-13                        | https://www.veneraarnaoudova.ca/linguistic-anti-pattern-detector-lapd/las/                                                                                                                                                                                                                         |

## Grading scales & thresholds (quick reference)

**Detection commands** (this file is mainly a naming/grading taxonomy; language-specific commands live in
`python.md` and `monorepoTurborepo.md`. Flags below are from the tools' docs/package source read this session
unless marked.)

| Question                                                          | Command                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cognitive / cyclomatic / length / nesting in JS/TS                | ESLint with `sonarjs/cognitive-complexity` (15), `sonarjs/cyclomatic-complexity` (10), `sonarjs/nested-control-flow` (3), `sonarjs/expression-complexity` (3), `sonarjs/max-lines-per-function` (200), `sonarjs/no-identical-functions` — `npx eslint --rule '{"sonarjs/cognitive-complexity":["error",15]}' <files>` |
| Same for Python                                                   | `ruff check --select C901,PLR0911,PLR0912,PLR0913,PLR0915,PLR0917 --preview --extend-select PLR0904,PLR0914,PLR1702 <paths>` ; `pylint --disable=all --enable=R0901,R0902,R0903,R0904,R0801,R0401 <pkg>`                                                                                                              |
| Structure smells + duplication across languages (Qlty thresholds) | `qlty smells` (CLI command documented at https://docs.qlty.sh/cli/commands/smells)                                                                                                                                                                                                                                    |
| Syntactic clone detection                                         | `npx jscpd <paths>` (flags such as `--min-lines`/`--min-tokens` `UNVERIFIED` — jscpd docs not opened)                                                                                                                                                                                                                 |
| Test-effectiveness (mutation score)                               | `npx stryker run` with `thresholds.break` set (flag `--incremental` `UNVERIFIED` — not opened)                                                                                                                                                                                                                        |
| Assertion-free / conditional / disabled tests                     | ESLint `jest/expect-expect`, `jest/no-conditional-in-test`, `jest/no-conditional-expect`, `jest/no-disabled-tests`, `jest/valid-expect` (same names in `@vitest/eslint-plugin`); `ruff check --select PT`                                                                                                             |
| Module cycles / orphans (Spaghetti, Big Ball of Mud trend)        | `npx depcruise src --config` ; `npx knip --include cycles`                                                                                                                                                                                                                                                            |
| Sonar gate status                                                 | read the quality-gate result of the analysis (Web API / PR decoration); remember the 20-new-line fudge factor                                                                                                                                                                                                         |

**Complexity**

| Metric                                     | Unit       | Threshold                                                                                                                                                                      | Source                                                |
| ------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Cyclomatic complexity v(G) = e − n + 2     | function   | **10** ("original limit… significant supporting evidence"; up to 15 only with "operational advantages")                                                                        | NIST SP 500-235 §2.5                                  |
| Cyclomatic                                 | function   | 10 (`sonarjs:S1541 cyclomatic-complexity` default) ; 10 (`ruff:C901`, pylint `max-complexity`)                                                                                 | eslint-plugin-sonarjs 4.2.0 source ; ruff/pylint docs |
| Cognitive complexity                       | function   | **15** (`sonarjs:S3776 cognitive-complexity` `DEFAULT_THRESHOLD = 15`)                                                                                                         | eslint-plugin-sonarjs 4.2.0 `cjs/S3776/rule.js`       |
| Cognitive complexity ("method-complexity") | function   | **5** (Code Climate legacy default) / **18** (Qlty `smells.function_complexity`)                                                                                               | CC 2023 snapshot ; qlty `default.toml`                |
| File complexity (sum)                      | file       | **50** (Qlty `smells.file_complexity`)                                                                                                                                         | qlty `default.toml`                                   |
| Nesting                                    | function   | 3 (`sonarjs:S134 nested-control-flow`) ; 4 (CC legacy) ; 5 (Qlty) ; 5 (ruff PLR1702, preview)                                                                                  | sources above                                         |
| Boolean operators in one expression        | expression | 3 (`sonarjs:S1067 expression-complexity`) ; 4 (CC `complex-logic`, Qlty `boolean_logic`)                                                                                       | sources above                                         |
| Parameters                                 | function   | 4 (CC `argument-count`) ; 6 (Qlty `function_parameters`) ; 5 (pylint/ruff)                                                                                                     | sources above                                         |
| Return statements                          | function   | 4 (CC) ; 6 (Qlty, pylint)                                                                                                                                                      | sources above                                         |
| Function length                            | function   | 25 lines (CC `method-lines`) ; 200 (`sonarjs:S138 max-lines-per-function`)                                                                                                     | sources above                                         |
| File length                                | file       | 250 lines (CC `file-lines`) ; 1000 (`sonarjs:S104 max-lines`; pylint `max-module-lines`)                                                                                       | sources above                                         |
| Methods per class                          | class      | 20 (CC `method-count`; pylint `max-public-methods`)                                                                                                                            | sources above                                         |
| Duplication                                | block      | Qlty `identical_code`/`similar_code` threshold 15, `duplication.nodes_threshold` 64 (Rust 50); `sonarjs:S4144 no-identical-functions` 3 lines; pylint `min-similarity-lines` 4 | qlty `default.toml` ; sonarjs source ; pylint docs    |
| Maintainability Index (rebased)            | module     | `MAX(0,(171 − 5.2·ln(HV) − 0.23·CC − 16.2·ln(LOC))·100/171)`; **0–9 red, 10–19 yellow, 20–100 green**                                                                          | Microsoft Learn                                       |

> ⚠️ The legacy Code Climate defaults (4/4/250/5/20/25/4/4) and the current Qlty defaults (6 params, 6 returns,
> nesting 5, boolean 4, function cognitive 18, file 50) differ by up to 3.6× for the same named check, and
> docs.codeclimate.com now redirects to Qlty. A finding that says "exceeds the Code Climate threshold" must say
> which one.

**Debt ratios & gates**

| Scale                                         | Definition / grid                                                                                                                                                                       | Source                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| SonarQube technical debt ratio                | `sqale_debt_ratio = technical debt / (cost to develop one line × LOC)`, default 30 min/line                                                                                             | Sonar metrics docs      |
| SonarQube maintainability rating              | A ≤ 5%, B ≥ 5% to < 10%, C ≥ 10% to < 20%, D ≥ 20% to < 50%, E ≥ 50%                                                                                                                    | Sonar metrics docs      |
| SonarQube reliability / security rating (MQR) | A = 0 or only info issues; B ≥ 1 low; C ≥ 1 medium; D ≥ 1 high; E ≥ 1 blocker                                                                                                           | Sonar metrics docs      |
| Sonar way quality gate (default)              | no new issues; all new Security Hotspots reviewed; new-code coverage ≥ 80.0%; new-code duplication ≤ 3.0%                                                                               | Sonar quality-gate docs |
| Sonar "fudge factor" (on by default)          | duplication conditions ignored until ≥ 20 new lines; coverage conditions ignored until ≥ 20 new lines to cover                                                                          | Sonar quality-gate docs |
| Qlty maintainability (project)                | TDR < 5% A; 5–10% B; 10–20% C; 20–50% D; ≥ 50% F (TDR denominator via basic COCOMO)                                                                                                     | Qlty metrics docs       |
| Qlty coverage grade                           | ≥ 90 A; 80–90 B; 70–80 C; 60–70 D; < 60 F                                                                                                                                               | Qlty metrics docs       |
| Stryker mutation score                        | `detected / valid × 100` (detected = killed + timeout); default `thresholds: { high: 80, low: 60, break: null }` — **`break: null` means a low score never fails the build by default** | Stryker docs            |

**Lanza & Marinescu detection strategies** (formulas quoted in the book excerpt for God Class; the others and
all numeric "statistics-based" values via the secondary NDepend series, which states they come from the book's
analysis of **45 Java projects**)

| Strategy               | Formula                                                                                                                                                    | Named thresholds                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| God Class              | `ATFD > FEW ∧ WMC ≥ VERY HIGH ∧ TCC < ONE THIRD` (primary: Springer excerpt, Fig. 4.5)                                                                     | FEW = 2–5; WMC VERY HIGH = 47; ONE THIRD = 0.33                                                                      |
| Feature Envy (method)  | `ATFD > FEW ∧ LAA < ONE THIRD ∧ FDP ≤ FEW`                                                                                                                 | FEW = 2–5; 0.33                                                                                                      |
| Data Class             | `WOC < ONE THIRD ∧ ((NOPA+NOAM > FEW ∧ WMC < HIGH) ∨ (NOPA+NOAM > MANY ∧ WMC < VERY HIGH))`                                                                | MANY = 7–8 (short-term memory); WMC HIGH = 31, VERY HIGH = 47                                                        |
| Brain Method           | `LOC > HIGH(class LOC)/2 ∧ CYCLO ≥ HIGH ∧ MAXNESTING ≥ SEVERAL ∧ NOAV > MANY`                                                                              | class LOC HIGH = 130; CYCLO HIGH = 3.1 (per-LOC normalised — `UNVERIFIED` interpretation); SEVERAL = 2–5; MANY = 7–8 |
| Intensive Coupling     | `((CINT > SHORT_MEMORY_CAP ∧ CDISP < HALF) ∨ (CINT > FEW ∧ CDISP < A QUARTER)) ∧ MAXNESTING > SHALLOW`                                                     | cap = 7–8; HALF 0.5; QUARTER 0.25; SHALLOW = 1                                                                       |
| Dispersed Coupling     | `CINT > SHORT_MEMORY_CAP ∧ CDISP ≥ HALF ∧ MAXNESTING > SHALLOW`                                                                                            | as above                                                                                                             |
| Shotgun Surgery        | `CM > SHORT_MEMORY_CAP ∧ CC > MANY` (CM = changing methods, CC = changing classes)                                                                         | blog author "used 7… and 10 for Many" — book value `UNVERIFIED`                                                      |
| Refused Parent Bequest | `((NProtM > FEW ∧ BUR < A THIRD) ∨ BOvR < A THIRD) ∧ ((AMW > AVERAGE ∨ WMC > AVERAGE) ∧ NOM > AVERAGE)`                                                    | AMW AVG = 2; WMC AVG = 14; NOM AVG = 7                                                                               |
| Tradition Breaker      | `(NAS ≥ AVG NOM ∧ PNAS ≥ TWO THIRDS) ∧ ((AMW > AVG ∨ WMC ≥ VERY HIGH) ∧ NOM ≥ HIGH) ∧ (parent AMW > AVG ∧ parent NOM > HIGH/2 ∧ parent WMC ≥ VERY HIGH/2)` | NOM HIGH = 10                                                                                                        |
| Brain Class            | named in the book's "identity disharmonies" list                                                                                                           | formula & thresholds `UNVERIFIED` (not opened)                                                                       |

Book's own caveat (excerpt ch. 4): detection strategies "produce… a list of suspects" that "must be manually
inspected". The statistics-based numbers are **Java** norms; for other languages treat them as starting points
and prefer the tool's own calibrated defaults.

**ISO/IEC 25010:2023 product quality model** (9 characteristics). Changes from 2011, verbatim from the foreword:
Safety added (operational constraint, risk identification, fail safe, hazard warning, safe integration);
usability → **interaction capability**; portability → **flexibility**; inclusivity and self-descriptiveness,
resistance, and scalability added under interaction capability, security and flexibility respectively; user
interface aesthetics → user engagement; maturity → **faultlessness**; accessibility split into inclusivity and
user assistance.

| Characteristic         | Sub-characteristics                                                                                                                                                                  | Typical code-level finding families                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Functional suitability | functional completeness, correctness, appropriateness (preview 3.1)                                                                                                                  | correctness bugs (escalate to correctness reviewer) |
| Performance efficiency | time behaviour, resource utilization, capacity (preview 3.2)                                                                                                                         | N+1, blocking I/O, unbounded memory                 |
| Compatibility          | co-existence, interoperability (preview 3.3)                                                                                                                                         | contract drift, version skew                        |
| Interaction capability | appropriateness recognizability, learnability, operability, user error protection (preview 3.4.1–3.4.4), user engagement, inclusivity, user assistance, self-descriptiveness (arc42) | accessibility, error messages                       |
| Reliability            | faultlessness, fault tolerance, availability, recoverability (arc42)                                                                                                                 | swallowed errors, missing timeouts/retries          |
| Security               | confidentiality, integrity, non-repudiation, accountability, authenticity, resistance (arc42)                                                                                        | injection, secrets, authz                           |
| Maintainability        | modularity, reusability, analysability, modifiability, testability (arc42 table ambiguous on testability — see open questions)                                                       | smells, complexity, coupling, duplication           |
| Flexibility            | adaptability, scalability, installability, replaceability (arc42)                                                                                                                    | hard-coded env, non-portable packaging              |
| Safety                 | operational constraint, risk identification, fail safe, hazard warning, safe integration (preview foreword)                                                                          | fail-open defaults, destructive ops without guard   |

**Sonar coding attributes → software qualities** (glossary, read 2026-09-13): _consistency_ (formatted,
conventional, identifiable); _intentionality_ (clear, logical, complete, efficient); _adaptability_ (focused,
distinct, modular, tested); _responsibility_ (lawful, trustworthy, respectful); each attribute contributes to one
or more of **security, reliability, maintainability**. ⚠️ The glossary text under "modular" actually describes
_tested_ ("has automated checks that provide confidence…") and there is no separate "tested" definition — cite the
attribute names, not that definition.

**Connascence** (connascence.io): _static_ — Name, Type, Meaning, Position, Algorithm; _dynamic_ — Execution,
Timing, Value, Identity. Graded on three axes: **Strength** ("determined by the ease with which that type of
coupling can be refactored"; static weaker than dynamic), **Locality** ("Stronger connascences are more acceptable
within a module. Weaker connascences should be used between entities that are far apart"), **Degree** ("Does the
coupling in question affect 2 entities, or 200?"). Ordering within static/dynamic lists follows the site's
navigation order (weak → strong).

---

## Fowler & Beck's 24 smells (Refactoring, 2nd ed.)

The refactorings listed under each smell are the ones the chapter names, with the book's page numbers. Fowler:
"no set of metrics rivals informed human intuition" — the metric signals below are aids, not definitions.

### XC-01 Mysterious Name

- **Signal:** names that need the body to be understood: `data`, `info`, `handle`, `process`, `mgr`, `tmp2`, `doStuff`, single letters outside tiny scopes; a name that contradicts behaviour (see XC-58 linguistic anti-patterns).
- **Tool coverage:** partial — `ruff:N8xx` pep8-naming, `ruff:E741` (casing/ambiguity only); `sonarjs:S1135 todo-tag` no. Meaning is judgement.
- **Why it hurts:** analysability; every reader re-derives intent; wrong names cause wrong changes.
- **Severity:** minor; major when the name misleads about side effects, units, or trust (`sanitizedInput` that isn't).
- **Remediation:** Change Function Declaration (124), Rename Variable (137), Rename Field (244) — trap: "When you can't think of a good name… it's often a sign of a deeper design malaise" — a hard-to-name unit usually needs Extract Function/Class first.
- **Not a finding when:** conventional short names in tight scope (`i`, `e`, `acc` in a reducer), domain-standard abbreviations.
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-02 Duplicated Code

- **Signal:** same expression/structure in ≥ 2 places; Qlty identical/similar-code matches; `sonarjs:S4144` identical functions (≥ 3 lines); `sonarjs:S1871`/`S3923` duplicated branches; jscpd clone reports.
- **Tool coverage:** partial — clone detectors find _syntactic_ duplication; **duplicated knowledge** (same business rule re-implemented differently — Kerievsky's "subtle" duplication, XC-29 Oddball Solution) needs judgement.
- **Why it hurts:** a fix applied to one copy; divergent behaviour; Connascence of Algorithm across distance.
- **Severity:** minor for local structural echo; major when a business rule / validation / contract is duplicated across modules or services.
- **Remediation:** Extract Function (106), Slide Statements (223), Pull Up Method (350) — trap: DRY governs knowledge, not keystrokes; merging two things that change for different reasons creates the wrong abstraction (flag-riddled helper).
- **Not a finding when:** similar-looking test setup (DAMP), two copies owned by different bounded contexts that are expected to diverge.
- **Architecture:** yes when duplication spans services (contract/rule owner) — escalate.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392 ; https://github.com/qltysh/qlty/blob/main/qlty-config/default.toml

### XC-03 Long Function

- **Signal:** > 25 lines (CC legacy) / > 200 (sonarjs S138) / > 50 statements (pylint); cognitive > 15 (Sonar) or > 18 (Qlty); comments separating "phases" inside a body; L&M **Brain Method** (table above).
- **Tool coverage:** `sonarjs:S138 max-lines-per-function`, `sonarjs:S3776`, `ruff:PLR0915`, Qlty `function_complexity`. partial: whether the function has one _semantic_ purpose is judgement ("The key here is not function length but the semantic distance between what the method does and how it does it").
- **Why it hurts:** analysability/testability; hidden coupling between phases; merge conflicts.
- **Severity:** minor at threshold; major at ~2× or when it mixes I/O and decisions.
- **Remediation:** Extract Function (106) ("Ninety-nine percent of the time"), Replace Temp with Query (178), Introduce Parameter Object (140), Preserve Whole Object (319), Replace Function with Command (337), Decompose Conditional (260), Replace Conditional with Polymorphism (272), Split Loop (227) — trap: extracting into functions that need 8 parameters (Data Clumps) is no gain.
- **Not a finding when:** a flat, linear sequence (e.g., a declarative configuration or a straight-line migration script) with low cognitive complexity.
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-04 Long Parameter List

- **Signal:** > 4 (CC) / > 5 (pylint/ruff) / > 6 (Qlty) params; consecutive same-typed params; boolean flag params.
- **Tool coverage:** `ruff:PLR0913`/`PLR0917`, `eslint:max-params` (`sonarjs` S107 maps to it), Qlty `function_parameters`. partial: whether they form a concept is judgement.
- **Why it hurts:** Connascence of Position; call-site swaps compile; flags hide two behaviours.
- **Severity:** minor; major for public APIs or same-type adjacent params (swap risk).
- **Remediation:** Replace Parameter with Query (324), Preserve Whole Object (319), Introduce Parameter Object (140), Remove Flag Argument (314), Combine Functions into Class (144).
- **Not a finding when:** keyword-only / named-object parameters; framework-mandated signatures.
- **Architecture:** yes if it's a wire/public contract.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-05 Global Data

- **Signal:** module-level mutable variables, singletons with setters, `global` statements, process-wide registries mutated at runtime.
- **Tool coverage:** partial — `ruff:PLW0603`, `eslint:no-global-assign`, `import-x/no-mutable-exports`; reach/ownership is judgement.
- **Why it hurts:** "can be modified from anywhere" (Fowler) — Connascence of Execution/Timing at maximal degree; test-order dependence.
- **Severity:** major (blocker when it crosses tenant/request boundaries).
- **Remediation:** Encapsulate Variable (132) then restrict scope; inject dependencies.
- **Not a finding when:** immutable constants; read-only config loaded once.
- **Architecture:** sometimes (shared state across modules).
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-06 Mutable Data

- **Signal:** the same variable reassigned for different meanings; objects mutated after being passed around; setters on value-like objects; derived values stored and updated manually.
- **Tool coverage:** partial — `eslint:prefer-const`, `typescript-eslint:prefer-readonly`, `ruff:PLW2901`; aliasing effects are judgement.
- **Why it hurts:** action-at-a-distance bugs; cache/derived-state drift.
- **Severity:** minor → major in shared/concurrent code.
- **Remediation:** Encapsulate Variable (132), Split Variable (240), Slide Statements (223), Extract Function (106), Separate Query from Modifier (306), Remove Setting Method (331), Replace Derived Variable with Query (248), Combine Functions into Class (144) / Transform (149), Change Reference to Value (252).
- **Not a finding when:** local accumulation in a tight loop; performance-critical buffers with clear ownership.
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-07 Divergent Change

- **Signal:** one module edited for unrelated reasons (git log shows DB, UI, and pricing changes to the same file); "when I add a currency I change these 3 functions, when I add a DB I change these 4" in one class.
- **Tool coverage:** none — judgement; git churn-by-reason; L&M God Class approximates it.
- **Why it hurts:** modifiability; unrelated changes collide; SRP violation.
- **Severity:** major.
- **Remediation:** Split Phase (154), Move Function (198), Extract Function (106), Extract Class (182).
- **Not a finding when:** a composition root / wiring module whose job is to know everything.
- **Architecture:** yes — module responsibility boundaries.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-08 Shotgun Surgery

- **Signal:** one logical change touches many files/classes (PR diff touches N callers for one rule change); L&M: `CM > 7 ∧ CC > MANY`; system scale: a feature requires coordinated deploys of several services (see XC-44).
- **Tool coverage:** none — judgement; change-coupling from git history (co-change analysis).
- **Why it hurts:** missed edits → inconsistent behaviour.
- **Severity:** major.
- **Remediation:** Move Function (198), Move Field (207), Combine Functions into Class (144) / Transform (149), Split Phase (154), Inline Function (115), Inline Class (186).
- **Not a finding when:** mechanical renames/codemods; cross-cutting concerns applied via a single decorator/middleware change.
- **Architecture:** yes at package/service scale.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392 ; https://simpleorientedarchitecture.com/identify-shotgun-surgery-using-ndepend/

### XC-09 Feature Envy

- **Signal:** method reads more fields of another object than its own (`order.customer.address.zip`, `x.a + x.b * x.c`); L&M: `ATFD > FEW ∧ LAA < 0.33 ∧ FDP ≤ FEW`.
- **Tool coverage:** none in mainstream JS/Python linters — judgement or NDepend/iPlasma-style queries.
- **Why it hurts:** behaviour lives away from data; changes to the data class ripple.
- **Severity:** minor → major if repeated across callers.
- **Remediation:** Move Function (198), Extract Function (106) for the envious part — trap: Strategy/Visitor deliberately separate behaviour from data; don't "fix" those.
- **Not a finding when:** DTO mappers, serializers, pure functions over records in a functional style, Visitor/Strategy.
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392 ; https://simpleorientedarchitecture.com/how-to-identify-feature-envy-using-ndepend/

### XC-10 Data Clumps

- **Signal:** the same 3+ fields/params travel together (`startDate, endDate, tz`; `lat, lng`; `host, port, user, password`). Test: delete one — do the others still make sense?
- **Tool coverage:** none — judgement.
- **Why it hurts:** Connascence of Position/Meaning; validation duplicated at each site.
- **Severity:** minor.
- **Remediation:** Extract Class (182), Introduce Parameter Object (140), Preserve Whole Object (319) — a value object is often the missing domain concept.
- **Not a finding when:** coordinates passed to a math function in a hot loop.
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392 ; https://www.industriallogic.com/img/blog/2005/09/smellstorefactorings.pdf

### XC-11 Primitive Obsession

- **Signal:** money as float/number, IDs as bare strings interchangeable across entity types, status as string literals, phone/email/url as `string` validated in many places, type codes.
- **Tool coverage:** partial — `ruff:PLR2004` / `sonarjs:S1192 no-duplicate-string` (repeated literals, default 3); branded types and value objects are judgement.
- **Why it hurts:** invalid states representable; unit/ID mix-ups compile.
- **Severity:** major at trust/money/identity boundaries; minor otherwise.
- **Remediation:** Replace Primitive with Object (174), Replace Type Code with Subclasses (362), Replace Conditional with Polymorphism (272), Extract Class (182), Introduce Parameter Object (140); in TS branded types / discriminated unions; in Python `NewType`/`Enum`/value dataclasses — "parse, don't validate".
- **Not a finding when:** wire DTOs at the edge (parse them immediately inward).
- **Architecture:** yes when the primitive is in a persisted/wire contract.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-12 Repeated Switches

- **Signal:** the _same_ `switch`/if-chain over the same discriminant in ≥ 2 places (2nd edition narrowed the smell to repeated switches).
- **Tool coverage:** partial — `@typescript-eslint/switch-exhaustiveness-check`, mypy `exhaustive-match` catch missing cases, not repetition.
- **Why it hurts:** adding a case requires finding every switch (Shotgun Surgery).
- **Severity:** minor; major if a missed case is silent (default branch).
- **Remediation:** Replace Conditional with Polymorphism (272); in TS a discriminated union + exhaustive `switch` with `never` check is the Visitor-equivalent and acceptable when centralised.
- **Not a finding when:** a single exhaustive switch in one place (Fowler removed the general "Switch Statements" smell in the 2nd ed.).
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-13 Loops

- **Signal:** manual accumulation loops that are a filter/map/reduce.
- **Tool coverage:** `ruff:PERF401` (manual list comprehension), `sonarjs`/`unicorn` style rules (`UNVERIFIED` names).
- **Why it hurts:** readability — intent hidden in mechanics.
- **Severity:** minor.
- **Remediation:** Replace Loop with Pipeline (231) — trap: chained pipelines with side effects inside `map` are worse than a loop.
- **Not a finding when:** early exit, performance-critical loops, async sequential awaits.
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-14 Lazy Element

- **Signal:** a class/function/package that adds nothing over what it wraps; one-line wrappers; one-subclass hierarchies.
- **Tool coverage:** none — judgement (`sonarjs`/knip cannot judge value).
- **Why it hurts:** indirection cost with no payoff.
- **Severity:** minor.
- **Remediation:** Inline Function (115), Inline Class (186), Collapse Hierarchy (380).
- **Not a finding when:** an Adapter/Anti-corruption seam over a third-party API, a named test seam, or a public package entry point.
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-15 Speculative Generality

- **Signal:** abstract base with one implementation, unused parameters/hooks, config knobs no one sets, generic `<T>` with one instantiation, "in case we need it" comments; only callers are tests.
- **Tool coverage:** partial — knip (`exports`, `types` unused), `ruff:ARG001`, `sonarjs:S1172 no-unused-function-argument`; YAGNI judgement.
- **Why it hurts:** carrying cost; wrong abstraction ossifies.
- **Severity:** minor → major for public API surface.
- **Remediation:** Collapse Hierarchy (380), Inline Function (115), Inline Class (186), Change Function Declaration (124), Remove Dead Code (237) — trap: a cheap seam at an expensive-to-reverse boundary (wire/persisted/security) is _not_ speculative.
- **Not a finding when:** a known, scheduled requirement; plugin points that already have ≥ 2 real implementations.
- **Architecture:** sometimes.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-16 Temporary Field

- **Signal:** fields set only in some code paths, `null` otherwise; an object whose validity depends on which method ran first.
- **Tool coverage:** partial — TS `strictPropertyInitialization`, mypy `possibly-undefined`; judgement for semantics.
- **Why it hurts:** Connascence of Execution; null errors.
- **Severity:** minor → major.
- **Remediation:** Extract Class (182), Move Function (198), Introduce Special Case (289).
- **Not a finding when:** lazily-initialised cache fields behind an accessor.
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-17 Message Chains

- **Signal:** `a.getB().getC().getD()`; `order.customer.account.plan.limits.max`.
- **Tool coverage:** none — judgement.
- **Why it hurts:** client coupled to the whole navigation structure (Law of Demeter).
- **Severity:** minor.
- **Remediation:** Hide Delegate (189), Extract Function (106), Move Function (198) — trap: hiding every chain produces Middle Man (XC-18).
- **Not a finding when:** fluent builders/query DSLs returning the same type; immutable data navigation in pure transforms.
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-18 Middle Man

- **Signal:** class where most methods delegate one-to-one.
- **Tool coverage:** none — judgement.
- **Why it hurts:** indirection without behaviour.
- **Severity:** minor.
- **Remediation:** Remove Middle Man (192), Inline Function (115), Replace Superclass with Delegate (399), Replace Subclass with Delegate (381).
- **Not a finding when:** Proxy/Adapter/Facade deliberately isolating a vendor, adding auth/caching/metrics.
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-19 Insider Trading

- **Signal:** modules reaching into each other's internals (private fields via casts, `_private` access, deep imports), bidirectional knowledge.
- **Tool coverage:** partial — `ruff:SLF001`, `import-x/no-internal-modules`, Nx/turbo boundaries (see MONO-13/14).
- **Why it hurts:** encapsulation loss; change in one breaks the other.
- **Severity:** major across packages.
- **Remediation:** Move Function (198), Move Field (207), Hide Delegate (189), Replace Subclass with Delegate (381), Replace Superclass with Delegate (399).
- **Not a finding when:** tests of a module's own internals (still prefer public surface).
- **Architecture:** yes across module boundaries.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

### XC-20 Large Class

- **Signal:** many fields/methods (> 20 methods CC legacy; pylint > 7 attributes); L&M **God Class** `ATFD > 2–5 ∧ WMC ≥ 47 ∧ TCC < 0.33`; Brown's **The Blob** (XC-35).
- **Tool coverage:** partial — `sonarjs:S104 max-lines` (1000), pylint R0902/R0904, `ruff:PLR0904` (preview); cohesion metrics need NDepend/iPlasma-like tooling or judgement.
- **Why it hurts:** Divergent Change; untestable; merge hotspot.
- **Severity:** major.
- **Remediation:** Extract Class (182), Extract Superclass (375), Replace Type Code with Subclasses (362).
- **Not a finding when:** generated clients, framework-required aggregates with high cohesion (TCC high).
- **Architecture:** yes (escalate when it spans contexts).
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392 ; https://beckassets.blob.core.windows.net/product/readingsample/187724/9783540244295_excerpt_001.pdf ; https://simpleorientedarchitecture.com/how-to-identify-god-class-using-ndepend/

### XC-21 Alternative Classes with Different Interfaces

- **Signal:** two adapters/clients doing the same job with different method names/shapes (`S3Storage.put` vs `GcsStore.upload`).
- **Tool coverage:** none — judgement.
- **Why it hurts:** no substitutability; callers branch on type.
- **Severity:** minor.
- **Remediation:** Change Function Declaration (124), Move Function (198), Extract Superclass (375); Kerievsky Unify Interfaces with Adapter.
- **Not a finding when:** genuinely different capabilities.
- **Architecture:** sometimes (port definition).
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392 ; https://www.industriallogic.com/img/blog/2005/09/smellstorefactorings.pdf

### XC-22 Data Class

- **Signal:** only fields + getters/setters, behaviour on it lives elsewhere (Feature Envy on the other side); L&M `WOC < 0.33 ∧ (NOPA+NOAM > FEW ∧ WMC < 31 ∨ NOPA+NOAM > 7–8 ∧ WMC < 47)`.
- **Tool coverage:** none — judgement.
- **Why it hurts:** invariants enforced (or not) by every caller.
- **Severity:** minor; major when invariants exist and aren't enforced.
- **Remediation:** Encapsulate Record (162), Remove Setting Method (331), Move Function (198), Extract Function (106), Split Phase (154).
- **Not a finding when:** DTOs, immutable records/value objects, result records of Split Phase (Fowler notes these are fine).
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392 ; https://simpleorientedarchitecture.com/how-to-identify-data-class-using-ndepend/

### XC-23 Refused Bequest

- **Signal:** subclass overrides to throw/no-op, ignores most inherited members; L&M Refused Parent Bequest formula (table).
- **Tool coverage:** partial — `sonarjs`/`ruff:B024`/`B027` for abstract misuse; judgement otherwise.
- **Why it hurts:** LSP violation; surprising runtime errors.
- **Severity:** minor (ignores implementation) / major (refuses interface — throws `NotImplemented`).
- **Remediation:** Push Down Method (359), Push Down Field (361), Replace Subclass with Delegate (381), Replace Superclass with Delegate (399).
- **Not a finding when:** subclass only ignores implementation details but honours the interface (Fowler calls this a faint smell).
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392 ; https://simpleorientedarchitecture.com/how-to-identify-refused-parent-bequest-using-ndepend/

### XC-24 Comments (as deodorant)

- **Signal:** comments explaining _what_ a block does (a function name waiting to happen); comments compensating for bad names; comments restating code; stale comments contradicting code.
- **Tool coverage:** partial — `sonarjs:S125 no-commented-code`, `ruff:ERA001`, `ruff:FIX002`/`sonarjs:S1135 todo-tag`; contradiction/staleness is judgement (see XC-58).
- **Why it hurts:** comments rot; they hide the need to refactor.
- **Severity:** minor; major when a comment asserts a guarantee the code doesn't provide.
- **Remediation:** Extract Function (106), Change Function Declaration (124), Introduce Assertion (302) — trap: don't delete _why_ comments (rationale, workaround links, ADR references).
- **Not a finding when:** why-comments, public API docs, legal headers, pointers to decisions.
- **Architecture:** no.
- **Sources:** https://www.informit.com/articles/article.aspx?p=2952392

## Kerievsky additions (Refactoring to Patterns)

Mapping from the Industrial Logic quick-reference PDF; the table layout does not survive text extraction, so the
per-smell refactoring lists below are the pattern-directed refactorings printed next to each definition and
should be treated as indicative.

### XC-25 Conditional Complexity

- **Signal:** conditional logic grown across features: nested if/else over modes, state flags, type checks; cognitive complexity spikes; boolean flag parameters toggling behaviour.
- **Tool coverage:** `sonarjs:S3776` (15), `sonarjs:S134` (nesting 3), `sonarjs:S1067` (3 operators), Qlty `boolean_logic` 4 / `nested_control_flow` 5. partial: whether a State/Strategy is warranted is judgement.
- **Why it hurts:** "Conditional logic is innocent in its infancy… Unfortunately, it rarely ages well" (Kerievsky).
- **Severity:** major when conditionals encode a state machine.
- **Remediation:** Replace Conditional Logic with Strategy [K 129], Move Embellishment to Decorator [K 144], Replace State-Altering Conditionals with State [K 166], Introduce Null Object [F/K 301], Replace Conditional Dispatcher with Command [K 191] — trap: a pattern for 2 cases is Speculative Generality.
- **Not a finding when:** a flat exhaustive switch over a closed union.
- **Architecture:** no.
- **Sources:** https://www.industriallogic.com/img/blog/2005/09/smellstorefactorings.pdf ; https://www.sonarsource.com/docs/CognitiveComplexity.pdf

### XC-26 Indecent Exposure

- **Signal:** helpers/classes exported or `public` that clients shouldn't know; packages without `exports`; "internal" types in public signatures.
- **Tool coverage:** partial — knip `exports`/`types` (unused exports), TS `stripInternal`, `import-x/no-internal-modules`.
- **Why it hurts:** "lack of… information hiding [Parnas]" — clients couple to unimportant code; API can't change.
- **Severity:** minor inside an app; major in libraries.
- **Remediation:** Encapsulate Classes with Factory [K 80]; reduce visibility; explicit `exports` subpaths.
- **Not a finding when:** deliberately public extension points.
- **Architecture:** yes for package public surface.
- **Sources:** https://www.industriallogic.com/img/blog/2005/09/smellstorefactorings.pdf

### XC-27 Solution Sprawl

- **Signal:** code/data for one responsibility spread across numerous classes (creation logic for X in 6 places).
- **Tool coverage:** none — judgement.
- **Why it hurts:** Kerievsky relates it to Shotgun Surgery; "results from quickly adding a feature… without spending enough time simplifying and consolidating".
- **Severity:** major.
- **Remediation:** Move Creation Knowledge to Factory [K 68]; Move Function/Field; Inline Class.
- **Not a finding when:** —
- **Architecture:** sometimes.
- **Sources:** https://www.industriallogic.com/img/blog/2005/09/smellstorefactorings.pdf

### XC-28 Combinatorial Explosion

- **Signal:** many near-identical functions/classes per combination (`exportCsvForAdmin`, `exportCsvForUser`, `exportJsonForAdmin`…).
- **Tool coverage:** partial — clone detectors find some; judgement.
- **Why it hurts:** "A subtle form of duplication… numerous pieces of code do the same thing using different combinations of data or behavior".
- **Severity:** major as combinations grow.
- **Remediation:** Replace Implicit Language with Interpreter [K 269]; composition (Decorator/Strategy) over enumeration.
- **Not a finding when:** a small fixed set generated from one source.
- **Architecture:** no.
- **Sources:** https://www.industriallogic.com/img/blog/2005/09/smellstorefactorings.pdf

### XC-29 Oddball Solution

- **Signal:** the same problem solved two ways in one system (two HTTP clients, two date libraries, two retry helpers, two ways to read env/config, one module hand-rolls what the rest uses a library for).
- **Tool coverage:** partial — `eslint:no-restricted-imports` / `ruff:TID251 banned-api` to enforce the chosen one; detection is judgement (grep for competing libraries in manifests).
- **Why it hurts:** "usually indicates subtly duplicated code"; inconsistent behaviour (timeouts, error mapping).
- **Severity:** minor → major for cross-cutting infrastructure (auth, retries, time).
- **Remediation:** pick the canonical solution; Unify Interfaces with Adapter [K 247]; ban the other via lint.
- **Not a finding when:** a migration in progress with a tracked end date.
- **Architecture:** sometimes.
- **Sources:** https://www.industriallogic.com/img/blog/2005/09/smellstorefactorings.pdf

## Metric-based strategies beyond Fowler

### XC-30 Brain Method

- **Signal:** `LOC > 65 (= class HIGH 130 / 2) ∧ CYCLO ≥ HIGH ∧ MAXNESTING ≥ 2–5 ∧ NOAV > 7–8` (Java-derived; see table).
- **Tool coverage:** partial — combine `sonarjs:S138`, `S1541`, `S134` or ruff `PLR0915`/`C901`/`PLR1702`; NOAV (number of accessed variables) is not reported by JS/Python linters — judgement.
- **Why it hurts:** one method centralises a class's intelligence; untestable decision tree.
- **Severity:** major.
- **Remediation:** Extract Function (106), Decompose Conditional (260), Replace Function with Command (337).
- **Not a finding when:** generated parsers, state machines expressed as tables.
- **Architecture:** no.
- **Sources:** https://simpleorientedarchitecture.com/how-to-identify-brain-method-using-ndepend/

### XC-31 Intensive Coupling / Dispersed Coupling

- **Signal:** Intensive — a method calls many operations on few other classes (`CINT > 7 ∧ CDISP < 0.5` or `CINT > FEW ∧ CDISP < 0.25`, with nesting > 1); Dispersed — calls > 7 operations spread over many classes (`CDISP ≥ 0.5`).
- **Tool coverage:** none in JS/Python mainstream — judgement (count distinct external calls/providers in a diff).
- **Why it hurts:** Intensive = chatty dependency on a collaborator's fine-grained API (missing coarse operation); Dispersed = ripple exposure to many changes.
- **Severity:** minor → major in orchestration hot paths.
- **Remediation:** Intensive → Move Function into the provider / introduce a coarser operation (Facade); Dispersed → Extract Function per collaborator, Hide Delegate — trap: orchestration layers legitimately call many services; judge by nesting/branching, which the strategy includes (`MAXNESTING > SHALLOW`).
- **Not a finding when:** flat composition roots / controllers with no conditionals.
- **Architecture:** yes at service scale (chatty interfaces).
- **Sources:** https://simpleorientedarchitecture.com/identify-efferent-coupling-code-smells-using-ndepend/

### XC-32 Tradition Breaker

- **Signal:** a subclass that adds many new services unrelated to its parent while the parent is itself complex (formula in table).
- **Tool coverage:** none — judgement.
- **Why it hurts:** hierarchy no longer expresses a specialisation; inheritance used for reuse.
- **Severity:** minor → major.
- **Remediation:** Replace Superclass with Delegate (399), Extract Class (182).
- **Not a finding when:** framework base classes (controllers/components) where the parent is an integration point.
- **Architecture:** no.
- **Sources:** https://simpleorientedarchitecture.com/how-to-identify-a-tradition-breaker-using-ndepend/

### XC-33 Cognitive vs cyclomatic complexity — using the right one

- **Signal:** a finding cites cyclomatic complexity to argue _readability_, or cognitive complexity to argue _test count_.
- **Tool coverage:** `sonarjs:S3776` (cognitive, 15), `sonarjs:S1541` (cyclomatic, 10), `ruff:C901` (cyclomatic 10), Qlty (cognitive). No Python cognitive-complexity rule in ruff.
- **Why it hurts:** mis-graded findings. Campbell: cyclomatic "excels at measuring" testability but its model is "unsatisfactory at producing a value that measures" understandability. Rules (white paper v1.7): ignore shorthand (methods, null-coalescing do not increment); +1 per break in linear flow (loops, `if`, ternary, `catch` — one per catch clause regardless of types; a whole `switch` = **one** increment; each _sequence_ of like binary logical operators = +1; each method in a recursion cycle; `goto`/labelled `break`/`continue`); **nesting increment** for each level when a structural/hybrid increment is nested; `else if`/`else` are hybrid (no nesting increment); lambdas/nested functions add nesting level but no structural increment. McCabe/NIST: v(G) = e − n + 2; limit 10; McCabe originally exempted single multiway-decision modules.
- **Severity:** n/a (grading guidance).
- **Remediation:** cite cognitive complexity for comprehension findings and cyclomatic for "minimum tests to cover basis paths"; a 12-case flat `switch` is high cyclomatic, cognitive 1 — don't flag it as unreadable.
- **Not a finding when:** —
- **Architecture:** no.
- **Sources:** https://www.sonarsource.com/docs/CognitiveComplexity.pdf ; https://www.mccabe.com/pdf/mccabe-nist235r.pdf ; https://docs.qlty.sh/complexity — ⚠️ Campbell's rule 1 is "**Ignore** structures that allow multiple statements to be readably shorthanded into one" (shorthand does NOT increment). Qlty's prose states the inverse ("Code is considered more complex when it uses shorthand…"), yet Qlty's own Ruby example shows the shorthand `&.` _not_ adding complexity while `&&` does. Cite the white paper, not Qlty's sentence.

### XC-34 Metric gaming and aggregate-index misuse (MI, TDR, coverage %)

- **Signal:** PRs that split functions solely to pass a threshold (many tiny functions passing 8 params); MI or TDR quoted as proof of quality; per-file coverage raised with assertion-free tests; Sonar gate "passed" on a < 20-line change (fudge factor skipped coverage/duplication).
- **Tool coverage:** none — judgement. Aggregates: Maintainability Index `MAX(0,(171 − 5.2 ln HV − 0.23 CC − 16.2 ln LOC)·100/171)` (Microsoft thresholds 0–9 / 10–19 / 20–100 chosen "conservative… to keep the noise level low"); Sonar TDR with 30 min/LOC default; Qlty TDR with COCOMO denominator.
- **Why it hurts:** Goodhart — SWE-at-Google ch. 11: coverage "only measures that a line was invoked, not what happened as a result" and "quickly becomes a goal unto itself". Microsoft's MI green band starts at 20/100, so "green MI" says little.
- **Severity:** minor (reporting) → major when a gate is the only quality control.
- **Remediation:** grade by the underlying smell and its consequence; use mutation score (XC-55) for test effectiveness; keep thresholds as tripwires, not targets.
- **Not a finding when:** thresholds used as prompts for human review.
- **Architecture:** no.
- **Sources:** https://learn.microsoft.com/en-us/visualstudio/code-quality/code-metrics-maintainability-index-range-and-meaning ; https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates ; https://docs.sonarsource.com/sonarqube-server/user-guide/code-metrics/metrics-definition ; https://abseil.io/resources/swe-book/html/ch11.html

## Architecture & process anti-patterns

### XC-35 The Blob

- **Signal:** one class/module "with a lion's share of the responsibilities, while most other objects only hold data or execute simple processes" — the procedural centre of an OO/modular design (God Class + surrounding Data Classes).
- **Tool coverage:** see XC-20 (God Class metrics); the "surrounded by data holders" part is judgement.
- **Why it hurts:** every change goes through one file; impossible to test in isolation.
- **Severity:** major.
- **Remediation:** "distribute responsibilities more uniformly and isolat[e] the effect of changes": Extract Class, Move Function toward the data (cures the Data Classes simultaneously).
- **Not a finding when:** a thin coordinator (Mediator/Facade) that delegates and holds no business rules.
- **Architecture:** yes — escalate.
- **Sources:** https://web.archive.org/web/2019/https://sourcemaking.com/antipatterns/software-development-antipatterns

### XC-36 Lava Flow

- **Signal:** dead or half-used code nobody dares remove ("don't touch, might be used"), commented-out blocks, unused exports/flags, obsolete migrations/adapters kept "just in case".
- **Tool coverage:** partial — knip (`files`, `exports`, `dependencies`), `sonarjs:S125`, `ruff:ERA001`, `ruff:F401`/`F841`, coverage reports of never-executed code; safety-of-removal is judgement.
- **Why it hurts:** "Dead code and forgotten design information is frozen in an ever-changing design"; misleads readers, keeps CVE-carrying deps alive.
- **Severity:** minor → major for security-relevant dead paths.
- **Remediation:** Remove Dead Code (237); feature-flag cleanup with owners and expiry; the SourceMaking refactored solution is a configuration-management process that eliminates dead code.
- **Not a finding when:** code reachable via reflection/framework conventions (verify with knip plugins/entry config).
- **Architecture:** no.
- **Sources:** https://web.archive.org/web/2019/https://sourcemaking.com/antipatterns/software-development-antipatterns

### XC-37 Poltergeists

- **Signal:** short-lived classes with "very limited roles and effective life cycles" that only kick off work for other objects: `XStarter`, `YInvoker`, `ZRunnerHelper` instantiated, one method called, discarded.
- **Tool coverage:** none — judgement.
- **Why it hurts:** needless indirection; extra objects in every trace.
- **Severity:** minor.
- **Remediation:** "reallocation of responsibilities to longer-lived objects" — Inline Class (186).
- **Not a finding when:** Command objects that are queued/serialised/undoable (the lifecycle _is_ the value).
- **Architecture:** no.
- **Sources:** https://web.archive.org/web/2019/https://sourcemaking.com/antipatterns/software-development-antipatterns

### XC-38 Golden Hammer

- **Signal:** one familiar tool applied to every problem: everything is an event bus, a regex parser for structured formats, a relational table as a queue, Redux for local state, a framework-wide abstraction for a single case.
- **Tool coverage:** none — judgement.
- **Why it hurts:** "A familiar technology or concept applied obsessively to many software problems"; poor fit → complexity and failure modes the tool wasn't built for.
- **Severity:** major when the misfit carries correctness risk (regex for HTML/JSON, DB polling as queue under load).
- **Remediation:** choose per problem; library-first for the actual problem (parser, queue, state machine).
- **Not a finding when:** a standardised stack decision with documented trade-offs (consistency has value — contrast Oddball Solution XC-29).
- **Architecture:** yes — technology selection; escalate.
- **Sources:** https://web.archive.org/web/2019/https://sourcemaking.com/antipatterns/software-development-antipatterns

### XC-39 Boat Anchor

- **Signal:** dependencies/infrastructure/modules that "serve no useful purpose on the current project" — installed-but-unused packages, provisioned-but-unused services, vendored SDKs.
- **Tool coverage:** partial — knip `dependencies`/`unlisted`, depcheck-style tools; infra usage is judgement.
- **Why it hurts:** cost, attack surface, upgrade burden.
- **Severity:** minor → major (security/cost).
- **Remediation:** remove; if kept for a decision, record it.
- **Not a finding when:** peer dependencies consumed by tooling (knip plugin config).
- **Architecture:** sometimes.
- **Sources:** https://web.archive.org/web/2019/https://sourcemaking.com/antipatterns/software-development-antipatterns

### XC-40 Dead End (modified third-party component)

- **Signal:** patched `node_modules`/vendored forks (`patch-package` patches, copied SDK with edits) without upstream issue or removal plan.
- **Tool coverage:** partial — presence of `patches/`, `pnpm.patchedDependencies`, vendored dirs; judgement for plan.
- **Why it hurts:** "the support burden transfers to the application system developers… Improvements in the reusable component are not easily integrated".
- **Severity:** major for security-relevant libraries (patch blocks upgrades).
- **Remediation:** upstream the fix; wrap instead of modify (Adapter); record expiry.
- **Not a finding when:** a short-lived patch linked to an upstream PR with a tracked removal.
- **Architecture:** sometimes.
- **Sources:** https://web.archive.org/web/2019/https://sourcemaking.com/antipatterns/software-development-antipatterns

### XC-41 Spaghetti Code

- **Signal:** "Ad hoc software structure": control flow jumping through callbacks/flags/globals, functions with high cognitive complexity calling each other cyclically, no discernible layering; module cycles.
- **Tool coverage:** partial — cognitive complexity, `dependency-cruiser:no-circular`, `import-x/no-cycle`, knip `cycles`; structure-level judgement.
- **Why it hurts:** "makes it difficult to extend and optimize code".
- **Severity:** major.
- **Remediation:** SourceMaking's refactored solution: a development process that incorporates frequent refactoring; locally Extract Function/Split Phase, break cycles with Dependency Inversion.
- **Not a finding when:** —
- **Architecture:** yes when cycles cross modules.
- **Sources:** https://web.archive.org/web/2019/https://sourcemaking.com/antipatterns/software-development-antipatterns ; https://web.archive.org/web/2021/http://antipatterns.com/briefing/index.htm

### XC-42 Cut-and-Paste Programming / Swiss Army Knife

- **Signal:** Cut-and-Paste — near-identical blocks across files (see XC-02) especially copied with a tweak; Swiss Army Knife — "an excessively complex class interface… a large number of interface signatures in a futile attempt to meet all possible needs" (options objects with 30 flags, clients with every endpoint variant).
- **Tool coverage:** Cut-and-Paste: jscpd / Qlty `similar_code`/`identical_code` / `sonarjs:S4144`; Swiss Army Knife: none — judgement (count public methods/options).
- **Why it hurts:** Cut-and-Paste: "significant maintenance problems"; Swiss Army Knife: unclear intended use, combinatorial test burden (ISP violation).
- **Severity:** major.
- **Remediation:** Cut-and-Paste: "black-box reuse" — Extract Function/Module with one owner; Swiss Army Knife: Split interface by client role (Extract Interface), profiles/presets.
- **Not a finding when:** test fixtures (DAMP); generated SDKs mirroring an API one-to-one.
- **Architecture:** sometimes.
- **Sources:** https://web.archive.org/web/2019/https://sourcemaking.com/antipatterns/software-development-antipatterns ; https://web.archive.org/web/2019/https://sourcemaking.com/antipatterns/software-architecture-antipatterns

### XC-43 Big Ball of Mud

- **Signal:** system-level: no enforced module boundaries, cycles among top-level packages, shared mutable DB tables read/written by everything, "THROWAWAY CODE" that became production, "SWEEPING IT UNDER THE RUG" facades over chaos.
- **Tool coverage:** partial — dependency graphs (depcruise, Nx/turbo boundaries), cycle counts; judgement for system shape.
- **Why it hurts:** Foote & Yoder: "a casually, even haphazardly, structured system. Its organization… is dictated more by expediency than design." Every change is risky and slow.
- **Severity:** major (a trend grading, not a single-diff finding).
- **Remediation:** the paper's own patterns: PIECEMEAL GROWTH with KEEP IT WORKING, SHEARING LAYERS (separate things that change at different rates), SWEEPING IT UNDER THE RUG (encapsulate the mess behind an interface), RECONSTRUCTION; add boundary enforcement so it can't regress.
- **Not a finding when:** prototypes explicitly scoped as throwaway (with a deletion plan).
- **Architecture:** yes — escalate.
- **Sources:** https://www.laputan.org/mud/

### XC-44 Distributed monolith / system-scale Shotgun Surgery

- **Signal:** services that must be deployed in lockstep; a shared library carrying business rules that forces all services to upgrade together; one feature PR touching many services' contracts; synchronous call chains where one outage takes all down; shared database schemas across services.
- **Tool coverage:** none — judgement (co-change analysis across service directories; deploy coupling in CI config).
- **Why it hurts:** Richardson: more services "increases the risk that changes will require multiple services to change [in] lockstep, which requires more coordination and planning and slows down development" — the costs of distribution with the coupling of a monolith.
- **Severity:** major.
- **Remediation:** re-draw boundaries around business capabilities / teams; versioned contracts (expand-contract); move shared business logic behind one owning service rather than a shared library; asynchronous integration where appropriate.
- **Not a finding when:** a shared _technical_ library (logging, tracing) with stable API.
- **Architecture:** yes — escalate to architecture.
- **Sources:** https://microservices.io/post/antipatterns/2019/05/21/antipattern-more-the-merrier.html

## Connascence as a grading tool

### XC-45 Strong connascence across a boundary (Meaning, Position, Algorithm)

- **Signal:** Meaning — magic values shared by agreement (`status === 3`, test card `"9999-9999-9999-9999"`, role ints); Position — positional tuples/arrays across modules (`user[3]` means admin), positional args in cross-module calls; Algorithm — the same hash/encoding/validation implemented separately on both sides of a wire (client + server regex, sender + receiver checksum).
- **Tool coverage:** partial — magic-number rules (`ruff:PLR2004`, `sonarjs:S1192` duplicate strings); schema-sharing checks; judgement for Algorithm.
- **Why it hurts:** connascence.io — CoM "all parts of this system must agree"; CoA example: validation in model, controller and UI "might well be in different languages… far apart", users "not being able to register, but receiving no feedback". Strength high + locality far + degree high = worst case.
- **Severity:** major when crossing module/service boundaries (locality far); minor within a function.
- **Remediation:** weaken the connascence: CoM → named constants/enums (to CoN); CoP → named objects/keyword args (to CoN); CoA → a single shared implementation or a schema both sides derive from (to CoN/CoT).
- **Not a finding when:** strong connascence inside one small function (locality close — connascence.io: "innocuous when close together").
- **Architecture:** yes when CoA spans services — contract ownership.
- **Sources:** https://connascence.io/meaning.html ; https://connascence.io/position.html ; https://connascence.io/algorithm.html ; https://connascence.io/locality.html

### XC-46 Dynamic connascence (Execution, Timing, Value, Identity)

- **Signal:** Execution — call-order requirements (`init()` before `use()`, `setSubject` after `send()`), lock ordering; Timing — sleeps/timeouts coordinating components, race-dependent behaviour; Value — several values that must change together (test fixtures duplicating production constants, config in two places); Identity — components that must reference the _same instance_ (shared singleton cache, same DB transaction object).
- **Tool coverage:** none — judgement (partial: TS/mypy typestate via types; test smells Sleepy Test for Timing).
- **Why it hurts:** connascence.io: dynamic forms "require knowledge of run-time behavior, and thus are harder to reason about" — strongest class; failures appear under load/ordering.
- **Severity:** major (blocker for Timing in concurrent/distributed code).
- **Remediation:** Execution → make illegal order unrepresentable (builder/typestate, State pattern, constructor injection); Timing → explicit events/awaits instead of sleeps; Value → single source of truth; Identity → explicit ownership/injection of the shared instance.
- **Not a finding when:** documented, encapsulated order within one class's private methods.
- **Architecture:** sometimes.
- **Sources:** https://connascence.io/execution.html ; https://connascence.io/timing.html ; https://connascence.io/value.html ; https://connascence.io/identity.html ; https://connascence.io/strength.html

## Test smells, mocking and test-effectiveness

### XC-47 Assertion Roulette

- **Signal:** many assertions in one test with no messages/structure so a failure doesn't say which behaviour broke (tsDetect: "more than one assertion statement without… an explanation/message").
- **Tool coverage:** partial — `jest|vitest:max-expects`; tsDetect (Java). Judgement: modern runners print the failing assertion line, so the smell is mostly _what_ broke, not _which line_.
- **Why it hurts:** diagnosability; one test hides later failures (Meszaros: "hard to tell which of several assertions… caused a test failure").
- **Severity:** minor.
- **Remediation:** one behaviour per test; parameterised tests (`it.each`, `pytest.mark.parametrize`); custom matchers/assertion messages.
- **Not a finding when:** multiple assertions verifying one logical outcome (fields of one returned object); snapshot of a single structure.
- **Architecture:** no.
- **Sources:** https://testsmells.org/pages/testsmells.html ; http://xunitpatterns.com/Test%20Smells.html

### XC-48 Eager Test / General Fixture / Obscure Test

- **Signal:** Eager — one test exercising several production methods/behaviours; General Fixture — shared `beforeEach`/`setUp` building more than each test uses; Obscure — reader can't see cause→effect (Meszaros: "Mystery Guest is… too little information while Eager Test and Irrelevant Information are… too much").
- **Tool coverage:** tsDetect rules (Java): Eager Test "multiple calls to multiple production methods"; General Fixture "Not all fields instantiated within the setUp method… are utilized by all test methods". JS/Python: none — judgement.
- **Why it hurts:** failures are ambiguous; fixtures couple unrelated tests; slow suites.
- **Severity:** minor.
- **Remediation:** split tests; `make*` fixture factories with `Partial<T>` overrides per test (DAMP); fresh fixture per test.
- **Not a finding when:** an end-to-end/user-journey test that is _meant_ to cover a flow.
- **Architecture:** no.
- **Sources:** https://testsmells.org/pages/testsmells.html ; http://xunitpatterns.com/Obscure%20Test.html

### XC-49 Mystery Guest / Resource Optimism

- **Signal:** test depends on external files, DB rows, env vars, network or shared fixtures not visible in the test body; assumes a file/resource exists.
- **Tool coverage:** tsDetect (Java) only; judgement.
- **Why it hurts:** "stability and performance issues" (tsDetect); erratic tests; unclear preconditions.
- **Severity:** minor → major when it produces flaky CI.
- **Remediation:** inline or build fixtures in the test; hermetic containers for integration tiers with per-test setup — trap: tsDetect's advice "use mock objects in place of external resources" is wrong for integration tests whose purpose _is_ the boundary (see XC-54).
- **Not a finding when:** an integration test that provisions its own resource in setup and says so.
- **Architecture:** no.
- **Sources:** https://testsmells.org/pages/testsmells.html

### XC-50 Conditional Test Logic

- **Signal:** `if`/`switch`/loops/ternaries/`try-catch` in a test body; `expect` inside a conditional or a `catch`.
- **Tool coverage:** `jest|vitest:no-conditional-in-test`, `jest|vitest:no-conditional-expect` ; `ruff:PT017 pytest-assert-in-except` ; `sonarjs` none. tsDetect "Conditional Test Logic", "Exception Handling".
- **Why it hurts:** Meszaros: "A test contains code that may or may not be executed" — assertions silently skipped → test passes without checking.
- **Severity:** major (it can make a test vacuous).
- **Remediation:** parameterise; `expect(() => …).toThrow(…)` / `pytest.raises(…)`; separate tests per branch.
- **Not a finding when:** loops over a table of cases where every iteration asserts unconditionally (prefer `it.each`).
- **Architecture:** no.
- **Sources:** https://testsmells.org/pages/testsmells.html ; http://xunitpatterns.com/Test%20Smells.html ; https://github.com/jest-community/eslint-plugin-jest/tree/main/docs/rules

### XC-51 Sleepy Test / Erratic Test

- **Signal:** `sleep`, `setTimeout` waits, `page.waitForTimeout`, `time.sleep` to "let things settle"; tests that pass on retry.
- **Tool coverage:** tsDetect (Java `Thread.sleep`); Playwright ESLint `playwright/no-wait-for-timeout` (`UNVERIFIED` rule name); `jest:no-confusing-set-timeout`; judgement for other forms.
- **Why it hurts:** Connascence of Timing; flaky (Meszaros Erratic Test: "sometimes they pass and sometimes they fail"); slow.
- **Severity:** major for CI gates.
- **Remediation:** await explicit conditions/events; fake timers; web-first assertions/polling with timeout.
- **Not a finding when:** testing a timeout itself with fake clocks.
- **Architecture:** no.
- **Sources:** https://testsmells.org/pages/testsmells.html ; http://xunitpatterns.com/Test%20Smells.html

### XC-52 Empty / Unknown (assertion-free) test, disabled tests, redundant assertion

- **Signal:** test with no assertion (passes if it doesn't throw); commented-out body; `it.skip`/`xit`/`@Ignore`; `expect(x).toBe(x)` / `assert True`; `expect(promise)` without `await`/`resolves`.
- **Tool coverage:** `jest|vitest:expect-expect` ; `jest|vitest:no-disabled-tests` ; `jest|vitest:valid-expect` ; `jest|vitest:no-standalone-expect` ; `jest:no-commented-out-tests` ; `jest|vitest:no-unnecessary-assertion`/`no-test-return-statement` (jest names; vitest parity partial) ; `sonarjs:S2699 assertions-in-tests` ; `semgrep:python.lang.correctness.test-is-missing-assert.test-is-missing-assert` ; tsDetect Empty Test / Unknown Test / Redundant Assertion / Ignored Test.
- **Why it hurts:** tsDetect: an empty test "can be considered problematic and more dangerous than not having a test case at all" because the runner reports it passing.
- **Severity:** major (blocker if it's counted toward a required test tier).
- **Remediation:** assert the observable outcome; delete or fix skipped tests with an issue link and expiry.
- **Not a finding when:** smoke tests whose assertion is "renders without throwing" _and_ that is the stated contract (still prefer an explicit assertion).
- **Architecture:** no.
- **Sources:** https://testsmells.org/pages/testsmells.html ; https://github.com/jest-community/eslint-plugin-jest/tree/main/docs/rules

### XC-53 Sensitive Equality / Magic Number Test / snapshot overuse

- **Signal:** asserting on `toString()`/`repr`/formatted strings, large snapshots of whole component trees, numeric literals in assertions without meaning.
- **Tool coverage:** `jest|vitest:no-large-snapshots`, `jest:no-interpolation-in-snapshots`, `jest:prefer-snapshot-hint`; tsDetect Sensitive Equality (`toString`) and Magic Number Test ("An assertion method that contains a numeric literal") — the latter is FP-prone.
- **Why it hurts:** Fragile Test (Meszaros: fails "when the SUT is changed in ways that do not affect the part the test is exercising"); snapshot updates rubber-stamped.
- **Severity:** minor.
- **Remediation:** assert on semantic fields; small inline snapshots; named expected values derived from inputs.
- **Not a finding when:** the string format _is_ the contract (serializer, CLI output); literal expected values that are obviously derived (`add(2, 3) === 5`).
- **Architecture:** no.
- **Sources:** https://testsmells.org/pages/testsmells.html ; http://xunitpatterns.com/Test%20Smells.html

### XC-54 Mock overuse / change-detector tests / mocked boundary

- **Signal:** tests asserting call counts/argument order on collaborators rather than outcomes (`toHaveBeenCalledWith` as the only assertion); every dependency mocked including pure ones; mocks of the database/HTTP/queue in tests claiming to verify persistence or contracts; mocks drifting from real signatures (`any`-typed mock factories).
- **Tool coverage:** partial — `jest:no-untyped-mock-factory`, `jest:prefer-called-with`; ratio of interaction to state assertions is judgement.
- **Why it hurts:** SWE-at-Google ch. 13: overuse of mocking "had a tendency to pollute tests with repetitive code that got out of sync with the real implementation and made refactoring difficult"; tests overusing interaction testing are "change-detector tests because they fail in response to any change to the production code, even if the behavior… remains unchanged". A mocked boundary cannot detect a missing column, wrong URL, or wire-shape drift.
- **Severity:** major when the mocked boundary is the risk under test.
- **Remediation:** prefer real implementations, then fakes, then stubs; "Prefer State Testing Over Interaction Testing"; interaction testing only where state testing is impossible or the call _is_ the behaviour (e.g., "email sent"); add an integration test that crosses the boundary.
- **Not a finding when:** verifying a side effect that has no observable state (sending an email via a port); third-party paid APIs behind a contract-tested fake.
- **Architecture:** sometimes (missing test tier for a boundary).
- **Sources:** https://abseil.io/resources/swe-book/html/ch13.html

### XC-55 Coverage theatre — mutation testing as the detector

- **Signal:** high line coverage with weak/absent assertions; tests that execute code but would pass if logic were inverted; surviving mutants on changed lines; coverage measured from broad e2e runs.
- **Tool coverage:** StrykerJS / Stryker.NET / Stryker4s; mutmut/cosmic-ray for Python (`UNVERIFIED` not opened). Stryker states: Killed, Survived ("You're missing a test for it"), No coverage, Timeout, Compile error, Runtime error, Ignored; `mutation score = detected/valid×100`, `score based on covered code = detected/covered×100`. Default `thresholds {high:80, low:60, break:null}` — set `break` to make it a gate.
- **Why it hurts:** SWE-at-Google ch. 11: coverage "only measures that a line was invoked, not what happened as a result" — and recommends measuring coverage from small tests "to avoid coverage inflation".
- **Severity:** major when coverage is the stated evidence for a correctness claim.
- **Remediation:** run incremental mutation testing on changed files; for each surviving mutant add a test that fails on it (mutation lens: "would this still pass if I broke the logic?") — trap: equivalent mutants and timeouts; don't chase 100%.
- **Not a finding when:** surviving mutants in logging/text-only code, or equivalent mutants.
- **Architecture:** no.
- **Sources:** https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/ ; https://stryker-mutator.io/docs/stryker-js/configuration/ ; https://abseil.io/resources/swe-book/html/ch11.html

### XC-56 Test Logic in Production / Hard-to-Test Code

- **Signal:** `if (process.env.NODE_ENV === 'test')`, `isTestMode` flags, test-only exports/constructors in production modules; code that can't be tested without monkeypatching globals/time/network (hidden dependencies).
- **Tool coverage:** partial — grep for `NODE_ENV === 'test'`, `TESTING`; knip `exports` used only by tests (with production mode); judgement.
- **Why it hurts:** Meszaros: "code that is put into production contains logic that should be exercised only during tests"; Hard-to-Test Code: "Code is difficult to test" — usually missing seams.
- **Severity:** major (behaviour differs between test and prod).
- **Remediation:** dependency injection of clock/IO/config; ports & adapters; test doubles injected, not branched.
- **Not a finding when:** a documented test hook behind a build-time flag stripped from production bundles.
- **Architecture:** sometimes (missing seam).
- **Sources:** http://xunitpatterns.com/Test%20Smells.html

## Comment & naming smells

### XC-57 Commented-out code and stale TODOs

- **Signal:** blocks of commented code; `TODO`/`FIXME` without owner/issue; comments describing removed behaviour.
- **Tool coverage:** `sonarjs:S125 no-commented-code` ; `ruff:ERA001` (FP-prone) ; `sonarjs:S1135 todo-tag` ; `ruff:FIX002 line-contains-todo`, `ruff:TD002 missing-todo-author` ; `jest:no-commented-out-tests`.
- **Why it hurts:** Lava Flow (XC-36); readers can't tell if it's meant to come back.
- **Severity:** minor.
- **Remediation:** delete (VCS keeps history); TODOs must carry an issue link.
- **Not a finding when:** code examples in docs comments.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/commented-out-code/ ; https://www.npmjs.com/package/eslint-plugin-sonarjs

### XC-58 Linguistic anti-patterns (name/type/comment/behaviour disagree)

- **Signal:** Arnaoudova's LAs — A1 `get` does more than return the attribute; A2 predicate name (`isX`/`hasX`) but non-boolean return; A3 `set` returns a value; A4 plural type, singular name; B1 comments document a not-implemented condition; B2 validation method doesn't return a result; B3 name suggests a returned object but returns `void`; B4 predicate name but nothing returned; B5 transform method doesn't return the transformed object; B6 single-object type, plural name; B7 `get` doesn't return the corresponding attribute; C1 name and type use antonyms; C2 comment and signature use antonyms; D1 attribute plural type/singular name; D2 predicate attribute name, non-boolean type; E1 single type, plural name; F1/F2 attribute name/type or comment/signature antonyms.
- **Tool coverage:** partial — `@typescript-eslint/naming-convention` can require `is/has/should` prefixes for booleans (not the reverse); LAPD (Eclipse Checkstyle, Java, 2013) is the only dedicated detector; otherwise judgement.
- **Why it hurts:** "when reading for example a method name, one may suppose a behaviour of the method that is different from the actual one" — readers make wrong calls; `getX()` doing I/O hides latency/failure modes.
- **Severity:** minor; major when the name hides a side effect, I/O, or mutation (A1/B5).
- **Remediation:** Change Function Declaration (124) to match behaviour, or change behaviour to match the name (Separate Query from Modifier (306) for A1).
- **Not a finding when:** well-known library conventions (e.g., `Map.get` that computes lazily and is documented).
- **Architecture:** no.
- **Sources:** https://www.veneraarnaoudova.ca/linguistic-anti-pattern-detector-lapd/las/ ; https://www.informit.com/articles/article.aspx?p=2952392

## Open questions / unverified

- Lanza & Marinescu numeric thresholds (FEW 2–5, MANY/short-term-memory 7–8, WMC HIGH 31 / VERY HIGH 47, class LOC HIGH 130, CYCLO HIGH 3.1, AMW AVG 2, WMC AVG 14, NOM AVG 7 / HIGH 10) come from a **secondary** source quoting the book's Java-statistics table (Table 2.2 not opened). The God Class _formula_ is primary (Springer excerpt). Brain Class formula not found. Shotgun Surgery "MANY = 10" is the blog author's choice.
- The CYCLO HIGH = 3.1 value is almost certainly CYCLO/LOC-normalised or an average-per-method statistic; interpretation not confirmed.
- ISO/IEC 25010:2023 sub-characteristics for reliability, security, maintainability, flexibility and the interaction-capability additions were taken from arc42's table (the official preview ends at clause 3.4.4). arc42's table lists _testability_ under flexibility, which looks like a table-row shift (2011 placed testability under maintainability; the 2023 foreword change list does not mention moving it) — treat testability as a maintainability sub-characteristic until the full standard is checked.
- Sonar glossary's "modular" definition appears to be the "tested" text; the SonarQube 10.x Clean Code definition pages now 404.
- Code Climate per-language duplication "mass" thresholds not extracted from the 2023 snapshot.
- Kerievsky smell → refactoring associations are layout-extracted from a two-column PDF; per-smell lists are indicative. Page numbers `[K n]` are from that PDF.
- Playwright ESLint rule name `playwright/no-wait-for-timeout` and mutmut/cosmic-ray (Python mutation testing) were not opened.
- Qlty's complexity doc wording contradicts the Cognitive Complexity white paper on shorthand (see XC-33); Qlty's actual engine behaviour was not tested.
- Fowler 1st-edition smells dropped/renamed in the 2nd edition (Switch Statements → Repeated Switches; Lazy Class → Lazy Element; Inappropriate Intimacy → Insider Trading; Parallel Inheritance Hierarchies and Incomplete Library Class removed; Global Data, Mutable Data, Loops, Mysterious Name added) — inferred by comparing the 2nd-ed chapter list with the Industrial Logic 1st-ed-based reference, not from an explicit Fowler statement.
