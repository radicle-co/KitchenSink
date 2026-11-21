# Root-cause reasoning — from a local smell to the structural decision that produced it

<!-- GENERATED INDEX (scripts/buildIndex.py) — edit the entries below, then regenerate. -->

## Index — scan this, then open only the entries that apply (`rg -n '^### <ID>' <this file>`)

| ID    | Smell                                                                                      | Section                                  | Detected by | Default severity | Architecture |
| ----- | ------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------- | ---------------- | ------------ |
| RC-01 | Change amplification                                                                       | Complexity symptoms and Ousterhout's re… | judgement   | major            | yes          |
| RC-02 | Cognitive load (the "how much must I know" symptom)                                        | Complexity symptoms and Ousterhout's re… | partial     | minor            | no           |
| RC-03 | Unknown unknowns (hidden dependency / obscurity)                                           | Complexity symptoms and Ousterhout's re… | judgement   | major            | yes          |
| RC-04 | Shallow module                                                                             | Complexity symptoms and Ousterhout's re… | partial     | minor            | no           |
| RC-05 | Information leakage (one design decision encoded in several modules)                       | Complexity symptoms and Ousterhout's re… | partial     | major            | yes          |
| RC-06 | Temporal decomposition                                                                     | Complexity symptoms and Ousterhout's re… | judgement   | minor            | no           |
| RC-07 | Overexposure                                                                               | Complexity symptoms and Ousterhout's re… | partial     | minor            | no           |
| RC-08 | Pass-through method / pass-through variable                                                | Complexity symptoms and Ousterhout's re… | partial     | minor            | yes          |
| RC-09 | Repetition as a missing-abstraction signal                                                 | Complexity symptoms and Ousterhout's re… | tool        | ?                | no           |
| RC-10 | Special-general mixture                                                                    | Complexity symptoms and Ousterhout's re… | judgement   | minor            | yes          |
| RC-11 | Conjoined (entangled) methods/modules                                                      | Complexity symptoms and Ousterhout's re… | judgement   | minor            | no           |
| RC-12 | Interface documentation problems as design signals (comment repeats code; implementation … | Complexity symptoms and Ousterhout's re… | judgement   | minor            | no           |
| RC-13 | Naming and describing difficulty as design feedback (vague name; hard to pick name; hard … | Complexity symptoms and Ousterhout's re… | partial     | minor            | yes          |
| RC-14 | Nonobvious code                                                                            | Complexity symptoms and Ousterhout's re… | partial     | minor            | no           |
| RC-15 | Cyclic dependency between components (ADP violation)                                       | Architecture smells (structure-based, c… | tool        | major            | yes          |
| RC-16 | Unstable dependency (SDP violation)                                                        | Architecture smells (structure-based, c… | tool        | minor            | yes          |
| RC-17 | Zone of pain (stable and concrete) / abstractness out of proportion (SAP, D metric)        | Architecture smells (structure-based, c… | judgement   | minor            | yes          |
| RC-18 | Hub-like dependency                                                                        | Architecture smells (structure-based, c… | tool        | major            | yes          |
| RC-19 | God component                                                                              | Architecture smells (structure-based, c… | tool        | minor            | yes          |
| RC-20 | Feature concentration (low component cohesion)                                             | Architecture smells (structure-based, c… | tool        | minor            | yes          |
| RC-21 | Scattered (parasitic) functionality                                                        | Architecture smells (structure-based, c… | tool        | major            | yes          |
| RC-22 | Dense structure                                                                            | Architecture smells (structure-based, c… | tool        | major            | yes          |
| RC-23 | Ambiguous interface (single generic entry point)                                           | Architecture smells (structure-based, c… | partial     | minor            | yes          |
| RC-24 | Connector envy and extraneous adjacent connector                                           | Architecture smells (structure-based, c… | judgement   | minor            | yes          |
| RC-25 | Layer-first top-level decomposition (wrong cut inside one deployable)                      | Architecture smells (structure-based, c… | judgement   | minor            | yes          |
| RC-26 | Hotspot: unhealthy code that is changed often                                              | Behavioural smells (history-based — inv… | tool        | ?                | no           |
| RC-27 | Implicit change coupling (logical coupling without a structural dependency)                | Behavioural smells (history-based — inv… | tool        | major            | yes          |
| RC-28 | Deteriorating complexity trend / refactoring that did not hold                             | Behavioural smells (history-based — inv… | tool        | major            | no           |
| RC-29 | Knowledge island / ownership split that mirrors (or fights) the structure                  | Behavioural smells (history-based — inv… | tool        | minor            | yes          |
| RC-30 | Shared persistence / inappropriate service intimacy (content and common coupling)          | Distributed-system and service-boundary… | judgement   | blocker          | yes          |
| RC-31 | Wrong cuts, megaservice, microservice greedy (service granularity)                         | Distributed-system and service-boundary… | judgement   | major            | yes          |
| RC-32 | Pass-through coupling across services                                                      | Distributed-system and service-boundary… | judgement   | minor            | yes          |
| RC-33 | Synchronous call chains, cyclic service calls and chatty I/O                               | Distributed-system and service-boundary… | partial     | major            | yes          |
| RC-34 | Shared libraries that carry business rules (deploy coupling)                               | Distributed-system and service-boundary… | partial     | minor            | yes          |
| RC-35 | Contract absent: hard-coded endpoints and unversioned APIs                                 | Distributed-system and service-boundary… | partial     | blocker          | yes          |
| RC-36 | State at the wrong altitude (lifted too high, or global for local)                         | Frontend structural smells (React / Rea… | judgement   | minor            | no           |
| RC-37 | Missing server-state layer (server cache managed as client state)                          | Frontend structural smells (React / Rea… | partial     | major            | yes          |
| RC-38 | URL state held in component state                                                          | Frontend structural smells (React / Rea… | judgement   | minor            | no           |
| RC-39 | Memoisation compensating for a wrong component boundary                                    | Frontend structural smells (React / Rea… | judgement   | minor            | no           |
| RC-40 | Props threaded through non-readers (missing composition) — and context as the wrong cure   | Frontend structural smells (React / Rea… | judgement   | minor            | no           |
| RC-41 | Inverted component tree (children driving parents)                                         | Frontend structural smells (React / Rea… | judgement   | minor            | no           |
| RC-42 | Cross-feature imports (slice boundary violated)                                            | Frontend structural smells (React / Rea… | partial     | minor            | yes          |
| RC-43 | Anemic domain model with transaction-script sprawl                                         | Backend structural smells (services, do… | partial     | minor            | yes          |
| RC-44 | Business logic in adapters (smart UI / fat controller / fat handler)                       | Backend structural smells (services, do… | partial     | minor            | yes          |
| RC-45 | Persistence model leaking across layers                                                    | Backend structural smells (services, do… | partial     | major            | yes          |
| RC-46 | Missing aggregate boundary (invariants enforced by callers; multi-object writes without a… | Backend structural smells (services, do… | judgement   | major            | yes          |
| RC-47 | God service (one class/provider owning many use cases)                                     | Backend structural smells (services, do… | partial     | major            | no           |
| RC-48 | Error model absent (the same catch/log/return-null at every call site)                     | Backend structural smells (services, do… | partial     | major            | yes          |
| RC-49 | Shotgun parsing (no parse at the boundary)                                                 | Backend structural smells (services, do… | partial     | major            | yes          |
| RC-50 | Unguarded boundary (an architectural rule with no executable check)                        | Backend structural smells (services, do… | tool        | minor            | yes          |
| RC-51 | Single-chain "5 Whys" that stops at the investigator's knowledge                           | Root-cause technique and safe structura… | judgement   | minor            | no           |
| RC-52 | Structural change without characterization tests or a seam                                 | Root-cause technique and safe structura… | partial     | major            | no           |
| RC-53 | Big-bang structural migration instead of strangler fig / parallel change                   | Root-cause technique and safe structura… | partial     | blocker          | yes          |
| RC-54 | Structural change interleaved with the feature change                                      | Root-cause technique and safe structura… | partial     | minor            | no           |
| RC-55 | Preserving the wrong abstraction (when NOT to escalate a DRY fix)                          | Root-cause technique and safe structura… | partial     | minor            | no           |
| RC-56 | Removing a fence without knowing why it is there (Chesterton + Hyrum)                      | Root-cause technique and safe structura… | partial     | major            | yes          |
| RC-57 | Fixing the smell where it shows instead of where it lives                                  | Root-cause technique and safe structura… | judgement   | ?                | yes          |

<!-- END GENERATED INDEX -->

Domain prefix: `RC-`. This file is the "climb" layer of the corpus. The language files (`TS-`, `NODE-`, `NEST-`,
`REACT-`, `RN-`, `NEXT-`, `PY-`, `MONO-`) say _what is wrong on this line_; `crossCutting.md` (`XC-`) names and
grades the smell. This file answers the question those cannot: **which decision — call pattern, component tree,
data ownership, boundary/contract, architecture, team structure — made that line the easiest thing to write, and
should the fix happen at the line or at the decision?** Entries cross-reference existing IDs instead of repeating
them.

Evidence rule (brief rule 1): every threshold/definition below comes from a source opened this session. Three
load-bearing sources could only be read **secondhand** and are labelled `(secondary)` wherever used: Ousterhout's
red-flag wording (book is print-only; wording via two readers' notes, chapter numbers verifiable — his own
primary text is used for deep/shallow/entanglement), Garcia et al. 2009's four architectural smells (paywalled;
definitions via Sharma's taxonomy and two papers that restate them), and Newman's four coupling types (O'Reilly
chapter 403; page numbers from the publisher's preview PDF TOC, definitions via a reader's notes).

## Scope & sources consulted

| Source                                                                                                                                                                                                           | Version / date                            | URL                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ousterhout, _A Philosophy of Software Design_ — author's book page (2nd ed. changes)                                                                                                                             | updated 2021-11-16                        | https://web.stanford.edu/~ouster/cgi-bin/book.php                                                                                                                                                                                                                    |
| Ousterhout & Martin, _APOSD vs Clean Code_ (primary, both authors) — deep/shallow, entanglement ("conjoined")                                                                                                    | repo main, read 2026-09-13                | https://github.com/johnousterhout/aposd-vs-clean-code                                                                                                                                                                                                                |
| (secondary) Portebois — all APOSD red flags quoted with chapter numbers                                                                                                                                          | 2021-03-04                                | https://notes.portebois.net/2021/03/04/13.html                                                                                                                                                                                                                       |
| (secondary) Sivers — APOSD notes (symptoms of complexity, pass-through variables, context object, "resist the quick fix")                                                                                        | read 2026-09-13                           | https://sive.rs/book/PoSD                                                                                                                                                                                                                                            |
| (secondary) lethain — names the three symptoms "change amplification, cognitive load, unknown unknowns"                                                                                                          | read 2026-09-13                           | https://lethain.com/notes-philosophy-software-design/ (search snippet only — `UNVERIFIED` page body)                                                                                                                                                                 |
| Sharma, Singh, Spinellis, "An Empirical Investigation on the Relationship between Design and Architecture Smells" (EMSE 25(5) 2020) — preprint; Designite detection rules + thresholds; 3,073 C# repos           | preprint                                  | https://www.tusharma.in/preprints/architecture_smells.pdf                                                                                                                                                                                                            |
| Sharma — Taxonomy of software smells (Designite smell list; EAC, SPF definitions)                                                                                                                                | read 2026-09-13                           | https://tusharma.in/smells/DESIGNITE.html ; https://www.tusharma.in/smells/EAC.html ; https://www.tusharma.in/smells/SPF.html                                                                                                                                        |
| Arcan documentation — Architectural smells (CD, GC, HL, UD detection strategies)                                                                                                                                 | docs 2.8.0                                | https://docs.arcan.tech/2.8.0/architectural_smells/                                                                                                                                                                                                                  |
| Arcelli Fontana, Lenarduzzi, Roveda, Taibi, "Are Architectural Smells Independent from Code Smells?" (102 Java projects)                                                                                         | arXiv 1904.11755v1, 2019                  | https://arxiv.org/pdf/1904.11755                                                                                                                                                                                                                                     |
| Le, Karthik, Laser, Medvidovic, "Architectural Decay as Predictor of Issue- and Change-Proneness" (consolidated 11-smell catalogue)                                                                              | ICSA 2021, arXiv 2102.09835               | https://arxiv.org/pdf/2102.09835                                                                                                                                                                                                                                     |
| Zhong et al., "PairSmell: A Novel Perspective Inspecting Software Modular Structure" (co-change of mis-separated pairs)                                                                                          | arXiv 2411.01012                          | https://arxiv.org/pdf/2411.01012                                                                                                                                                                                                                                     |
| R. C. Martin, "Stability" (SDP, SAP, I, A, D, zones of exclusion)                                                                                                                                                | C++ Report 1997, objectmentor via Wayback | https://web.archive.org/web/2011id_/http://www.objectmentor.com/resources/articles/stability.pdf                                                                                                                                                                     |
| R. C. Martin, "Granularity" (REP, CRP, CCP, ADP, "morning after syndrome", breaking cycles)                                                                                                                      | C++ Report 1996, via Wayback              | https://web.archive.org/web/2011id_/http://www.objectmentor.com/resources/articles/granularity.pdf                                                                                                                                                                   |
| dependency-cruiser CLI (`--metrics`, `metrics` reporter, `--affected`, `--reaches`, `--focus`, `--collapse`) + rules reference (`moreUnstable`, `scope: folder`)                                                 | 18.2.0 (npm latest 2026-09-13)            | https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md ; https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md                                                                                                                |
| madge README (`--circular`, `--depends`, `--orphans`, `--leaves`, `--json`)                                                                                                                                      | 8.0.0                                     | https://github.com/pahen/madge                                                                                                                                                                                                                                       |
| Tornhill — code-maat README (git log formats, analyses, defaults) + `logical_coupling.clj` (degree formula)                                                                                                      | master, read 2026-09-13                   | https://github.com/adamtornhill/code-maat ; https://github.com/adamtornhill/code-maat/blob/master/src/code_maat/analysis/logical_coupling.clj                                                                                                                        |
| Tornhill — maat-scripts `complexity_calculations.py`, `git_complexity_trend.py` (whitespace complexity)                                                                                                          | master                                    | https://github.com/adamtornhill/maat-scripts                                                                                                                                                                                                                         |
| CodeScene docs — Technical Debt/Hotspots, Change Coupling, Complexity Trends, Knowledge Distribution                                                                                                             | © 2026                                    | https://codescene.io/docs/guides/technical/hotspots.html ; https://codescene.io/docs/guides/technical/change-coupling.html ; https://codescene.io/docs/guides/technical/complexity-trends.html ; https://codescene.io/docs/guides/social/knowledge-distribution.html |
| Taibi, Lenarduzzi, Pahl, "Microservices Anti-Patterns: A Taxonomy" (27 practitioners, 20 anti-patterns, harmfulness 0–10)                                                                                        | arXiv 1908.04101 (book chapter 2020)      | https://arxiv.org/pdf/1908.04101                                                                                                                                                                                                                                     |
| Newman, _Building Microservices_ 2nd ed. — publisher preview (ch. 1 "The Distributed Monolith"; TOC for coupling types pp. 41–49)                                                                                | O'Reilly 2021 preview PDF                 | https://api.pageplace.de/preview/DT0400.9781492033998_A49444743/preview-9781492033998_A49444743.pdf                                                                                                                                                                  |
| (secondary) Lebrero — notes on Newman 2nd ed. ch. 2 coupling types                                                                                                                                               | 2023-01-24                                | https://danlebrero.com/2023/01/24/building-microservices-second-edition-designing-fine-grained-systems-summary/                                                                                                                                                      |
| Microsoft Azure Architecture Center — Performance antipatterns index; Chatty I/O                                                                                                                                 | read 2026-09-13                           | https://learn.microsoft.com/en-us/azure/architecture/antipatterns/ ; https://learn.microsoft.com/en-us/azure/architecture/antipatterns/chatty-io/                                                                                                                    |
| Kent C. Dodds — "State Colocation will make your React app faster"; "Colocation"; "Application State Management with React"                                                                                      | read 2026-09-13                           | https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster ; https://kentcdodds.com/blog/colocation ; https://kentcdodds.com/blog/application-state-management-with-react                                                                          |
| Dan Abramov — "Before You memo()"                                                                                                                                                                                | overreacted.io                            | https://overreacted.io/before-you-memo/                                                                                                                                                                                                                              |
| TanStack Query docs — Overview ("server state is totally different"); "Does TanStack Query replace Redux…"                                                                                                       | latest, read 2026-09-13                   | https://tanstack.com/query/latest/docs/framework/react/overview ; https://tanstack.com/query/latest/docs/framework/react/guides/does-this-replace-client-state                                                                                                       |
| TanStack Router docs — Search Params ("the OG state manager")                                                                                                                                                    | latest                                    | https://tanstack.com/router/latest/docs/framework/react/guide/search-params                                                                                                                                                                                          |
| react.dev — Passing Data Deeply with Context ("Before you use context"); Sharing State Between Components ("single source of truth")                                                                             | read 2026-09-13                           | https://react.dev/learn/passing-data-deeply-with-context ; https://react.dev/learn/sharing-state-between-components                                                                                                                                                  |
| Feature-Sliced Design — Layers reference ("import rule on layers")                                                                                                                                               | read 2026-09-13                           | https://feature-sliced.design/docs/reference/layers                                                                                                                                                                                                                  |
| Fowler bliki — CodeSmell, AnemicDomainModel, TellDontAsk, DDD_Aggregate, BoundedContext, PresentationDomainDataLayering, MonolithFirst, StranglerFigApplication (2024), ParallelChange (Sato), LegacySeam (2024) | dates in entries                          | https://martinfowler.com/bliki/ (individual URLs in entries)                                                                                                                                                                                                         |
| Fowler, _P of EAA_ catalog — Transaction Script, Domain Model, Service Layer (Stafford)                                                                                                                          | 2003                                      | https://martinfowler.com/eaaCatalog/transactionScript.html ; https://martinfowler.com/eaaCatalog/serviceLayer.html                                                                                                                                                   |
| Cockburn, "Hexagonal (Ports & Adapters) Architecture"                                                                                                                                                            | read 2026-09-13                           | https://alistair.cockburn.us/hexagonal-architecture/                                                                                                                                                                                                                 |
| Alexis King, "Parse, don't validate"                                                                                                                                                                             | 2019-11-05                                | https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/                                                                                                                                                                                                  |
| Sandi Metz, "The Wrong Abstraction"                                                                                                                                                                              | 2016-01-20                                | https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction                                                                                                                                                                                                           |
| Feathers, _Working Effectively with Legacy Code_ ch. 4 excerpt — Seams, Seam Types, enabling point                                                                                                               | InformIT                                  | https://www.informit.com/articles/article.aspx?p=359417&seqNum=2 ; https://www.informit.com/articles/article.aspx?p=359417&seqNum=3                                                                                                                                  |
| Characterization test (term coined by Feathers)                                                                                                                                                                  | Wikipedia, read 2026-09-13                | https://en.wikipedia.org/wiki/Characterization_test                                                                                                                                                                                                                  |
| Kent Beck — "make the change easy (warning: this may be hard), then make the easy change" (2012-09-25); "Change" (cost(change) decomposition)                                                                    | X; Tidy First? substack                   | https://x.com/KentBeck/status/250733358307500032 ; https://tidyfirst.substack.com/p/change                                                                                                                                                                           |
| G. K. Chesterton, _The Thing_ (1929) — fence passage, via the American Chesterton Society                                                                                                                        | read 2026-09-13                           | https://www.chesterton.org/taking-a-fence-down/                                                                                                                                                                                                                      |
| Hyrum's Law                                                                                                                                                                                                      | hyrumslaw.com                             | https://www.hyrumslaw.com/                                                                                                                                                                                                                                           |
| Conway's Law — Mel Conway's own page                                                                                                                                                                             | read 2026-09-13                           | https://www.melconway.com/Home/Conways_Law.html                                                                                                                                                                                                                      |
| Five whys — Ohno attribution + criticism list (Minoura; Card, BMJ Qual Saf 2017)                                                                                                                                 | Wikipedia + PubMed 27590189               | https://en.wikipedia.org/wiki/Five_whys ; https://pubmed.ncbi.nlm.nih.gov/27590189/                                                                                                                                                                                  |

**Empirical validation of the commands in §(b).** Every script and command in §(b) was run on 2026-09-13 against a
920-commit TypeScript npm/Turborepo monorepo (22+ workspace packages). The false positives it produced are recorded
inline — they are the most useful part of the procedure, because they are exactly the noise an agent would
otherwise report as findings.

---

## (a) Symptom → likely root cause ("compensating smells")

A **compensating smell** is code that exists to make up for a missing or misplaced structural element. Its
defining property: fixing it _at the site_ is locally correct and structurally wrong, because the next change
re-creates it elsewhere. Read the table left→right; the right column is the hypothesis to test with §(b), not a
verdict.

| Local symptom (observable in a diff)                                                                                   | Likely structural root cause                                                                                      | Test that confirms/refutes                                                                         | Entry                           |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- |
| `useMemo`/`React.memo`/`useCallback` added to stop re-renders                                                          | State lives too high, or the component boundary mixes the part that changes with the part that doesn't            | Can the state move down, or the static subtree be passed as `children`? (Abramov)                  | RC-39, RC-36                    |
| `useEffect` + `useState` fetching, hand-rolled `isLoading/error/refetch`, cache invalidation by event bus              | No server-state layer; server cache treated as client state                                                       | Grep for repeated fetch-in-effect shapes across screens; does the app have a query cache?          | RC-37 (+`REACT-06`, `REACT-21`) |
| `useEffect` that copies props/URL into state, "sync" effects, effect chains                                            | Two sources of truth for one fact (state duplicated at two altitudes, or URL state mirrored into component state) | Name the single owner of the fact; is it URL, server, form, or UI?                                 | RC-36, RC-38 (+`REACT-01/03`)   |
| `useImperativeHandle`/`ref.current.open()` from a parent, child calling `props.onChange` from an effect                | Ownership inverted: the parent should own the state and pass it down                                              | Who decides the value? If the parent does, lift it; if the child does, stop calling up             | RC-41 (+`REACT-05/16`)          |
| A prop threaded through ≥3 components that never read it                                                               | Missing composition (`children`/slots), not a missing context                                                     | Would `<Layout><Posts posts/></Layout>` remove the layers? (react.dev)                             | RC-40 (+`REACT-27`)             |
| The same `as SomeType` / `?.` / `if (!x) throw` at every read of external data                                         | No parse at the boundary ("shotgun parsing")                                                                      | Count call sites that re-check the same field; is there one schema parse at ingress?               | RC-49 (+`TS-17`)                |
| `try { … } catch (e) { log(e); return null }` repeated across call sites; callers then null-check                      | No error model: errors not defined, classified or translated at one layer                                         | Count distinct catch shapes for the same failure; is there a typed error/`Result` at the boundary? | RC-48 (+`NODE-13/14/15`)        |
| Service method reads an entity, checks fields, mutates fields, saves (`getX/setX` choreography); entity has no methods | Anemic domain model: business rules live in transaction scripts, so each script re-implements invariants          | Grep for the same invariant (`status === 'x' && …`) in ≥2 services                                 | RC-43                           |
| Controller/handler/route component contains `if` business rules, calls ORM directly                                    | Smart UI / adapter contaminated with domain logic; no application-service/port                                    | Could a CLI/queue consumer invoke the same use-case without copying code? (Cockburn)               | RC-44 (+`NEST-09`, `NEXT-18`)   |
| ORM row / Drizzle-Prisma inferred type imported in a controller, React component or client package                     | Persistence model used as domain and wire model                                                                   | `rg` the persistence type's import sites by layer                                                  | RC-45 (+`NEST-17`, `TS-18`)     |
| Constructor with many injected services; a `utils`/`helpers`/`common` file every feature imports                       | God service / hub-like module / missing abstraction for a concern                                                 | Fan-in × fan-out of the module (depcruise metrics); does it have >1 reason to change in git log?   | RC-47, RC-18                    |
| Two files (often in different packages) change together in most commits with no import between them                    | Implicit contract / duplicated knowledge across a boundary (Mo et al.'s "implicit cross-module dependency" class) | Change-coupling ≥ 30% with no static edge; what knowledge do both encode?                          | RC-27, RC-05                    |
| A small feature PR touches web + mobile + client + service + schema in lockstep                                        | Information leakage along the whole stack: one decision (a field, a rule) encoded in N places                     | Is there one authoritative representation that the others derive from?                             | RC-01, RC-05 (+`XC-08`)         |
| Flag parameter / `mode` / `variant` added to an existing helper to handle "one more case"                              | The wrong abstraction being preserved (Metz) or special-general mixture (Ousterhout)                              | Does each caller actually execute a different subset? Inline and see                               | RC-55, RC-10                    |
| `forwardRef()` in NestJS, lazy `require`, import moved inside a function to "fix" `undefined`                          | Dependency cycle between components; the boundary is drawn wrong                                                  | `depcruise`/`madge --circular`; which knowledge is shared by both sides?                           | RC-15 (+`NEST-01`, `TS-31`)     |
| Sleep/retry/poll added so B sees A's write; `setTimeout(0)` ordering                                                   | Temporal decomposition or synchronous call chain where ownership of the write is split                            | Who owns the state change? Can the reader subscribe or the writer return it?                       | RC-06, RC-33                    |
| Service calls another service's DB/table, or two services' migrations touch the same table                             | Shared persistence / content coupling; wrong service cut                                                          | Map each table to exactly one owning service                                                       | RC-30, RC-31                    |
| A value passed through service B only so service C can use it                                                          | Pass-through coupling; B's contract is carrying C's knowledge                                                     | Could A call C, or could B own the concept? (Newman)                                               | RC-32, RC-08                    |
| `// NOTE: must call init() first`, `// keep in sync with X` comments                                                   | Temporal/value connascence that the structure should enforce                                                      | Can the type or constructor make the wrong order unrepresentable?                                  | RC-06, RC-50 (+`XC-46`)         |
| "Layer that must contain no business logic" guarded only by a README/ADR sentence                                      | Unguarded boundary — it will fill with logic (Cockburn)                                                           | Is there an executable check (dep rule, test) that fails on violation?                             | RC-50                           |
| Hotspot keeps coming back after a "cleanup" PR                                                                         | Root cause not addressed — complexity slipped back (CodeScene: "more often than not")                             | Complexity trend of the file over the refactor date                                                | RC-28, RC-57                    |

---

## (b) Procedure — climbing from line to architecture

Climb only as far as the evidence pulls you. At each rung: **ask the question, run the command, record what a
diff alone can and cannot see, and stop when the cause is found or the next rung is not implicated.** Rungs are
cheap-to-expensive; do not skip to rung 7 on a vibe (Fowler: a smell "doesn't _always_ indicate a problem …
You have to look deeper").

Global rules while climbing:

- **Two-or-more-sites rule.** A defect at one site is a local bug. The same shape at ≥2 independent sites (or one
  site plus a "keep in sync" comment) is evidence of a missing structural element. Count before you escalate.
- **Collocation is not causation.** Large-sample evidence says architecture smells mostly do **not** sit in the same
  files as the code smells that accompany them (Sharma et al.: "the majority of smell pairs do not collocate";
  Arcelli Fontana et al.: architectural smells "cannot be derived from code smells", and "removing code debt does
  not necessarily imply the reduction/removal of architectural debt"). So after fixing the line, look _away_
  from it — at the graph and the history.
- **Every commit-history metric is distorted by mega-commits.** A squash of thousands of files couples everything
  to everything. On the validation repo the newest commit touched **3,781 files**; this is why code-maat's
  `--max-changeset-size` defaults to 30 — keep a cap, never remove it.

### Rung 0 — the line (is it just a bug?)

- **Question:** is the line wrong in isolation, with its surrounding contract correct?
- **Commands:** the language file's rule (e.g. `npx eslint --rule …`), `git blame -w -C -C -L <a>,<b> -- <file>`
  (who/when/which commit), `git log -L <a>,<b>:<file>` (the line's own history).
- **A diff can see:** everything needed. **Stop here** if the fix changes no signature, adds no parameter/flag,
  and the same shape does not occur elsewhere (`rg -n '<distinctive shape>'` returns this site only).

### Rung 1 — the unit (function/component/class)

- **Question:** is the unit deep (simple interface, much hidden) or shallow/entangled? Does it have one reason to
  change?
- **Commands:** cognitive complexity (`sonarjs/cognitive-complexity`, threshold per `TS-33`); count parameters,
  boolean/mode props (`REACT-26`); `git log --format='%h %s' -- <file> | head -40` — do the commit subjects
  describe _one_ concern or several? (several = Divergent Change `XC-07`).
- **A diff can see:** a new flag/param, a new branch, a new `mode`. **Cannot see:** whether callers now need to
  read the implementation to use it (Ousterhout's abstraction test) — open two callers.

### Rung 2 — the module/file and its neighbours

- **Question:** does knowledge in this unit also live in a sibling (information leakage, duplicated rule)?
- **Commands:**
    - `rg -n --type ts '<the literal/rule/field name>'` — every other place that encodes the same decision.
    - `npx depcruise src --no-config --do-not-follow node_modules --focus '<module-regex>' --output-type text` — the
      module's direct neighbours (verified).
    - `madge --depends <file> <root>` — who depends on it (flag from madge 8.0.0 README; not run).
- **A diff can see:** a literal or rule being added in a second place. **Cannot see:** the first place — search
  for it.

### Rung 3 — the call graph / component tree

- **Question:** is the call pattern wrong (pass-through, chatty, temporal chain, child driving parent), or is
  state/data owned at the wrong node?
- **Commands:**
    - Reverse reach: `npx depcruise src --no-config --do-not-follow node_modules --reaches '<module-regex>' --output-type text`
      (all transitive dependents — blast radius of changing the unit; verified).
    - Change-scoped: `npx depcruise src --affected main --output-type text` (modules changed since `main` plus
      everything that can reach them). Validation note: run it **from the git root** with a root-relative path
      (`npx depcruise packages/x/src --affected HEAD~1 …`); run from inside a package directory it printed **nothing**
      (silent empty result, exit 0) — an empty `--affected` is not evidence of "no impact".
    - Cycles: `npx depcruise src --config` with `no-circular`, or `madge --circular --extensions ts,tsx <root>`.
    - React ownership: `rg -n 'useImperativeHandle|forwardRef|\.current\.[a-zA-Z]+\(' <app>` and
      `rg -n -U 'useEffect\(\(\) => \{\s*(set[A-Z]|props\.on[A-Z])' <app>` (effects that set state or call up).
    - N+1 / chatty: `rg -n -U 'for (await )?\(.*\)\s*\{[^}]*await .*(find|get|fetch|query|select)' <src>` then
      confirm with query logs (Azure: "A large number of small requests made by an application instance to the
      same data store").
- **A diff can see:** a new call site added in a loop; a prop added to intermediates that don't read it; an
  effect that sets state. **Cannot see:** the owner — trace upward to the component/service that _decides_ the
  value.

### Rung 4 — data ownership

- **Question:** for this fact, who is the single source of truth — and does every other holder _derive_ from it?
  Classify first: **server cache, URL state, form state, UI state** (frontend); **aggregate/table owner**
  (backend); **contract owner** (cross-service).
- **Commands:**
    - Who writes a table: `rg -n -i "(insert into|update|delete from)\s+\"?<table>" <repo>` and ORM
      `rg -n '<tableIdentifier>' --glob '!**/migrations/**'` grouped by package
      (`… | cut -d/ -f1-3 | sort | uniq -c`).
    - Who declares a wire shape: `rg -n 'interface <Name>|type <Name> =|z\.object' <repo>` — more than one
      declaration of the same shape = two owners (`TS-18`).
    - Frontend: `rg -n 'useSearchParams|useQuery|useState' <feature>` for the same field name.
- **A diff can see:** a second declaration or a second writer being added. **Cannot see:** the missing owner —
  that is the finding.

### Rung 5 — boundary/contract (package, service, public API)

- **Question:** does this change cross a boundary it should not, or does the boundary carry knowledge that belongs
  on one side?
- **Commands:**
    - Folder/package stability:
      `npx depcruise src --no-config --do-not-follow node_modules --exclude '__tests__' --metrics --output-type metrics`
      (columns `N Ca Ce I (%)`). SDP/cycle rules in a config:
      `forbidden: [{ name: 'SDP', severity: 'warn', from: {}, to: { moreUnstable: true } }, { name: 'SDP-folder', severity: 'warn', scope: 'folder', from: {}, to: { moreUnstable: true } }, { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } }]`,
      `options: { tsPreCompilationDeps: true }`; run with the same `--do-not-follow`/`--exclude` flags. Module-level
      I is misleading on its own: "A folder can contain a highly instable module (e.g. an index.js barrel …), but be
      stable itself" (rules reference).
      Validation notes (dependency-cruiser 18.2.0 + typescript installed beside it — without `typescript` in the
      same folder, `.ts` files are silently not cruised and every report is empty; check `depcruise --info`):
      (1) **without `--do-not-follow node_modules`** the SDP and `no-circular` rules fired 45 times, almost all
      inside `node_modules` (e.g. a cycle inside `zod`'s own build) — pure noise; (2) `moreUnstable` has **no delta**,
      so a 25%→29% edge is reported the same as 0%→100% — ignore edges under ~20 points (Arcan's rule has an explicit
      `delta` for this reason); (3) `scope: "folder"` reports **child-folder → parent-folder** edges (`src/resolution → src`)
      because the parent is an entry point with I=100%; read those as "subfolder imports its package root/barrel",
      a different question from SDP.
    - Package-level Martin metrics for a JS workspace (verified script, no install):
        ```python
        # pkg_instability.py — run at repo root. Ca/Ce over workspace-internal deps; I = Ce/(Ca+Ce); SDP edges.
        import json, subprocess, collections
        files = subprocess.run(['git','ls-files','*package.json'], capture_output=True, text=True).stdout.split()
        pk = {}
        for f in files:
            if 'node_modules' in f: continue
            try: j = json.load(open(f))
            except Exception: continue
            if 'name' in j:
                pk[j['name']] = {k for s in ('dependencies','devDependencies','peerDependencies') for k in j.get(s, {})}
        names = set(pk); ce = {n: len(d & names) for n, d in pk.items()}
        ca = collections.Counter(x for d in pk.values() for x in d & names)
        I = {n: (ce[n] / (ca[n] + ce[n]) if ca[n] + ce[n] else 0) for n in names}
        for n in sorted(names, key=lambda n: (-ca[n], n))[:15]: print(f'Ca={ca[n]:3d} Ce={ce[n]:3d} I={I[n]:.2f} {n}')
        for n in sorted(names):
            for d in sorted(pk[n] & names):
                if I[d] > I[n]: print(f'SDP: {n} (I={I[n]:.2f}) -> {d} (I={I[d]:.2f})')
        ```
        Validation note: on the 69-manifest workspace it found **0 of 193** internal edges violating SDP, while the
        top-Ca packages were lint/test/format _config_ packages. Two lessons: (1) exclude tooling-config packages
        (they are stable-by-nature and inflate Ca); (2) package-level I is a **weak discriminator** in a layered
        workspace — the coupling problems live at **module/folder** level, so run depcruise `--metrics` with
        `scope: "folder"` before concluding the boundary is healthy.
    - Cross-boundary co-change (history crosses the boundary even when imports don't): the `coupling.py` script in
      rung 6, restricted to two packages' pathspecs.
- **A diff can see:** an import across a package, a new exported symbol, a changed wire type. **Cannot see:** the
  consumers that depend on unpromised behaviour (Hyrum) — search consumers before narrowing anything.

### Rung 6 — history: hotspots, change coupling, ownership, trends

- **Question:** is this code where the organisation _keeps paying_? Do things that should be independent change
  together? Is knowledge concentrated in one person?
- **Raw log (code-maat input, verbatim formats):**
  `git log --all --numstat --date=short --pretty=format:'--%h--%ad--%aN' --no-renames --after=YYYY-MM-DD > logfile.log`
  then `java -jar code-maat-1.0.4-standalone.jar -l logfile.log -c git2 -a <revisions|coupling|soc|entity-ownership|main-dev|age|entity-churn|fragmentation>`.
  Exclude vendor with pathspec `-- . ":(exclude)vendor/"`. Aggregate to architectural components with `-g
mapping.txt` (`regex => group`). Defaults: `--min-revs 5`, `--min-shared-revs 5`, `--min-coupling 30`,
  `--max-changeset-size 30`.
- **Change frequency (no install):**
  `git log --no-merges --since=12.month --format=format: --name-only -- '<pathspec>' | grep -v '^$' | sort | uniq -c | sort -rn | head -30`
- **Hotspots = frequency × complexity (verified, no install):**
    ```python
    # hotspots.py — Tornhill whitespace complexity (maat-scripts complexity_calculations.py): leading
    # indentation / INDENT = logical depth, summed over non-blank lines. Rank within ONE repo only.
    # usage: INDENT=2 python3 hotspots.py 12.month 'src/**/*.ts' ':!**/__tests__/**'
    import os, re, sys, subprocess, collections
    since, spec = sys.argv[1], sys.argv[2:] or ['.']
    indent = int(os.environ.get('INDENT', '4'))
    log = subprocess.run(['git','log','--no-merges',f'--since={since}','--format=','--name-only','--',*spec],
                         capture_output=True, text=True, check=True).stdout
    revs = collections.Counter(l for l in log.splitlines() if l.strip())
    rows = []
    for path, n in revs.items():
        if not os.path.isfile(path): continue
        try: lines = [l for l in open(path, encoding='utf-8').read().split('\n') if l.strip()]
        except (UnicodeDecodeError, OSError): continue
        wscx = sum(len(re.match(r'^[ \t]*', l).group().replace('\t', ' ' * indent)) / indent for l in lines)
        rows.append((n * wscx, n, int(wscx), len(lines), path))
    for _, n, wscx, loc, path in sorted(rows, reverse=True)[:15]:
        print(f'revs={n:3d} wscx={wscx:6d} loc={loc:5d}  {path}')
    ```
    Validation note — **pseudo-hotspots** the agent must discard before reporting: i18n message catalogues,
    shared type-declaration files (`*.types.ts`), generated files, lockfiles, fixtures. They churn because every
    feature touches them, not because they are hard to change. A large e2e/test _helper_ file ranking first is
    **not** a false positive — test infrastructure is a real maintenance hotspot.
- **Change coupling (verified, code-maat semantics, no install):**
    ```python
    # coupling.py — degree = shared_revs / mean(revs_a, revs_b) * 100 (logical_coupling.clj);
    # changesets > 30 files skipped; min revs 5, min shared 5, min degree 30% (code-maat defaults).
    # usage: python3 coupling.py 2026-01-01 'src/**/*.ts' ':!**/__tests__/**' ':!**/*.test.*'
    import sys, subprocess, itertools, collections
    since, spec = sys.argv[1], sys.argv[2:] or ['.']
    MAX_CHANGESET, MIN_REVS, MIN_SHARED, MIN_DEGREE = 30, 5, 5, 30
    log = subprocess.run(['git','log','--no-merges','--no-renames',f'--since={since}','--format=--%h',
                          '--name-only','--',*spec], capture_output=True, text=True, check=True).stdout
    changesets, cur = [], None
    for line in log.splitlines():
        if line.startswith('--'): cur = set(); changesets.append(cur)
        elif line.strip(): cur.add(line.strip())
    revs, shared = collections.Counter(), collections.Counter()
    for cs in changesets:
        if len(cs) > MAX_CHANGESET: continue
        revs.update(cs); shared.update(itertools.combinations(sorted(cs), 2))
    rows = [(int(100*n/((revs[a]+revs[b])/2)), n, a, b) for (a, b), n in shared.items()
            if min(revs[a], revs[b]) >= MIN_REVS and n >= MIN_SHARED and 100*n/((revs[a]+revs[b])/2) >= MIN_DEGREE]
    for d, n, a, b in sorted(rows, reverse=True)[:20]: print(f'{d:3d}% shared={n:3d}  {a}  <->  {b}')
    ```
    Validation notes — classify every pair before reporting:
    1. **Source ↔ its own test** (`X.tsx ↔ __tests__/X.test.tsx`): _expected_. Without the test-exclusion pathspec
       the top 15 pairs on the validation repo were almost all this class at 90–100%. Always exclude tests.
    2. **Platform siblings** (`X.tsx ↔ X.native.tsx`) and **barrel ↔ module** (`index.ts ↔ model.ts`): expected by
       the repo's file conventions; report only if the _logic_ (not markup) is duplicated.
    3. **Layer pair inside one feature** (`x.service.ts ↔ x.dal.ts`): expected for a vertical slice.
    4. **Everything else is a candidate finding** — especially pairs in _different packages with no import
       between them_. Worked example from the validation run: a mobile screen and a web container for the same
       feature co-changed at **91% over 11 commits** with no static edge — the duplicated-knowledge class
       (behaviour/orchestration re-implemented per platform instead of living in one shared hook/model). Likewise two
       sibling forms at 76% and two Lambda handlers at 83%.
- **Ownership / knowledge islands:**
  `git log --no-merges --since=24.month --format='%aN' -- <path> | sort | uniq -c | sort -rn` (share of the top
  author; code-maat `-a main-dev` / `entity-ownership` for per-file tables). Bus-factor-1 on a hotspot is
  CodeScene's "Knowledge Island in Complex Hotspot".
- **Complexity trend (did a refactor hold?):**
  `for c in $(git log --format=%h --reverse -- <file>); do printf '%s %s ' "$c" "$(git show -s --format=%ad --date=short $c)"; git show "$c:<file>" | awk -v i=4 'NF{gsub(/\t/,"    "); match($0,/^[ ]*/); s+=RLENGTH/i} END{print s}'; done`
  (whitespace complexity per revision; the shape matters, not the number — CodeScene). Validation note: a
  squash-merged history shows a **step**, not a trend (the validation file went 1475 → 2803 in one squash commit),
  so on squash-merge repos run the trend on the unsquashed feature branch or treat the step as one data point.
- **A diff can see:** nothing on this rung. History is the only way to see Divergent Change, Shotgun Surgery
  and implicit contracts _as they actually happen_. Run it before calling a hotspot "fine".

### Rung 7 — architecture and organisation

- **Question:** is the decomposition itself wrong (layer-first top level, wrong service cut, shared database,
  distributed monolith), or does the structure mirror a team boundary that no longer fits?
- **Commands:** `npx depcruise src --collapse 2 --output-type dot | dot -T svg > arch.svg` (folder-level graph);
  `turbo run build --graph=graph.html` (package graph, see `MONO` cheat-sheet); code-maat `-g` component mapping
    - `-a coupling` (co-change **between components**); per-team ownership of co-changing components
      (CodeScene: change coupling across team boundaries = "coordination costs … might soar"); read the ADRs
      touching the boundary (Chesterton — RC-56).
- **A diff can see:** a PR that must touch ≥2 deployables/packages to ship one behaviour. That single observation is
  the strongest diff-visible architectural signal; record it and escalate.
- **Escalate to the architecture agent** with: the rung-6 numbers, the rung-4 ownership map, and a named
  structural move (RC entries' Remediation). Do not propose a re-architecture from a single diff.

---

## (c) Local fix vs structural fix — decision guide

**Default to the local fix.** A structural change is justified only when the evidence says the local fix will
be re-made. Apply the criteria in order; the first that fires decides.

| #   | Criterion (observable)                                                                                            | Decision                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The defect is correctness/security **and** a local fix fully removes it                                           | **Local fix now**, even if structure is also wrong — ship the fix, file the structural finding separately. Never hold a correctness fix hostage to a refactor.                                                       |
| 2   | The shape exists at exactly one site, no "keep in sync" comment, not a hotspot (rung 6)                           | **Local fix.** A structural move here is speculative generality (`XC-15`).                                                                                                                                           |
| 3   | Same knowledge at ≥2 sites that **change for the same reason** (co-change evidence or same rule)                  | **Structural** — give the knowledge one owner (RC-05). Rule of three is a heuristic for _syntactic_ duplication; _semantic_ duplication of a business rule/contract across a boundary is already 2 too many.         |
| 4   | Same-looking code at ≥2 sites that change for **different** reasons (divergent commit subjects, different owners) | **Leave duplicated.** "Duplication is far cheaper than the wrong abstraction" (Metz). Merging creates special-general mixture (RC-10).                                                                               |
| 5   | The fix would add a flag/mode/param to an existing shared abstraction                                             | **Stop.** Inline the abstraction into callers first (Metz's "the fastest way forward is back"), then re-extract if a real shared concept remains (RC-55).                                                            |
| 6   | The file is a hotspot (top decile revs × complexity) **and** the fix adds a branch                                | **Structural, but staged**: preparatory refactor in its own commit(s), then the feature (Beck — RC-54). Low-churn code with the same smell: local fix (CodeScene: low health outside hotspots "has lower priority"). |
| 7   | The change crosses a persisted schema, wire contract, public package export or security boundary                  | **Design the boundary now** (reversal is expensive) — but **migrate by expand/contract** (RC-53), never a flag day.                                                                                                  |
| 8   | A cycle, SDP violation or hub is _introduced_ by this diff                                                        | **Block the introduction** (cheap now); existing ones elsewhere → finding with baseline (`depcruise --baseline` / `--ignore-known`), not a blocker.                                                                  |
| 9   | The structural cause is organisational (team boundary, ownership split)                                           | **Local fix + escalate**; code agents cannot fix Conway effects (RC-29).                                                                                                                                             |
| 10  | You cannot yet say why the current structure exists                                                               | **Local fix + investigate** (Chesterton, RC-56). Structural removal without the reason is how deliberate trade-offs get "fixed" back into incidents.                                                                 |

**Escalation thresholds (use in every entry's Severity).** Raise a structural finding to **major** when any one
holds: the knowledge appears at ≥2 sites across a package boundary; the change crosses a wire/persisted/auth
contract; the file is in the repo's top-10 hotspots; change coupling ≥ 50% with no static dependency. Raise to
**blocker** only when the diff _introduces_ the structural defect across a contract (a second writer to a table, a
cycle between deployables, a client redeclaring a wire type) — pre-existing structure is never a blocker for an
unrelated diff.

**The structural move must name its migration path.** Acceptable paths: preparatory refactoring in separate
commits; characterization tests + seam (Feathers); parallel change (expand → migrate → contract); strangler fig
(route new behaviour to the new structure, move old behaviour piece by piece). A structural recommendation
without one of these is incomplete.

---

## Complexity symptoms and Ousterhout's red flags (design level)

Ousterhout's frame is the root-cause frame this file uses throughout: complexity is "anything related to the
structure of a software system that makes it hard to understand and modify", it "is caused by dependencies and
obscurity", and red flags are "signs that a piece of code is probably more complicated than it needs to be" whose
remedy is to "look for an alternate design that eliminates the problem" (Sivers notes, secondary). RC-01..RC-03
are **symptoms** (what the next engineer experiences); RC-04..RC-14 are **red flags** (what you can see in code).

### RC-01 Change amplification

- **Signal:** "A seemingly simple change requires code modifications in many different places" (Sivers notes,
  secondary). Operational: a single-behaviour PR/commit touches ≥ N files across ≥2 packages _for the same
  decision_ (a field, enum member, status, rule) — `git show --stat <sha>`; or `rg -n '<decision literal>'`
  returns ≥3 unrelated modules; or rung-6 change coupling ≥30% between files with no import edge.
- **Tool coverage:** none — judgement. Partial: code-maat `-a coupling`/`soc` and `coupling.py` (§b rung 6)
  measure it historically; `XC-08` Shotgun Surgery names the smell; no static tool sees it in one diff.
- **Why it hurts:** maintainability/modifiability — every future change to that decision costs N edits and one
  missed edit is a production inconsistency (web accepts a value the service rejects).
- **Severity:** major when the N sites span a package, wire or persistence boundary; minor inside one module.
- **Remediation:** find the one decision being amplified and give it one owner — Encapsulate Variable / Extract
  Module / derive-from-schema (`TS-18`); across services, one contract owner and generated/derived consumers. Trap:
  "centralising" into a shared `constants.ts` that everything imports creates a hub (RC-18) without hiding
  anything — the goal is that _most_ sites stop needing the knowledge, not that they import it.
- **Not a finding when:** the sites are deliberately redundant for a reason recorded in an ADR (e.g. defence in
  depth: client validation + server validation of the same rule, where the server is authoritative), or the
  change is a cross-cutting rename with no semantic decision (mechanical churn).
- **Architecture:** yes when it spans deployables — the boundary is carrying leaked knowledge; escalate with the
  co-change numbers.
- **Sources:** https://sive.rs/book/PoSD ; https://github.com/adamtornhill/code-maat

### RC-02 Cognitive load (the "how much must I know" symptom)

- **Signal:** to make or review a change you must open ≥3 other files to understand one call; the unit's
  interface doc/JSDoc is shorter than what callers demonstrably need (callers repeat pre/post-checks); "APIs with
  many methods, global variables, inconsistencies, and dependencies between modules" (Sivers notes).
- **Tool coverage:** partial — `sonarjs/cognitive-complexity` measures _intra_-function understandability only
  (`TS-33`, `XC-33`); inter-module load (what you must know _outside_ the function) is judgement.
- **Why it hurts:** readability, reviewability, onboarding; errors of omission — the reviewer approves what they
  could see and the defect lives in what they needed to know but could not find.
- **Severity:** minor alone; major when combined with a hotspot (RC-26).
- **Remediation:** deepen the module (RC-04): move the knowledge callers keep re-deriving _behind_ the interface;
  pull defaults into the module ("Classes should 'do the right thing' without being explicitly asked"). Trap:
  "Sometimes an approach that requires more lines of code is actually simpler, because it reduces cognitive load"
  — do not optimise for line count.
- **Not a finding when:** the domain is intrinsically complex and the code mirrors it faithfully (essential
  complexity); the load is in a rarely-changed module.
- **Architecture:** no (unit/module design).
- **Sources:** https://sive.rs/book/PoSD ; https://github.com/johnousterhout/aposd-vs-clean-code

### RC-03 Unknown unknowns (hidden dependency / obscurity)

- **Signal:** a change that "seems to work" breaks something with no import, type or test linking them: shared
  global/module state, string-keyed events, env-var names, DB triggers, cache keys, queue message shapes, file
  formats, ordering assumptions. Grep: `rg -n "emit\(['\"]|on\(['\"]|process\.env\[['\"]|localStorage\.(get|set)Item\(['\"]"`
  then check whether producer and consumer share a typed symbol.
- **Tool coverage:** none — judgement; partial via change coupling with no static edge (RC-27) and via incident
  history.
- **Why it hurts:** "Of the three manifestations of complexity, unknown unknowns are the worst … You won't find
  out about it until bugs appear after you make a change" (Sivers notes). Tests pass; production breaks.
- **Severity:** major when the hidden dependency crosses a process/deploy boundary (queue, cache, DB, env).
- **Remediation:** make the dependency _visible_: a typed contract/schema imported by both sides; a named
  constant module for keys; a contract test at the boundary; replace string events with typed commands. Trap:
  documenting it in a README is obscurity with a footnote — the next change still can't _find_ it.
- **Not a finding when:** the indirection is the point (plugin registry, pub/sub between bounded contexts) **and**
  the message contract is typed and versioned.
- **Architecture:** yes when it crosses deployables — an implicit contract; escalate.
- **Sources:** https://sive.rs/book/PoSD

### RC-04 Shallow module

- **Signal:** interface ≈ implementation: wrapper functions/classes whose body is one call with the same
  parameters; a hook that only renames `useQuery` args; a service method that forwards to a repository method of
  the same name; >1 exported function per 5–10 lines of implementation; callers need to read the body to use it.
  Ousterhout: "A shallow module is one whose interface is complicated relative to the functionality it provides"
  (ch. 4.6, secondary wording) and, primary: "Eventually, the point is reached where someone using the method
  needs to understand every aspect of its implementation. Such methods are usually pointless."
- **Tool coverage:** partial — `XC-18` Middle Man / `XC-14` Lazy Element are the Fowler names; no tool computes
  interface-vs-functionality ratio. Judgement.
- **Why it hurts:** each shallow layer adds an interface to learn and a hop to trace, hiding nothing; "decomposition
  can be taken too far … the interfaces often become more complex" (primary).
- **Severity:** minor; major when the shallow layer is a _mandated_ layer (every call must go controller → service →
  repository with no logic at any hop) producing systematic pass-throughs.
- **Remediation:** Inline Function / Inline Class / Remove Middle Man; or deepen — move the knowledge callers
  duplicate into it. Trap: Clean-Code-style splitting to hit a line count; Ousterhout and Martin explicitly
  disagree here — the tie-breaker is whether the child can be read without the parent and vice versa.
- **Not a finding when:** the wrapper is an **Adapter/Anti-corruption layer** over a third-party or unstable API
  (it hides the _vendor_, which is real information), a test seam (RC-52), or a published package entry point.
- **Architecture:** no, unless it is a layer rule (then the layering itself is the root cause — RC-25).
- **Sources:** https://notes.portebois.net/2021/03/04/13.html ; https://github.com/johnousterhout/aposd-vs-clean-code

### RC-05 Information leakage (one design decision encoded in several modules)

- **Signal:** "the same knowledge is used in multiple places, such as two different classes that both understand
  the format of a particular type of file" (ch. 5.2, secondary). TS/React/Node shapes: the same Zod/regex/limit in
  client and server; a status enum's meaning re-encoded as `if (s === 'x')` in UI, service and SQL; a URL path
  template built in two packages; web screen and mobile screen each implementing the same orchestration.
  Detection: `rg -n '<literal|regex|field>'`; change coupling between the holders (rung 6 — on the validation repo,
  a web container ↔ mobile screen pair at 91%).
- **Tool coverage:** partial — `jscpd`/`sonarjs:no-identical-functions` catch _textual_ copies (`TS-34`); leakage
  of the same _decision_ in different code is judgement; connascence of Meaning/Algorithm (`XC-45`).
- **Why it hurts:** change amplification (RC-01) and silent divergence — the copies drift and the system accepts
  in one layer what it rejects in another.
- **Severity:** major across a package/wire boundary; minor within a module.
- **Remediation:** one authoritative representation, others _derive_ (schema → types, shared model/hook consumed
  by both platform views, generated client). "Information hiding can often be improved by making a class slightly
  larger" — merge the two holders when they are one concept. Trap: a shared package used by both is only a fix if
  it _owns_ the decision; a dumping-ground `shared/utils` just moves the leak (`MONO-23`).
- **Not a finding when:** the duplication is across a trust boundary on purpose (client UX validation mirrors
  server authority), or the two holders are different bounded contexts that happen to use the same word with
  different meaning (RC-31 — "polysemes" like Customer/Product per Fowler's BoundedContext).
- **Architecture:** yes when the decision crosses services/packages — contract ownership; escalate.
- **Sources:** https://notes.portebois.net/2021/03/04/13.html ; https://sive.rs/book/PoSD ; https://martinfowler.com/bliki/BoundedContext.html

### RC-06 Temporal decomposition

- **Signal:** "execution order is reflected in the code structure: operations that happen at different times are
  in different methods or classes" (ch. 5.3, secondary). Shapes: `readConfig()` / `parseConfig()` /
  `validateConfig()` / `applyConfig()` each knowing the file format; `step1…step4` modules; a React wizard whose
  steps each re-derive the draft shape; Lambda handlers split `extract → transform → load` where each knows the
  record schema; comments like `// must be called after init()`.
- **Tool coverage:** none — judgement (connascence of Execution, `XC-46`).
- **Why it hurts:** "If the same knowledge is used at different point in execution, it gets encoded in multiple
  places, resulting in information leakage" (secondary) — plus order bugs when a new caller skips a step.
- **Severity:** minor; major if the ordering is enforced only by comment/convention across modules.
- **Remediation:** decompose by _knowledge_, not by time: one module owns the format (read+parse+validate) and
  exposes the parsed value; enforce order with types (a `ParsedConfig` that only `parse()` can produce — typestate)
  or a constructor that does the setup. Trap: renaming the steps without moving the shared knowledge.
- **Not a finding when:** the stages are genuinely independent (each consumes a published, typed artifact of the
  previous stage — a pipeline with a contract), or a durable workflow engine owns the order.
- **Architecture:** sometimes — a service split along pipeline stages is the service-level version (RC-31).
- **Sources:** https://notes.portebois.net/2021/03/04/13.html

### RC-07 Overexposure

- **Signal:** "the API for a commonly used feature forces users to learn about other features that are rarely
  used" (ch. 5.7, secondary). Shapes: a hook/component whose required props include rarely-used knobs; an options
  object with no defaults; a client that must pass `retry`, `timeout`, `cache` on every call; a service method
  requiring a transaction/entity manager for the common case.
- **Tool coverage:** partial — `max-params`/`sonarjs` parameter-count (`XC-04`); "required vs rarely used" is
  judgement.
- **Why it hurts:** cognitive load on every caller; callers copy the knob values → information leakage.
- **Severity:** minor.
- **Remediation:** defaults inside the module; split common-case entry point from the advanced one; context
  object passed at construction (Sivers: "The context is available everywhere, but it only appears as an explicit
  argument in constructors"). Trap: a "flexible" config bag that exposes _more_.
- **Not a finding when:** the parameter is safety-relevant and must be chosen consciously (e.g. idempotency key,
  tenant id).
- **Architecture:** no (becomes contract design if the API is published).
- **Sources:** https://notes.portebois.net/2021/03/04/13.html ; https://sive.rs/book/PoSD

### RC-08 Pass-through method / pass-through variable

- **Signal:** method "does nothing except pass its arguments to another method, usually with the same API"
  (ch. 7.1, secondary); a parameter threaded through intermediate functions/components that never read it (React:
  prop drilling through non-users — RC-40; Node: `logger`/`tx`/`requestId` threaded through five signatures).
- **Tool coverage:** partial — `XC-18` Middle Man; no lint rule detects "parameter only forwarded". Judgement;
  grep a parameter name across a call chain.
- **Why it hurts:** pass-through methods indicate "there is not a clean division of responsibility between the
  classes"; pass-through variables "force all of the intermediate methods to be aware of their existence"
  (Sivers notes).
- **Severity:** minor; major when every layer of a mandated layering is a pass-through (root cause RC-25).
- **Remediation:** redistribute responsibility (merge or split the classes so each has a distinct role); for
  variables, a context object (Node `AsyncLocalStorage`, React context/composition, DI-scoped provider). Trap: a
  global to avoid threading — "Global variables almost always create other problems."
- **Not a finding when:** a **dispatcher** ("uses its arguments to select one of several other methods to invoke"
  — explicitly excepted), a decorator adding cross-cutting behaviour, or an adapter translating types.
- **Architecture:** yes at service level — pass-through _coupling_ (RC-32).
- **Sources:** https://notes.portebois.net/2021/03/04/13.html ; https://sive.rs/book/PoSD

### RC-09 Repetition as a missing-abstraction signal

- **Signal:** "If the same piece of code (or code that is almost the same) appears over and over again, that's a
  red flag that you haven't found the right abstractions" (ch. 9.4, secondary). This entry adds the root-cause
  question to `XC-02`/`TS-34`: _what concept is unnamed?_
- **Tool coverage:** `jscpd`, `sonarjs:no-identical-functions`, `qlty` duplication (`XC-02`) find the copies;
  whether they share a reason to change is judgement (rung 6 co-change answers it).
- **Why it hurts:** see RC-01/RC-05.
- **Severity:** by knowledge, not by line count — see §(c) criteria 3–4.
- **Remediation:** name the concept, then extract; confirm shared reason-to-change first. Trap: extraction by
  shape → wrong abstraction (RC-55).
- **Not a finding when:** the copies change for different reasons (Metz), or they are tests (DAMP).
- **Architecture:** only when copies span boundaries (RC-05).
- **Sources:** https://notes.portebois.net/2021/03/04/13.html ; https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction

### RC-10 Special-general mixture

- **Signal:** "a general-purpose mechanism also contains code specialized for a particular use of that mechanism"
  (ch. 9.5, secondary). Shapes: `if (feature === 'recipes')` inside a generic list/table/HTTP client; a shared
  `useForm` with a branch for one screen; a base repository with `if (entity instanceof Order)`; a design-system
  component with a prop named after one product screen.
- **Tool coverage:** none — judgement. Grep generic modules for domain nouns: `rg -n -i '<domain noun>' <shared pkg>`.
- **Why it hurts:** "future modifications to the use case are likely to require changes to the underlying mechanism
  as well" (secondary) — the general module becomes a hotspot owned by every feature.
- **Severity:** minor; major in a published/shared package (every consumer inherits the special case).
- **Remediation:** push the specialisation up to the caller (strategy/callback/slot/render prop); keep the
  mechanism ignorant of use cases; "Separate special-purpose code from general-purpose code" (Sivers). Trap:
  turning each special case into a config flag (flag soup) instead of removing it.
- **Not a finding when:** the "general" module has exactly one caller and is not published — then it is not
  general; inline it.
- **Architecture:** yes for shared packages/design systems — ownership of the mechanism.
- **Sources:** https://notes.portebois.net/2021/03/04/13.html ; https://sive.rs/book/PoSD

### RC-11 Conjoined (entangled) methods/modules

- **Signal:** "if you can't understand the implementation of method without also understanding the implementation
  of another … if two pieces of code are physically separated, but each can only be understood by looking at the
  other" (ch. 9.8, secondary); primary: "If you've ever found yourself flipping back and forth between the
  implementations of two methods as you read code, that's a red flag". Shapes: helper that only works if invoked
  in one caller's context; hook + component that share implicit invariants about each other's state; a
  `utils/x.ts` used by exactly one module that must be read with it.
- **Tool coverage:** none — judgement; change coupling at function level (CodeScene X-Ray) is the only metric.
- **Why it hurts:** "Entangled methods are hard to read because the information you need to have in your head at
  once isn't all in the same place" (primary).
- **Severity:** minor.
- **Remediation:** "Entangled methods can usually be improved by combining them so that all the code is in one place"
  (primary) — Inline Function, move the helper next to (or into) its only caller; split only where each part is
  readable alone. Trap: Martin's counter-position (order methods to compensate) — Ousterhout: ordering does not fix
  entanglement.
- **Not a finding when:** the extracted piece is general-purpose (usable by other callers without knowing the
  parent) — that is healthy decomposition.
- **Architecture:** no.
- **Sources:** https://github.com/johnousterhout/aposd-vs-clean-code ; https://notes.portebois.net/2021/03/04/13.html

### RC-12 Interface documentation problems as design signals (comment repeats code; implementation contaminates interface)

- **Signal:** comment repeats code — "the comment uses the same words that make up the name" (ch. 13.2,
  secondary); implementation contaminates interface — interface docs "describe implementation details that aren't
  needed in order to use the thing" (ch. 13.5, secondary), e.g. JSDoc on an exported function explaining its
  internal cache or SQL.
- **Tool coverage:** none — judgement (`XC-24` comments-as-deodorant covers the smell side).
- **Why it hurts:** the root-cause signal is the second one: if the _interface_ doc must describe internals, the
  internals are leaking through the interface (callers depend on them — Hyrum, RC-56).
- **Severity:** minor; major when the leaked detail is load-bearing for callers (ordering, caching, retry).
- **Remediation:** move implementation notes inside the body; if callers truly need the detail, it is part of the
  interface — make it explicit (types/params) or hide it properly. Trap: deleting the comment and leaving the
  dependency.
- **Not a finding when:** the interface doc states a _behavioural contract_ (complexity, idempotency, thread-safety)
  — those are interface, not implementation.
- **Architecture:** no.
- **Sources:** https://notes.portebois.net/2021/03/04/13.html

### RC-13 Naming and describing difficulty as design feedback (vague name; hard to pick name; hard to describe)

- **Signal:** vague names ("broad enough to refer to many different things": `data`, `info`, `manager`, `handle`,
  `process`, `utils`, `common`, `helpers`); hard-to-pick names ("hard to find a simple name … that creates a clear
  image"); hard-to-describe ("If you find it difficult to write such a comment, that's an indicator that there might
  be a problem with the design") — ch. 14.3, 14.3, 15.3 (secondary). Grep:
  `rg -n -i 'export (function|const|class) \w*(Manager|Helper|Util|Handler|Processor|Data|Info)\b'`; a JSDoc with
  "and"/"or" joining unrelated responsibilities; a PR description that needs a paragraph to say what a function does.
- **Tool coverage:** partial — `XC-01` Mysterious Name, `XC-58` linguistic anti-patterns; the design inference is
  judgement.
- **Why it hurts:** the name is the cheapest detector of low cohesion: an unnameable unit usually has more than one
  responsibility or no clear one.
- **Severity:** minor; raise when the unit is a hotspot or exported.
- **Remediation:** treat as a design finding: split by responsibility until each part has a precise name, or merge
  fragments until the whole is nameable. Trap: renaming to a longer vague name (`RecipeDataManagerService`).
- **Not a finding when:** the name follows a framework convention (`*.controller.ts`, `handler` for a Lambda entry).
- **Architecture:** yes for packages/folders named `common`/`shared`/`utils` (`MONO-23`) — no owning concept.
- **Sources:** https://notes.portebois.net/2021/03/04/13.html

### RC-14 Nonobvious code

- **Signal:** "If the meaning and behavior of code cannot be understood with a quick reading" (ch. 18.2,
  secondary): event handlers whose effect is in another module, magic numbers, reused variables with changing
  meaning, control flow via exceptions, generic containers (`[string, number, boolean]` tuples) crossing modules.
- **Tool coverage:** partial — `sonarjs` cognitive complexity, magic-number rules (`XC-45` Meaning), `TS-11`
  boolean soup; judgement for "obvious to a reader".
- **Why it hurts:** "Complexity is more apparent to readers than writers" (Sivers) — the author's review cannot
  detect it; a fresh reader can.
- **Severity:** minor; major on hotspots.
- **Remediation:** make the important thing visible — named types instead of tuples, names instead of comments,
  one place for the effect. Trap: adding explanatory comments to code that could be restructured.
- **Not a finding when:** idiomatic framework code that is obvious to anyone who knows the framework.
- **Architecture:** no.
- **Sources:** https://notes.portebois.net/2021/03/04/13.html ; https://sive.rs/book/PoSD

---

## Architecture smells (structure-based, component/package level)

Granularity matters: Sharma et al. separate implementation smells (a method), design smells (classes and their
relationships) and architecture smells ("components and their interactions") and note that same-named smells at
different granularities differ — a class cycle is "cyclically-dependent modularization", a component cycle is
"cyclic dependency". In JS/TS read **component = folder or workspace package**. Two findings govern how to use
this section: design smells **cause** architecture smells in time-series (Granger) analysis and co-trend strongly
at project level (ρ = 0.85, 3,073 C# repos), yet the pairs mostly **do not collocate**, and in 102 Java projects
architectural smells "cannot be derived from code smells". Local cleanup slows new architecture smells; it does
not remove existing ones.

### RC-15 Cyclic dependency between components (ADP violation)

- **Signal:** "two or more architecture components depend on each other directly or indirectly" (Sharma et al.;
  Designite explores cycles with a 5-hop cutoff). JS/TS: folder A imports folder B and B imports A (possibly via a
  barrel); workspace package A depends (incl. `devDependencies`) on B and B on A; NestJS `forwardRef()`; function-
  local `require`/dynamic `import()` added to break an init-order crash.
- **Tool coverage:** `dependency-cruiser:no-circular` (module) and the same rule with `scope: "folder"` (folder
  cycles that don't exist at module level — rules reference example `main/index.js → utl/helper.js → main/utl.js`);
  `madge --circular`; `import-x:no-cycle`; Arcan CD (units and containers; Sedgewick-Wayne DFS default, Tarjan SCC,
  Laval-Falleri shortest cycles). Package-level: `MONO-15`. Partial: _which_ edge is the wrong one is judgement.
- **Why it hurts:** Martin: with a cycle, packages "must always be released at the same time. They have, in effect,
  become one large package" and "just to run a simple unit test of one of your classes" you must build everything
  ("the morning after syndrome"). Arcan: "hard to release, hard to maintain, hard to reuse in isolation". Sharma:
  the most frequent architecture smell in their corpus.
- **Severity:** major; blocker when the diff introduces a cycle between deployables/published packages or into
  `^build` ordering.
- **Remediation:** Martin's two moves — (1) Dependency Inversion: put an interface in the depended-upon side's
  consumer and implement it on the other, reversing one edge; (2) "Create a new package that both … depend upon"
  and move the shared classes there. JS adds (3) move the shared _type-only_ knowledge to a lower module and
  `import type` it. Trap: `forwardRef`/lazy import/barrel reshuffle hides the cycle from the runtime but keeps the
  coupling; a new "shared" package that becomes a hub (RC-18).
- **Not a finding when:** a type-only cycle erased at compile time _inside one cohesive folder_ (still worth a
  note, not a finding); a test file importing a sibling that imports a test util.
- **Architecture:** yes — component boundary; escalate if across packages.
- **Sources:** https://www.tusharma.in/preprints/architecture_smells.pdf ; https://docs.arcan.tech/2.8.0/architectural_smells/ ; https://web.archive.org/web/2011id_/http://www.objectmentor.com/resources/articles/granularity.pdf ; https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md

### RC-16 Unstable dependency (SDP violation)

- **Signal:** a component depends on one less stable than itself. Instability `I = Ce/(Ca+Ce)`, "I=0 indicates a
  maximally stable package. I=1 indicates a maximally instable package"; SDP: "A package should only depend upon
  packages that are more stable than it is" (Martin). Detection: depcruise `to: { moreUnstable: true }`
  (`scope: "folder"`); Arcan UD on containers with a `delta`; `pkg_instability.py` (§b rung 5) for workspace
  packages. Typical JS shape: a heavily-imported `shared`/`core` package importing from a feature package or an
  app; a domain module importing a UI/framework module.
- **Tool coverage:** `dependency-cruiser` `moreUnstable` (no delta); Arcan UD (Java/C/C++ targets — JS support
  `UNVERIFIED`); Designite UD (C#/Java). Partial: the metric counts edges, not volatility.
- **Why it hurts:** changes ripple _upward_ into the stable, widely-depended-upon package: "Any package that we
  expect to be volatile should not be depended upon by a package that is difficult to change! Otherwise the volatile
  package will also be difficult to change" (Martin). Arcan: "favors change ripple effects".
- **Severity:** minor for a small delta (see validation note in §b: 25%→29% is noise); major when a
  near-0-I package depends on a near-1-I package.
- **Remediation:** invert (stable side defines an interface/port, volatile side implements it); move the
  depended-on piece down into the stable package; split the volatile package so the stable part stops depending on
  the churn. Trap: faking stability by adding dependents (Ca) — I goes down, volatility doesn't.
- **Not a finding when:** the "unstable" target is actually non-volatile — Martin: the metric is "positional"
  stability, and some concrete packages rarely change. Confirm volatility with rung-6 churn before reporting.
  dependency-cruiser also warns "it's not 'bad' to be a 100% Instable module … A CLI or GUI component typically only
  depends on other modules".
- **Architecture:** yes — dependency direction; escalate when it crosses packages.
- **Sources:** https://web.archive.org/web/2011id_/http://www.objectmentor.com/resources/articles/stability.pdf ; https://docs.arcan.tech/2.8.0/architectural_smells/ ; https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md

### RC-17 Zone of pain (stable and concrete) / abstractness out of proportion (SAP, D metric)

- **Signal:** SAP: "Packages that are maximally stable should be maximally abstract. Instable packages should be
  concrete." `A = abstractClasses / totalClasses`; main sequence `A + I = 1`; `D' = |A + I − 1|` in [0,1] ("Any
  package that has a D value that is not near zero can be reexamined"). Zone near (0,0) = stable + concrete = rigid;
  near (1,1) = abstract nobody uses. JS/TS approximation (no tool computes A for TS): ratio of exported
  `interface`/`type`/abstract-class/port declarations to exported implementations in a package, paired with I
  from §b rung 5. Typical zone-of-pain shapes: a widely-imported `db/schema` or ORM-model package; a shared
  `utils` of concrete functions every package imports and that keeps changing.
- **Tool coverage:** none for TS/JS (dependency-cruiser computes I only, not A). Judgement with the approximation.
- **Why it hurts:** Martin: a (0,0) package "cannot be extended because it is not abstract. And it is very difficult
  to change because of its stability" — and he names the canonical case: "Database Schemas are notoriously volatile
  and are highly depended upon."
- **Severity:** minor as a metric; major when rung-6 shows the (0,0) package is also a hotspot (volatile + stable =
  the worst place).
- **Remediation:** put a port/abstraction in the stable position and move concrete, volatile code to less-depended
  packages; for schemas, stop letting every layer import the persistence model (RC-45). Trap: adding interfaces with
  one implementation purely to move A — speculative generality (`XC-15`).
- **Not a finding when:** a concrete but **non-volatile** utility — Martin: "Consider a 'string' package … it may
  still be non-volatile. Such packages are harmless in the (0,0) zone since they are not likely to be changed."
  Martin also: "I would deeply regret it if anybody suddenly decided that all their designs must unconditionally be
  conformant to 'The Martin Metrics'."
- **Architecture:** yes — escalate the schema-as-hub case.
- **Sources:** https://web.archive.org/web/2011id_/http://www.objectmentor.com/resources/articles/stability.pdf

### RC-18 Hub-like dependency

- **Signal:** a component with many incoming **and** outgoing dependencies. Arcan: "too many" = dynamic threshold
  `Max(Threshold_System, Threshold_Benchmark)` over `TotalDeps(x) = FanIn(x) + FanOut(x)` (benchmark 100+ Qualitas
  Corpus systems). JS shape: `utils/index.ts`, `common` module, a root `store`/`context`, an `api.ts` that imports
  every endpoint module and is imported by every screen. Detection: depcruise `--metrics` rows with both Ca and Ce
  in the top decile.
- **Tool coverage:** Arcan HL (units + containers); Designite "Hub-like Modularization" (design level). For JS:
  depcruise metrics + judgement (no rule).
- **Why it hurts:** Arcan: "centralizes logic; is a unique point of failure; favors change ripple effects".
- **Severity:** major when it is also a hotspot; minor otherwise.
- **Remediation:** split by reason-to-change (Extract Module per concern); invert so consumers depend on narrow
  interfaces; delete intra-package barrels that turn a folder into a hub (`TS-30`, `MONO-22`). Trap: splitting into
  N modules that all still import each other (dense structure, RC-22).
- **Not a finding when:** a composition root / DI container / app shell / router — high fan-in and fan-out _is its
  job_ and it holds no business logic.
- **Architecture:** yes — modularity principle.
- **Sources:** https://docs.arcan.tech/2.8.0/architectural_smells/

### RC-19 God component

- **Signal:** a component "excessively large either in terms of LOC or number of classes"; Designite: >30 classes or
    > 27,000 LOC (Lippert & Roock); Arcan: data-driven `LinesOfCode = Max(LOC_System, LOC_Benchmark)`. JS: a package or
    > top folder holding most of the app's modules (`src/components` with 200 files; an `app` package with all
    > features).
- **Tool coverage:** Designite/Arcan (not JS); for JS `find <dir> -name '*.ts*' | wc -l` + `cloc`/`wc -l`; judgement
  on thresholds (27k LOC was set for Java/C#).
- **Why it hurts:** Arcan: "centralizes logic; has low cohesion within; has increasing complexity"; every team works
  in it (delivery contention, Newman).
- **Severity:** minor as a size fact; major combined with feature concentration (RC-20) or multi-team ownership
  (RC-29).
- **Remediation:** split along feature/bounded-context lines (vertical slices), each internally layered (RC-25);
  migrate with strangler-style moves per feature. Trap: splitting by technical type (components/hooks/services
  packages) — a wrong cut (RC-31).
- **Not a finding when:** large but cohesive (one concern, low LCC) and owned by one team.
- **Architecture:** yes.
- **Sources:** https://www.tusharma.in/preprints/architecture_smells.pdf ; https://docs.arcan.tech/2.8.0/architectural_smells/

### RC-20 Feature concentration (low component cohesion)

- **Signal:** "a component realizes more than one architectural concerns or features … the component is not
  cohesive". Designite: `LCC = disconnected sub-graphs / total classes` over intra-component relationships; smell if
  LCC > 0.2 (chosen empirically from 0, 0.1, 0.2, 0.3). JS approximation: within one folder/package, build the
  internal import graph (depcruise JSON, `--include-only '^<dir>'`) and count weakly-connected components; many
  islands = several features sharing a folder.
- **Tool coverage:** Designite (C#/Java). JS: depcruise `--output-type json` + a graph-components count; judgement.
- **Why it hurts:** unrelated features share a release unit, owners and a namespace; changes to one feature risk
  another; the package name cannot describe it (RC-13).
- **Severity:** minor; major for a published/shared package.
- **Remediation:** Extract Module per island; name each by its concern. Trap: islands that are intentionally
  independent leaf utilities in a `lib` package — see below.
- **Not a finding when:** a deliberately-flat collection of independent utilities with a clear shared theme and no
  business logic (e.g. a date-formatting package) — islands are expected there.
- **Architecture:** yes.
- **Sources:** https://www.tusharma.in/preprints/architecture_smells.pdf

### RC-21 Scattered (parasitic) functionality

- **Signal:** "multiple components are responsible for realizing the same high-level concern" (Designite; Sharma) —
  and in Garcia's original, "additionally, some of those components are responsible for orthogonal concerns" (via
  Sharma taxonomy, secondary). Designite's operational proxy: a method accessing ≥2 external components, occurring
  more than once. JS shapes: authorization checks re-implemented in controllers, guards, services and UI; audit
  logging in every handler; feature flags read ad hoc across layers; money/unit conversion in several packages.
- **Tool coverage:** Designite (C#/Java). JS: `rg` the concern's vocabulary across packages
  (`rg -l -i 'isAdmin|hasPermission|scopes' | cut -d/ -f1-3 | sort | uniq -c`); judgement.
- **Why it hurts:** Le et al.'s consolidated catalogue: "Changing a feature modifies multiple system parts"; violates
  separation of concerns.
- **Severity:** major for security/money concerns (one missed site is a vulnerability/incorrect charge); minor for
  logging.
- **Remediation:** give the concern one home — a policy/specification module called from one layer, middleware/
  interceptor/decorator for cross-cutting concerns, a value object for units. Trap: centralising _mechanism_ (a
  helper) while the _decision_ is still made at each site.
- **Not a finding when:** defence in depth with one authoritative check and explicitly-redundant fast-fail checks
  elsewhere (documented as such).
- **Architecture:** yes — separation of concerns; escalate security instances.
- **Sources:** https://www.tusharma.in/smells/SPF.html ; https://www.tusharma.in/preprints/architecture_smells.pdf ; https://arxiv.org/pdf/2102.09835

### RC-22 Dense structure

- **Signal:** "components have excessive and dense dependencies without any particular structure"; Designite: average
  degree of the component graph `2|E|/|V|` > 5 (from 7±2, tried 5–9); at most one instance per repository. JS:
  from `depcruise --collapse 2 --output-type json` (folder graph) compute 2E/V.
- **Tool coverage:** Designite; JS by computation from depcruise JSON; judgement on the threshold for JS folder
  granularity (`UNVERIFIED` that 5 transfers).
- **Why it hurts:** no layering to reason with — any change can reach anything; a precursor of Big Ball of Mud
  (`XC-43`).
- **Severity:** major (system-level trend), never a per-diff blocker.
- **Remediation:** introduce and _enforce_ layering/slice rules (FSD import rule, depcruise `forbidden` path rules,
  `MONO-17`), baseline existing violations (`depcruise --baseline`) and ratchet. Trap: drawing a layer diagram with no
  executable rule (RC-50).
- **Not a finding when:** a small repo (few components) where average degree is high by arithmetic.
- **Architecture:** yes.
- **Sources:** https://www.tusharma.in/preprints/architecture_smells.pdf

### RC-23 Ambiguous interface (single generic entry point)

- **Signal:** "a component offers only a single, general entry-point into the component … typically appears in
  event-based publish-subscribe systems where interactions are not explicitly modeled and multiple components
  exchange event messages via a shared event bus" (Sharma, citing Garcia). Designite: one public method **and** ≥5
  classes. JS shapes: `dispatch(action: { type: string; payload: unknown })` as a module's only API;
  `handle(event: any)` with a `switch (event.type)`; `emitter.emit('x', data)` between modules; a Lambda `handler`
  that routes on a string field; `POST /rpc { op, args }`.
- **Tool coverage:** Designite (C#/Java); JS partial — `@typescript-eslint/no-explicit-any` on the payload,
  exhaustive-switch checks (`TS-12`); the architectural judgement (hidden interactions) is manual.
- **Why it hurts:** the real interface (which messages, which shapes, who consumes them) is invisible to types and
  tools → unknown unknowns (RC-03), dead or missing handlers go unnoticed.
- **Severity:** minor for an internal reducer with a typed discriminated union; major when payloads are untyped
  strings crossing packages/services.
- **Remediation:** make interactions explicit: a discriminated union of typed commands/events exported as the
  contract; per-operation functions; schema-validated messages (`TS-17`). Trap: a typed union that is still one
  `unknown` payload per member.
- **Not a finding when:** a deliberate Command/Mediator/Redux-style dispatcher whose message set is a closed, typed
  union with exhaustive handling — that _is_ explicit modelling.
- **Architecture:** yes when it is the integration style between components/services.
- **Sources:** https://www.tusharma.in/preprints/architecture_smells.pdf

### RC-24 Connector envy and extraneous adjacent connector

- **Signal:** Extraneous Adjacent Connector — "two connectors of different types are used to link a pair of
  components" (Sharma taxonomy citing Garcia et al. 2009, secondary): e.g. service A calls B over HTTP **and** also
  consumes B's events **and** reads B's table; a React feature talks to the same backend via a query hook **and** a
  websocket store **and** direct `fetch`. Connector Envy — `UNVERIFIED` wording (primary paywalled; only the name is
  confirmed by Arcelli Fontana et al.): a component that itself implements interaction concerns (communication,
  conversion, coordination) that belong in a connector — e.g. business services that hand-roll HTTP retries,
  serialization and routing to other services.
- **Tool coverage:** none — judgement (Arcan/Designite do not list these as detected smells in the docs opened).
- **Why it hurts:** EAC: two paths with different consistency/failure semantics between the same pair, so ordering
  and staleness bugs appear only in production; connector envy: the component cannot be reused or tested without
  the network concerns.
- **Severity:** minor; major when the two connectors can deliver conflicting state (sync read + async event).
- **Remediation:** choose one interaction style per component pair (or document why two: command via RPC, state via
  events) and put interaction mechanics in an adapter/client (Hexagonal adapter, generated client, gateway). Trap:
  wrapping both connectors in one facade that still exposes both semantics.
- **Not a finding when:** CQRS-style split by intent (commands synchronous, notifications asynchronous) that is
  explicit in the contract.
- **Architecture:** yes — connector design; escalate.
- **Sources:** https://www.tusharma.in/smells/EAC.html ; https://arxiv.org/pdf/1904.11755

### RC-25 Layer-first top-level decomposition (wrong cut inside one deployable)

- **Signal:** top-level folders by technical role — `controllers/ services/ repositories/ models/ dtos/` or
  `components/ hooks/ store/ api/ types/` — so one feature change touches every top-level folder. Detection:
  `git log --since=6.month --format=%h --no-merges -- <app>/src | while read c; do git show --name-only --format= $c -- <app>/src | cut -d/ -f<depth of first folder under src> | sort -u | wc -l; done | sort -n | uniq -c`
  (histogram of distinct first-level folders touched per commit; verified). In a layer-first tree, most commits
  touching ≥3 first-level folders = the cut follows layers, not features. In a feature-first tree the same histogram
  should be dominated by 1 — a long tail (commits touching 15–22 feature folders) points at cross-cutting renames,
  squash commits, or a shared concept with no owner.
- **Tool coverage:** none — judgement; FSD's "import rule on layers" and depcruise path rules enforce a chosen shape
  but don't detect the wrong one.
- **Why it hurts:** Fowler: presentation-domain-data layering "should only be applied at a relatively small
  granularity … once any of these layers gets too big you should split your top level into domain oriented modules
  which are internally layered." Layer-first at scale = change amplification per feature, and it invites teams
  split by layer (Fowler calls separating teams by these layers an AntiPattern).
- **Severity:** minor in a small app; major once most feature commits touch ≥3 layer folders.
- **Remediation:** re-cut into feature/domain modules (vertical slices), each internally layered; FSD layers
  `app → pages → widgets → features → entities → shared` with "A module (file) in a slice can only import other
  slices when they are located on layers strictly below"; migrate one feature at a time (strangler inside the
  repo). Trap: moving files without moving ownership of the knowledge — a `features/recipes` folder that still
  imports `features/collections` internals is the same coupling in new folders.
- **Not a finding when:** a small service/app where each layer folder is still small; framework-mandated folders
  (Next.js `app/` routes) that sit on top of feature modules.
- **Architecture:** yes.
- **Sources:** https://martinfowler.com/bliki/PresentationDomainDataLayering.html ; https://feature-sliced.design/docs/reference/layers

---

## Behavioural smells (history-based — invisible in a single diff)

code-maat's premise: "VCS data blends technical, social and organizational information along a temporal axis …
Analyzing these patterns gives us early warnings on potential design issues and development bottlenecks, as well as
suggesting new modularities based on actual interactions with the code." Every entry here is _prioritisation_
evidence: it tells the agent which static smells are worth escalating. Commands are in §(b) rung 6.

### RC-26 Hotspot: unhealthy code that is changed often

- **Signal:** file in the top decile of `revisions × complexity` (`hotspots.py`; CodeScene uses "lines of code in
  each file as a proxy for complexity, and change frequency of each file as a proxy for the effort"), with low
  health (cognitive complexity findings, `TS-33`) — and the diff under review adds a branch to it.
- **Tool coverage:** code-maat `-a revisions` + any complexity measure; CodeScene hotspots/Code Health (commercial);
  `hotspots.py`. Partial: the tools rank; whether to act is judgement.
- **Why it hurts:** CodeScene: "Low code health in a development hotspot is expensive. Prioritize improvements here.
  Low code health in stable parts of the codebase, i.e. non-hotspots, has lower priority." A hotspot + knowledge
  island (RC-29) is a key-person risk.
- **Severity:** raises the severity of any structural smell inside it by one level; on its own, a finding only
  when trending worse (RC-28).
- **Remediation:** preparatory refactoring scoped to the hotspot (RC-54), then the feature; use CodeScene's
  "narrow down refactorings to a small part of the system". Trap: refactoring the whole module because one function
  is hot — X-Ray/function-level history first.
- **Not a finding when:** pseudo-hotspots (validation note §b): i18n catalogues, shared type declaration files,
  generated code, lockfiles, fixtures, changelogs — high churn, low cognitive risk.
- **Architecture:** sometimes — "clusters of hotspots … may indicate that an entire component or package is
  undergoing heavy changes" (CodeScene); escalate clusters.
- **Sources:** https://codescene.io/docs/guides/technical/hotspots.html ; https://github.com/adamtornhill/maat-scripts

### RC-27 Implicit change coupling (logical coupling without a structural dependency)

- **Signal:** two files/components co-change in ≥30% of their revisions (code-maat default `--min-coupling 30`;
  degree = shared revisions / mean revisions) with **no import path** between them (check with
  `npx depcruise … --focus`/`--reaches`). code-maat: "a hidden, implicit dependency between them such that a change
  to one of them leads to a predictable change in the coupled module"; its example: `InfoUtils.java ↔ Page.java`
  78% — "Since there's probably no reason they should change together, the analysis points to a part of the code
  worth investigating". Research support: pairs that modularization tools agree should be _together_ but are
  _separated_ co-change **190% more** than properly separated pairs (PairSmell); Le et al. list "Logical Coupling:
  Parts of different components are frequently changed together" as an architectural smell.
- **Tool coverage:** code-maat `-a coupling`/`soc`; CodeScene change coupling (also by same author within a period
  or same ticket ID); `coupling.py`. Partial: classifying expected vs unexpected pairs is judgement (validation
  classes in §b).
- **Why it hurts:** unknown unknowns (RC-03) with numbers: the next engineer changes one side and ships; the other
  side breaks.
- **Severity:** major ≥50% across packages/deployables with no static edge; minor inside one feature folder.
- **Remediation:** name the shared knowledge; then either co-locate (merge/move — "Things that change together
  should be located as close as possible", Dodds's Colocation) or make the dependency explicit and single-owned (one
  side derives from the other). CodeScene: "compare this information to your architectural principles. Any
  deviations might indicate real problems." Trap: adding an import to "make it explicit" without removing the
  duplicated knowledge — now it is explicit _and_ duplicated.
- **Not a finding when:** source ↔ own test; platform-sibling views that share a model; barrel ↔ module; a
  service ↔ its DAL inside one slice; changesets inflated by mega-commits (keep the 30-file cap). CodeScene: "Change
  coupling in itself is neither good nor bad; it all depends on _what_ modules are coupled and for what reason."
- **Architecture:** yes when across components/teams — CodeScene overlays teams: "coordination costs in the
  organization might soar".
- **Sources:** https://github.com/adamtornhill/code-maat ; https://codescene.io/docs/guides/technical/change-coupling.html ; https://arxiv.org/pdf/2411.01012 ; https://arxiv.org/pdf/2102.09835 ; https://kentcdodds.com/blog/colocation

### RC-28 Deteriorating complexity trend / refactoring that did not hold

- **Signal:** whitespace complexity (or cognitive complexity) of a hotspot rising faster than its LOC over revisions
  (§b trend loop); or a downward step at a refactor commit followed by a return to the old level. CodeScene's three
  shapes: Deteriorating, Refactoring, "Only minor modifications".
- **Tool coverage:** maat-scripts `git_complexity_trend.py`; CodeScene complexity trends; the §b awk loop.
  Partial: attributing the rise to a cause is judgement.
- **Why it hurts:** CodeScene names two causes — "Code Accumulates Responsibilities" (cohesion drops, "change the
  same unit of code for many different reasons") and "Constant Modification to a Stable Structure" ("add an
  if-statement to fix some corner case"). On failed refactors: "we spend an awful amount of time and money on
  improving something, fail to address the root cause, and soon the complexity slips back in … we found this pattern
  more often than not."
- **Severity:** major when the trend is up on a top-decile hotspot.
- **Remediation:** treat the _reason for accumulation_ (responsibility with no home → Extract Module; recurring
  corner cases → model the missing concept/state machine — `TS-11`), not the symptom lines. After a structural fix,
  add a guard (lint rule, dependency rule, complexity budget) so the trend cannot silently reverse. Trap:
  re-running the same cosmetic cleanup.
- **Not a finding when:** a step change caused by a squash-merge or vendored/generated code import (validation note:
  a squash produced a 1475 → 2803 step in one commit); "Only minor modifications" on a _non_-hotspot.
- **Architecture:** sometimes — accumulation is often a missing component.
- **Sources:** https://codescene.io/docs/guides/technical/complexity-trends.html ; https://github.com/adamtornhill/maat-scripts

### RC-29 Knowledge island / ownership split that mirrors (or fights) the structure

- **Signal:** one author ≥ ~80% of a hotspot's recent revisions (`git log --format='%aN' -- <path> | sort | uniq -c`;
  code-maat `-a main-dev`/`entity-ownership`); or a component whose revisions are split across many authors/teams
  with no main developer (code-maat `-a fragmentation`); or change coupling across modules owned by different teams.
- **Tool coverage:** code-maat (`main-dev`, `entity-ownership`, `entity-effort`, `fragmentation`, `communication`);
  CodeScene Knowledge Risks ("Knowledge Island in Complex Hotspot", "Complex Code by Former Contributors",
  knowledge loss). The ~80% figure is this file's heuristic, `UNVERIFIED` as a sourced threshold.
- **Why it hurts:** Conway: "Any organization that designs a system (defined broadly) will produce a design whose
  structure is a copy of the organization's communication structure." A structural smell whose boundary coincides
  with a team boundary will not be fixed by code alone; a hotspot owned by one person is a bus-factor risk; code-maat
  cautions "ownership metrics are sensitive to the same biases as the churn metrics; they're both heuristics".
- **Severity:** minor as a code finding (it is an organisational risk); report with the hotspot it amplifies.
- **Remediation:** outside a code agent's authority — escalate: pairing/onboarding on the island; align module
  boundaries with team boundaries (or change the teams — "inverse Conway" is an org decision). Code-side: CODEOWNERS
  for shared packages (`MONO-31`). Trap: recommending a module split that creates a cross-team seam on a hot path.
- **Not a finding when:** a solo/very small team (single-author is the only possible distribution); squashed
  commits authored by a merge bot.
- **Architecture:** yes (socio-technical) — escalate to humans, not only the architecture agent.
- **Sources:** https://www.melconway.com/Home/Conways_Law.html ; https://github.com/adamtornhill/code-maat ; https://codescene.io/docs/guides/social/knowledge-distribution.html

---

## Distributed-system and service-boundary smells

Newman's framing for this section: "A distributed monolith is a system that consists of multiple services, but for
whatever reason, the entire system must be deployed together … it has all the disadvantages of a distributed
system, and the disadvantages of a single-process monolith" and it emerges where "not enough focus was placed on
concepts like information hiding and cohesion of business functionality." `XC-44` names the system-level smell;
entries below are its _causes_. Harmfulness scores are practitioners' ratings (0–10) from Taibi, Lenarduzzi & Pahl
(27 interviewees), and the share of interviewees who reported experiencing each.

### RC-30 Shared persistence / inappropriate service intimacy (content and common coupling)

- **Signal:** "Different microservices access the same relational database. In the worst case, different services
  access the same entities" (Taibi et al., Shared Persistence: 37% experienced, harmfulness 6.05); "keeps on
  connecting to private data from other services instead of dealing with its own data … Direct connection to other
  microservices databases" (Inappropriate Service Intimacy: 19%, 5). Newman (secondary): _common coupling_ = two
  services using the same data; _content coupling_ = an upstream service "reaches into the internals of a
  downstream service and changes its internal state". Detection: rung-4 table-writer map — any table with writers in
  ≥2 deployables; migrations for one table in ≥2 service packages; a service's DB credentials/URL configured in
  another service's infra.
- **Tool coverage:** none — judgement + `rg` over SQL/ORM identifiers and infra config.
- **Why it hurts:** "highly couples the microservices connected to the same data, reducing team and service
  independence"; schema change = coordinated deploy; invariants enforced by no one.
- **Severity:** blocker when a diff adds a second **writer** to another service's table; major for a new reader;
  minor for read-only reference data (Newman: "Okish for reference data").
- **Remediation:** Taibi et al.'s three options — "use 1) independent databases for each service, 2) a shared
  database with a set of private tables for each service that can be accessed only by that service, 3) a private
  database schema for each service"; otherwise go through the owner's API/events. For intimacy they suggest
  "Consider merging the microservices" (the data model shows they are one). Migrate with parallel change (RC-53).
  Trap: a read replica/view as "decoupling" while the consumer still depends on the owner's column semantics.
- **Not a finding when:** one logical service with several deployables (API + worker + migration runner) sharing
  _its own_ database; per-service schemas/DBs in a shared cluster (option 2/3 above).
- **Architecture:** yes — data ownership; escalate.
- **Sources:** https://arxiv.org/pdf/1908.04101 ; https://danlebrero.com/2023/01/24/building-microservices-second-edition-designing-fine-grained-systems-summary/

### RC-31 Wrong cuts, megaservice, microservice greedy (service granularity)

- **Signal:** Wrong Cuts — services "split based on … technical layers (presentation, business, data layers)" not
  business capabilities (most-experienced anti-pattern: **56%** of interviewees, harmfulness **8**, joint-highest);
  Megaservice — "Several business processes implemented in the same service … developed by several developers, or
  several teams" (19%, 6); Microservice Greedy — "new microservices for each feature, even when they are not needed
  … a microservice serving only one static HTML page" (15%, 3). Detection: per-feature PRs that must change ≥2
  services (rung 7); a service whose API is thin CRUD over tables another service interprets (Newman, secondary:
  "thin wrappers around CRUD, is a sign of weak cohesion and high coupling").
- **Tool coverage:** none — judgement; code-maat `-g` component mapping + `-a coupling` across service directories
  quantifies it.
- **Why it hurts:** wrong cuts → "Wrong separation of concerns, increased data-splitting complexity"; greedy →
  "explosion of the number of microservices … will easily become unmaintainable".
- **Severity:** major (never a per-diff blocker; it is a trend).
- **Remediation:** re-draw around bounded contexts/aggregates ("Clear analysis of business processes"); merge
  services that always change together; decompose megaservices by business capability via strangler fig. Fowler
  (MonolithFirst): services "only work well if you come up with good, stable boundaries … Any refactoring of
  functionality between services is much harder than it is in a monolith", so prefer finding boundaries inside a
  modular monolith first. Trap: splitting a megaservice along its _layers_.
- **Not a finding when:** a deliberately separate deployable for a different runtime/scaling/vendor profile with
  its own contract (e.g. a CPU-bound worker in another language) — cut by operational profile, owning no shared
  data.
- **Architecture:** yes — escalate.
- **Sources:** https://arxiv.org/pdf/1908.04101 ; https://martinfowler.com/bliki/MonolithFirst.html

### RC-32 Pass-through coupling across services

- **Signal:** (Newman, secondary) "One service passes data to another purely because the data is needed further
  downstream." Shapes: an order service accepting and forwarding a `shippingManifest` it never reads; a BFF request
  DTO carrying fields only a third service uses; a queue message enriched by an intermediary with data it does not
  own.
- **Tool coverage:** none — judgement: trace a field from the entry contract to its first real reader.
- **Why it hurts:** the intermediary's contract now changes whenever the downstream contract changes (change
  amplification across deploys) — the service-level form of RC-08.
- **Severity:** minor; major when the intermediary is owned by another team.
- **Remediation:** Newman's options (secondary): bypass the intermediary (caller talks to the downstream directly);
  make the data part of the intermediary's own concept (it collects/owns it); or have the intermediary carry it as an
  opaque blob it does not parse. Trap: typing the blob in the intermediary "for safety", re-introducing the coupling.
- **Not a finding when:** a gateway/BFF whose job is composition and whose contract is versioned independently.
- **Architecture:** yes.
- **Sources:** https://danlebrero.com/2023/01/24/building-microservices-second-edition-designing-fine-grained-systems-summary/

### RC-33 Synchronous call chains, cyclic service calls and chatty I/O

- **Signal:** Cyclic Dependency — "A calls B, B calls C, and C calls back A" (Taibi et al.: 19%, harmfulness 7); a
  request handler that awaits ≥2 remote calls in sequence to answer one user request; per-item remote calls in a
  loop (Azure Chatty I/O: "A large number of small network requests made by an application instance to the same
  service"; "A large number of small requests made by an application instance to the same data store"). Detection:
  §b rung 3 N+1 grep; distributed traces with fan-out/depth; client code calling service X from a loop.
- **Tool coverage:** partial — ORM N+1 detectors/query logs, APM traces; static detection of chattiness is judgement.
- **Why it hurts:** latency adds and availability multiplies along a chain; one slow dependency exhausts the
  caller's pool; cycles make deploy order and failure recovery undefined. Azure: "Symptoms of chatty I/O include high
  latency and low throughput."
- **Severity:** major on a user-facing path; blocker when a diff introduces a service-call cycle.
- **Remediation:** Azure: "Reduce the number of I/O requests by packaging the data into larger, fewer requests" /
  "Fetch data from a database as a single query"; batch endpoints; move the data to where it is needed (replicate
  via events) or merge the chatty pair; for cycles "Refinement of the cycles … and application of an API-Gateway
  pattern" (Taibi et al.). Timeouts/retries (`NODE-06/07`) contain damage but are not the structural fix. Trap:
  parallelising the chain (`Promise.all`) — lower latency, same coupling and unbounded fan-out (`NODE-05`).
- **Not a finding when:** an orchestration service whose purpose is to coordinate a saga with explicit timeouts and
  compensation.
- **Architecture:** yes.
- **Sources:** https://arxiv.org/pdf/1908.04101 ; https://learn.microsoft.com/en-us/azure/architecture/antipatterns/chatty-io/

### RC-34 Shared libraries that carry business rules (deploy coupling)

- **Signal:** "Usage of shared libraries between different microservices" (Taibi et al.: 30%, harmfulness 4) where
  the library contains domain rules/entities, so a rule change forces every consumer to upgrade and redeploy in
  lockstep; version skew of the same internal library across services (`MONO-18`).
- **Tool coverage:** partial — workspace graph (`turbo … --graph`, `pkg_instability.py`) shows who depends;
  whether the content is _business_ knowledge is judgement.
- **Why it hurts:** "Tightly couples microservices together, leading to a loss of independence between them.
  Moreover, teams need to coordinate with each other when they need to modify the shared library."
- **Severity:** minor for technical libraries; major for shared domain rules across independently-deployed services.
- **Remediation:** Taibi et al.: "1) accept the redundancy to increase dependency among teams; 2) extract the
  library to a new shared service that can be deployed and developed independently". For wire _contracts_, a
  service-owned published schema package that consumers _derive from_ is the accepted shape (the owner is one
  service). Trap: a "common domain" package owned by nobody.
- **Not a finding when:** stable technical libraries (logging, tracing, lint/tsconfig presets — `XC-44`'s exception)
  or a contract package owned and versioned by exactly one service.
- **Architecture:** yes.
- **Sources:** https://arxiv.org/pdf/1908.04101

### RC-35 Contract absent: hard-coded endpoints and unversioned APIs

- **Signal:** Hardcoded Endpoints — "Hardcoded IP addresses and ports of the services" (Taibi et al.: 37%,
  harmfulness **8**) — in TS: base URLs/hosts as string literals in client code instead of config/discovery; API
  Versioning — "APIs are not semantically versioned" (22%, 6.05) — a breaking wire change (field removed/renamed,
  enum narrowed) shipped with no version, no expand/contract, no contract diff in CI.
- **Tool coverage:** partial — `rg -n "https?://[a-z0-9.-]+(:[0-9]+)?/" --glob '!**/*.test.*'` for literals;
  OpenAPI diff tools (e.g. oasdiff) for breaking changes when a spec exists; semantic compatibility is judgement.
- **Why it hurts:** "problems when their locations need to be changed"; unversioned change → "API consumers may face
  connection issues … the returning data might be different". Hyrum: consumers depend on _all_ observable behaviour,
  not just the documented contract.
- **Severity:** blocker for an unversioned breaking change to a wire contract with deployed consumers; minor for a
  literal host in a test.
- **Remediation:** service discovery/config for endpoints; versioned contracts + parallel change (RC-53) for breaking
  changes; contract tests owned by the provider. Trap: bumping a version label while still breaking v1 consumers.
- **Not a finding when:** internal endpoints within one deployable; pre-release APIs with no external consumers
  (declare it).
- **Architecture:** yes — contract governance.
- **Sources:** https://arxiv.org/pdf/1908.04101 ; https://www.hyrumslaw.com/

---

## Frontend structural smells (React / React Native / Next.js)

The line-level React defects are in `react.md` (`REACT-01..45`). This section is the question behind them: **where
should this state/data live, and which component should own it?** First classify every piece of state (Dodds:
"every type of state can fall into one of two buckets: Server Cache … UI State … We make a mistake when we combine
the two"; TanStack Router: URL search params are "truly a form of global state living inside of the URL"):

| Kind                                                    | Owner                                                                                                                               | Symptom when misplaced                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Server cache (data persisted remotely)                  | a query cache (TanStack Query/SWR/RSC fetch)                                                                                        | effects + `useState` + manual refetch/invalidation (RC-37)                 |
| URL state (filters, tab, page, selected id — shareable) | router search params, validated                                                                                                     | `useState` + effect syncing to/from the URL; lost on refresh/share (RC-38) |
| Form state (draft input until submit)                   | the form (form library, uncontrolled inputs, or React 19 action state — see `REACT-36`) — row is judgement, no source opened for it | draft mirrored into a global store; server cache mutated per keystroke     |
| UI state (open/closed, hover, local selection)          | the lowest component that needs it                                                                                                  | in Redux/context/root → app-wide re-renders (RC-36)                        |

### RC-36 State at the wrong altitude (lifted too high, or global for local)

- **Signal:** UI state (modal `isOpen`, input text, hover) held in a global store/context or a page root while only
  one subtree reads it; `rg -n 'useState|useReducer' <root layout/page>` returning many fields consumed by one child
  each; a context whose value changes on keystrokes. Dodds's decision tree: "used by only this component? … used by
  only one child? Yes: Colocate state … used by a sibling/parent? Yes: Lift state".
- **Tool coverage:** none — judgement; React DevTools Profiler "why did this render" confirms the blast radius.
- **Why it hurts:** "One of the leading causes to slow React applications is global state" (Dodds); every update
  re-renders unrelated trees, which then attracts memoisation (RC-39) — a compensating smell stacked on a structural
  one. Maintainability: the state's readers are no longer findable near its writer.
- **Severity:** minor; major when it drives memo/`useCallback` sprawl or input lag.
- **Remediation:** Colocate (move state down to the lowest common owner); Dodds: people are "pretty good at 'lifting
  state' as things change, but we don't often think to 'colocate' state" — make colocation part of each change. For
  truly shared state, a narrow context near the consumers, not at the root. Trap: moving server data "down" into
  components as local state (that is RC-37).
- **Not a finding when:** the state is genuinely app-wide (theme, current account, locale, routing — react.dev's
  listed context use cases) or must survive unmounts by design.
- **Architecture:** no (component-tree design); yes if a global store is the app's mandated pattern.
- **Sources:** https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster ; https://kentcdodds.com/blog/application-state-management-with-react ; https://react.dev/learn/passing-data-deeply-with-context

### RC-37 Missing server-state layer (server cache managed as client state)

- **Signal:** ≥2 screens each doing `useEffect(() => { fetch… then setData }, [])` with their own
  `isLoading`/`error`; manual cache in a store (`store.recipes = …`) plus hand-written invalidation after mutations;
  race/abort bugs (`REACT-06`); server data copied into client state (`REACT-21`). Grep:
  `rg -n -U 'useEffect\(\(\) => \{[^}]*(fetch\(|axios\.|\.get\()' --glob '*.tsx'` and count files (pattern
  validated on a sample; it misses effects whose body contains `}` before the call — treat zero hits as
  inconclusive, not as absence).
- **Tool coverage:** partial — `react-hooks/exhaustive-deps` finds dependency bugs in those effects, not the missing
  layer; judgement.
- **Why it hurts:** TanStack Query lists what every hand-rolled version must solve and usually doesn't: server state
  "Is persisted remotely in a location you may not control or own … Implies shared ownership and can be changed by
  other people without your knowledge … Can potentially become 'out of date'", plus caching, deduping, background
  updates, knowing staleness, pagination, garbage collection, structural sharing. Each screen re-implements a subset
  differently → inconsistent staleness bugs.
- **Severity:** major when ≥2 screens hand-roll it (the pattern will be copied to the next screen); minor for one
  isolated fetch.
- **Remediation:** adopt/centralise a server-state library and query-key factory per resource; mutations invalidate
  by key; remaining client store shrinks — "the globally accessible client state that is left over after migrating
  all of your async code to TanStack Query is usually very tiny". Migrate screen by screen (strangler). Trap: wrapping
  the old effect in a custom hook — same missing layer, better name.
- **Not a finding when:** Server Components fetch on the server and pass data down (the framework is the server-state
  layer); a genuinely one-off imperative request (export download); apps with "a massive amount of synchronous
  client-only state (like a visual designer …)" still need a client store _alongside_ it.
- **Architecture:** yes — the frontend data layer; escalate the choice, not each screen.
- **Sources:** https://tanstack.com/query/latest/docs/framework/react/overview ; https://tanstack.com/query/latest/docs/framework/react/guides/does-this-replace-client-state ; https://kentcdodds.com/blog/application-state-management-with-react

### RC-38 URL state held in component state

- **Signal:** filters/sort/tab/page/selected-item in `useState` with an effect writing `router.replace`/
  `history.pushState`, or an effect reading `searchParams` into state (two sources of truth — `REACT-01`); shareable
  views that reset on refresh; `searchParams.get('x') as Filter` casts (unvalidated — `RN-21`, `NEXT-22`).
- **Tool coverage:** none — judgement.
- **Why it hurts:** TanStack Router's user-facing criteria are exactly what breaks: users should be able to "Cmd/Ctrl
    - Click to open a link in a new tab and reliably see the state they expected", "Bookmark and share links", "Refresh
      your app or navigate back and forth between pages without losing their state".
- **Severity:** minor; major for list/search screens users share or deep-link into.
- **Remediation:** the URL is the owner: read validated search params as the state, write via navigation; derive
  everything else. Trap: keeping a local mirror "for performance" — reintroduces sync effects.
- **Not a finding when:** ephemeral UI state users would not expect to share (hover, an open menu), or sensitive
  values that must not appear in URLs.
- **Architecture:** no.
- **Sources:** https://tanstack.com/router/latest/docs/framework/react/guide/search-params ; https://react.dev/learn/sharing-state-between-components

### RC-39 Memoisation compensating for a wrong component boundary

- **Signal:** a diff adds `React.memo`/`useMemo`/`useCallback` to stop an expensive subtree re-rendering when a
  parent's state changes, and the expensive subtree does not read that state. Grep the diff for new memo wrappers;
  check whether the state could move into a smaller component.
- **Tool coverage:** none — judgement (React Compiler auto-memoises, which removes the _performance_ symptom but not
  the ownership problem — see `REACT-20/22`).
- **Why it hurts:** Abramov's two structural alternatives: "Move State Down" and "Lift Content Up" (pass the static
  subtree as `children`); "Before you apply optimizations like memo or useMemo, it might make sense to look if you
  can split the parts that change from the parts that don't change … Using the children prop to split up components
  usually makes the data flow of your application easier to follow and reduces the number of props plumbed down".
- **Severity:** minor.
- **Remediation:** Extract the stateful part into its own component (move state down), or pass the unaffected tree
  as `children`/slots (lift content up); keep memo for measured cases — "Then, where it's not enough, use the
  Profiler and sprinkle those memo's." Trap: removing memo without restructuring (regresses performance).
- **Not a finding when:** the subtree genuinely reads the changing state, or a Profiler measurement justified the memo
  and restructuring is not possible (third-party parent).
- **Architecture:** no.
- **Sources:** https://overreacted.io/before-you-memo/

### RC-40 Props threaded through non-readers (missing composition) — and context as the wrong cure

- **Signal:** a prop passed through ≥2 intermediate components that only forward it; `<Layout posts={posts}>` where
  `Layout` does not read `posts`. Or the opposite over-correction: a new context introduced for data used by one
  subtree two levels down.
- **Tool coverage:** none — judgement (`REACT-27` covers both directions at line level).
- **Why it hurts:** react.dev: data passed "through many layers of intermediate components that don't use that data
  (and only pass it further down) … often means that you forgot to extract some components along the way." Context
  hides the dependency and couples consumers to a provider position.
- **Severity:** minor.
- **Remediation:** react.dev order — "Start by passing props" (explicit is fine: "it makes it very clear which
  components use which data"), then "Extract components and pass JSX as children" (`<Layout><Posts posts={posts}
/></Layout>`), and only then context. Dodds's tree: prop-drilling problem → "Can child function outside of
  parent? Yes: Move State to Context Provider … No: Use Component Composition". Trap: context at the root for a
  subtree concern (RC-36).
- **Not a finding when:** a dozen explicit props down a non-trivial tree that each intermediate _uses_ — react.dev
  explicitly accepts this.
- **Architecture:** no.
- **Sources:** https://react.dev/learn/passing-data-deeply-with-context ; https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster

### RC-41 Inverted component tree (children driving parents)

- **Signal:** parent calls `childRef.current.open()/reset()/validate()` via `useImperativeHandle`; child `useEffect`
  calls `props.onChange(localState)` to report state up (`REACT-05`); sibling components synchronising through a
  parent's effects; a child reading `window` events to learn what the parent decided. Grep (§b rung 3):
  `rg -n 'useImperativeHandle|\.current\.[a-zA-Z]+\('` and effects that call `props.on*`.
- **Tool coverage:** none for the structure; `react-hooks/exhaustive-deps` catches symptoms inside the effects.
- **Why it hurts:** two owners for one value (react.dev: "For each unique piece of state, you will choose the
  component that 'owns' it … a 'single source of truth'"); updates happen in extra render passes; order-dependent
  bugs; the parent cannot render a consistent view from props.
- **Severity:** minor; major when used to coordinate form submission/validation across components.
- **Remediation:** decide the owner: if the parent decides, make the child controlled (value + onChange props); if
  the child owns it, the parent stops needing it; report changes from event handlers, not effects. Keep refs for
  genuinely imperative external systems (focus, scroll, media, third-party widgets). Trap: replacing the ref with a
  context — still two owners.
- **Not a finding when:** focus/scroll/measurement/animation handles, or wrapping a non-declarative third-party
  widget (the refs-are-near-forbidden exception class).
- **Architecture:** no.
- **Sources:** https://react.dev/learn/sharing-state-between-components

### RC-42 Cross-feature imports (slice boundary violated)

- **Signal:** `features/a/**` importing from `features/b/**` internals (not its public API); `shared/` importing from
  `features/`; `entities` importing `widgets`. FSD: "A module (file) in a slice can only import other slices when they
  are located on layers strictly below"; "Layers App and Shared are exceptions". Grep:
  `rg -n "from ['\"](\.\./)+features/|from ['\"]@/features/" src/features`.
- **Tool coverage:** partial — dependency-cruiser `forbidden` path rules with group matching (`$1`), Steiger (FSD
  linter — rule names `UNVERIFIED`), `@nx/enforce-module-boundaries`, `turbo boundaries` at package level (`MONO-17`).
- **Why it hurts:** features become entangled (RC-11 at feature scale); deleting or changing one feature breaks
  another; cycles form (RC-15).
- **Severity:** minor per import; major when it creates a cycle or a feature→app edge.
- **Remediation:** move the shared piece down (to `entities`/`shared`) or compose the two features one layer up
  (`widgets`/`pages`); expose a slice's public API (`index`) only where a package-export-style contract is wanted.
  Trap: moving everything shared into `shared/` → dumping ground (`MONO-23`).
- **Not a finding when:** the repo does not use slice layering (then judge against its own documented rule), or the
  import targets the other slice's declared public API under an explicit cross-import allowance.
- **Architecture:** yes when the rule is part of the repo's documented architecture.
- **Sources:** https://feature-sliced.design/docs/reference/layers

---

## Backend structural smells (services, domain, persistence, boundaries)

Line-level NestJS/Node defects: `NEST-01..32`, `NODE-01..33`. These entries are the _shape_ that makes those lines
recur.

### RC-43 Anemic domain model with transaction-script sprawl

- **Signal:** entity/model types that are data only (interfaces, Drizzle/Prisma row types, classes with only
  fields/getters) while services contain every rule: `if (recipe.status === 'published' && recipe.ownerId !== user.id)`
  in several service methods; read → check fields → set fields → save choreographies. Fowler: objects "named after
  the nouns in the domain space … hardly any behavior on these objects, making them little more than bags of getters
  and setters … a set of service objects which capture all the domain logic". Grep the same invariant across
  services: `rg -n "status === ['\"]<value>['\"]" src --glob '!**/*.test.*' | cut -d: -f1 | sort | uniq -c`.
- **Tool coverage:** partial — `XC-22` Data Class / `XC-09` Feature Envy name the class-level smell (no TS rule);
  repetition of the same predicate across services is judgement + grep.
- **Why it hurts:** "they incur all of the costs of a domain model, without yielding any of the benefits … By
  pulling all the behavior out into services, however, you essentially end up with Transaction Scripts"; each
  script re-implements invariants and they drift (RC-05); new write paths (queue consumer, admin tool) skip rules.
- **Severity:** minor for simple CRUD; major when the same business invariant is enforced in ≥2 write paths.
- **Remediation:** Tell-Don't-Ask — "rather than asking an object for data and acting on that data, we should
  instead tell an object what to do"; move invariants into the domain type (methods on a class, or — idiomatic in
  functional TS — a pure policy/specification module `evaluateX(state, actor) → decision` that every write path
  calls, plus value objects/branded types, `TS-13`). Keep the application service thin: Evans's application layer
  "does not contain business rules or knowledge, but only coordinates tasks and delegates work" (quoted by Fowler).
  Migrate rule by rule, each behind characterization tests (RC-52). Trap: class-ifying rows with getters/setters —
  still anemic.
- **Not a finding when:** the logic is genuinely simple CRUD — Fowler: "Domain Models aren't always the best tool";
  Transaction Script "organizes all this logic primarily as a single procedure" and is a legitimate P of EAA pattern
  for simple domains. Functional-core designs with pure policy modules are not anemic — the behaviour exists, it is
  just not a method.
- **Architecture:** yes when rules are scattered across services/deployables.
- **Sources:** https://martinfowler.com/bliki/AnemicDomainModel.html ; https://martinfowler.com/eaaCatalog/transactionScript.html ; https://martinfowler.com/bliki/TellDontAsk.html

### RC-44 Business logic in adapters (smart UI / fat controller / fat handler)

- **Signal:** controllers, Route Handlers, Server Actions, Lambda handlers, queue consumers or React route components
  containing business rules, persistence calls and response shaping together (`NEST-09`, `NEXT-18`); the same use
  case implemented twice because a second driver (CLI, queue, cron) needed it; tests for rules that must boot HTTP.
  Cockburn: "One of the great bugaboos of software applications over the years has been infiltration of business logic
  into the user interface code".
- **Tool coverage:** partial — dependency-cruiser `forbidden` rules (e.g. `from: { path: 'controller' }, to: { path:
'dal|repository|schema' }`) enforce a layer edge; whether logic _in_ the adapter is business logic is judgement.
- **Why it hurts:** Cockburn's threefold cost: the system "can't neatly be tested with automated test suites",
  "it becomes impossible to shift from a human-driven use of the system to a batch-run system", and "difficult or
  impossible to allow the program to be driven by another program". Service Layer (Stafford): "Encoding the logic of
  the interactions separately in each interface causes a lot of duplication."
- **Severity:** minor for a single thin endpoint; major when a second driver duplicates the use case.
- **Remediation:** Ports & Adapters — "Allow an application to equally be driven by users, programs, automated test or
  batch scripts"; extract an application service per use case that every adapter calls; adapters only translate
  (parse input, map errors, shape output). Trap: an application service that is itself a pass-through to the
  repository while rules stay in the controller (RC-04/RC-08).
- **Not a finding when:** the endpoint is pure transport (health check, proxy) or the "rule" is protocol concern
  (status codes, headers, content negotiation).
- **Architecture:** yes — layer/port boundary.
- **Sources:** https://alistair.cockburn.us/hexagonal-architecture/ ; https://martinfowler.com/eaaCatalog/serviceLayer.html

### RC-45 Persistence model leaking across layers

- **Signal:** ORM/query-builder row types (`typeof table.$inferSelect`, Prisma model types, TypeORM entities)
  imported by controllers, DTOs, client packages or React components; response bodies that are rows (`NEST-17`);
  hand-written wire types that mirror columns (`TS-18`). Grep:
  `rg -n "from ['\"].*(schema|entities|drizzle|prisma)" src --glob '!**/dal/**' --glob '!**/repositories/**' --glob '!**/migrations/**'`.
  Validation note: on a service that names its **zod wire schemas** `*.schema.ts`, most hits were DTO files importing
  _wire_ schemas (correct) — the word `schema` is ambiguous; narrow the pattern to the ORM's actual table module path
  (e.g. `database/schema`) before counting.
- **Tool coverage:** partial — dependency-cruiser path rules can forbid `controller → schema` edges; the semantic
  leak (a column rename breaking a public API) is judgement.
- **Why it hurts:** the database schema becomes the public contract (Martin's zone of pain — "Database Schemas are
  notoriously volatile and are highly depended upon", RC-17); a migration becomes a breaking API change; internal
  columns (flags, soft-delete, PII) leak to clients.
- **Severity:** major when the row type reaches a wire contract or another package; minor inside the data module.
- **Remediation:** keep persistence types inside the data-access module; map to domain types and to wire schemas at
  the boundary; for wire types, one owner and derived consumers (`TS-18`). Fowler: "arrange things so that the domain does not
  depend on its data sources by introducing a mapper between the domain and data source layers. This approach is
  often referred to as a Hexagonal Architecture." Migrate with
  parallel change: introduce the wire schema, switch consumers, then stop exporting the row type. Trap: `Omit<Row,
'secret'>` as the wire type — still coupled to every future column.
- **Not a finding when:** a small service whose read model _is_ the table by explicit decision and whose responses are
  schema-validated at the edge; admin/internal tooling in the same package.
- **Architecture:** yes — data/contract boundary.
- **Sources:** https://martinfowler.com/bliki/PresentationDomainDataLayering.html ; https://web.archive.org/web/2011id_/http://www.objectmentor.com/resources/articles/stability.pdf

### RC-46 Missing aggregate boundary (invariants enforced by callers; multi-object writes without a root)

- **Signal:** child rows (line items, ingredients, versions) written directly by several services/endpoints rather than
  through their parent; invariants spanning parent+children checked in callers; transactions that update several
  independent aggregates at once; `UPDATE child` endpoints that bypass the parent's rules. Fowler: "Any references from
  outside the aggregate should only go to the aggregate root … Transactions should not cross aggregate boundaries."
- **Tool coverage:** none — judgement (rung-4 writer map per table).
- **Why it hurts:** the invariant has no guardian — each new write path can violate it; long multi-aggregate
  transactions contend and deadlock; cannot later move an aggregate to another service.
- **Severity:** major when an invariant (count, total, ordering, ownership) can be violated by an existing write path.
- **Remediation:** define the aggregate and its root; route all writes through the root's operation (domain method or
  policy + repository `save(aggregate)`); cross-aggregate consistency via domain events/eventual consistency or a
  deliberately documented transaction. Trap: an aggregate so large (whole user account) that every write locks it.
- **Not a finding when:** children are independent entities with their own lifecycle and no shared invariant.
- **Architecture:** yes — transactional/data-ownership boundary.
- **Sources:** https://martinfowler.com/bliki/DDD_Aggregate.html

### RC-47 God service (one class/provider owning many use cases)

- **Signal:** a service file in the hotspot top decile with many injected collaborators (`NEST-06`), public methods
  spanning several nouns, commit subjects on it naming several features (`git log --format=%s -- <file> | head -50`),
  and frequent merge conflicts. Validation-run example: the top hotspot was a single service file revised 30 times in
  8 months with ~1,300 non-blank lines.
- **Tool coverage:** partial — size/complexity (`sonarjs`, `qlty`), Brain/God Class metrics (`XC-30`, `XC-35`); the
  "several reasons to change" evidence is git history + judgement.
- **Why it hurts:** Divergent Change (`XC-07`) centralised: every feature team edits it; tests become broad; one
  provider's failure takes down unrelated use cases; DI graph cycles (`NEST-01`).
- **Severity:** major when it is a hotspot with multi-author churn.
- **Remediation:** split by use case/aggregate (one application service per cohesive set of use cases), leaving a
  thin facade only if many callers depend on the old surface; extract policies (RC-43). Stage it: characterization
  tests → move one use case per commit → delete facade (parallel change). Trap: splitting by technical verb
  (`RecipeReadService`/`RecipeWriteService`) when both still share every private helper — conjoined (RC-11).
- **Not a finding when:** large but single-concern (one complex use case) with low churn.
- **Architecture:** sometimes — if its responsibilities belong to different bounded contexts.
- **Sources:** https://codescene.io/docs/guides/technical/hotspots.html

### RC-48 Error model absent (the same catch/log/return-null at every call site)

- **Signal:** repeated `try { … } catch (e) { logger.error(e); return null; }` / `return undefined` / `return []`
  shapes; callers null-check results whose failure meaning is lost; the same upstream failure mapped to different HTTP
  statuses in different controllers; log-and-rethrow at every layer (`NODE-15`). Count the shapes:
  `rg -n -U 'catch \((\w+)\) \{\s*(console|logger|this\.logger)\.\w+\([^)]*\);\s*return (null|undefined|\[\]|false)' src`.
- **Tool coverage:** partial — `sonarjs`/ESLint empty-catch and `@typescript-eslint/only-throw-error`-class rules
  catch the worst (`NODE-13/14`); the missing _model_ (which failures exist, where they are translated) is judgement.
- **Why it hurts:** failures become indistinguishable from empty results; incidents are silent; each call site invents
  its own policy. Ousterhout (secondary): for exceptions that cannot be defined away, "mask them at a low level, so
  their impact is limited, or aggregate several special-case handlers into a single more generic handler."
- **Severity:** major when a failure is converted to a valid-looking value on a write or authorization path.
- **Remediation:** define the error model once: domain error types (custom `Error` subclasses with guards) or a
  `Result` type at module boundaries; translate at exactly one layer (exception filter / adapter); define errors out of
  existence where semantics allow (idempotent delete of a missing row). Trap: a global catch-all that logs and returns
  500 for everything — aggregation without classification.
- **Not a finding when:** a deliberately total function at a UI edge (render fallback) that records the failure, or a
  best-effort side channel (metrics emit) documented as such.
- **Architecture:** yes when the translation layer is missing service-wide.
- **Sources:** https://sive.rs/book/PoSD

### RC-49 Shotgun parsing (no parse at the boundary)

- **Signal:** the same external value checked/cast at many reads: `as Foo` on `JSON.parse`/`res.json()`/queue bodies
  (`TS-17`), `if (!body.x || typeof body.x !== 'string')` in several handlers, `Number(req.query.page)` in several
  places (`NODE-31`), optional chaining sprawl on data that should be non-null after ingress. King: "Shotgun parsing
  is a programming antipattern whereby parsing and input-validating code is mixed with and spread across processing
  code—throwing a cloud of checks at the input, and hoping, without any systematic justification, that one or another
  would catch all the 'bad' cases."
- **Tool coverage:** partial — `@typescript-eslint/no-unsafe-*` on `any` sources, `no-unnecessary-condition`
  (`TS-17` family); the architectural gap (no single ingress parse) is judgement.
- **Why it hurts:** King: shotgun parsing "deprives the program of the ability to reject invalid input instead of
  processing it. Late-discovered errors in an input stream will result in some portion of invalid input having been
  processed" — partial writes and undefined states; every new reader re-derives trust.
- **Severity:** major on write paths and security-relevant fields; minor on read-only display.
- **Remediation:** "Push the burden of proof upward as far as possible, but no further. Get your data into the most
  precise representation you need as quickly as you can. Ideally, this should happen at the boundary of your system,
  before any of the data is acted upon"; "Use a data structure that makes illegal states unrepresentable" (schema parse
  → branded/discriminated types, `TS-11/13`). Trap: a validator that returns `boolean` and passes the original
  untyped value on — "write functions on the data representation you wish you had".
- **Not a finding when:** context-sensitive parsing that uses one parsed field to choose the parser for another —
  King: "Avoiding shotgun parsing just means you shouldn't act on the input data before it's fully parsed".
- **Architecture:** yes at service ingress (one parse per boundary).
- **Sources:** https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/

### RC-50 Unguarded boundary (an architectural rule with no executable check)

- **Signal:** an ADR/README/CLAUDE-style rule ("services never import the DAL of another feature", "no business logic
  in handlers", "web and mobile share the model", "only service X writes table Y") with no corresponding dependency
  rule, test, lint rule or CI check; a diff that violates it and passes CI.
- **Tool coverage:** by construction none — that is the smell. Candidate enforcers: dependency-cruiser `forbidden`
  rules, `turbo boundaries`/Nx tags (`MONO-17`), architecture tests that grep/AST-check, contract tests.
- **Why it hurts:** Cockburn's history of every "new layer … with the promise that this time, really and truly, no
  business logic will be put into the new layer. However, having no mechanism to detect when a violation of that
  promise occurs, the organization finds a few years later that the new layer is cluttered with business logic and
  the old problem has reappeared." His remedy is executable: automated tests "detect any violation of the promise …
  The organization can detect, and then correct, the logic leak."
- **Severity:** minor as a gap; major when a diff violates the unguarded rule (report the violation _and_ the missing
  guard).
- **Remediation:** encode the rule — a forbidden-dependency rule, an architecture test, a boundary lint — and baseline
  current violations (`depcruise --baseline`, `--ignore-known`) so the rule ratchets instead of blocking all work.
  Trap: a guard that enumerates today's members ("these five handlers") instead of deriving the set — it cannot detect
  the new member.
- **Not a finding when:** the rule is aspirational and explicitly marked non-enforced, or enforcement is impossible
  statically and a review checklist owns it (state which).
- **Architecture:** yes — the guard is part of the architecture.
- **Sources:** https://alistair.cockburn.us/hexagonal-architecture/ ; https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md

---

## Root-cause technique and safe structural change (process smells in the _fix_)

These entries grade the remediation itself. An agent that finds the right root cause and then proposes an unsafe
migration has still failed.

### RC-51 Single-chain "5 Whys" that stops at the investigator's knowledge

- **Signal:** a root-cause statement that is one linear chain ending at a person or a line ("dev forgot the null
  check"), with no second cause, no structural element, and no check that the proposed fix prevents recurrence
  elsewhere.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Ohno described the method as "the basis of Toyota's scientific approach by repeating why five
  times" (Wikipedia), but its documented weaknesses are exactly the agent failure this file targets: "Tendency for
  investigators to stop at symptoms rather than going on to lower-level root causes"; "Inability to go beyond the
  investigator's current knowledge"; "Results are not repeatable"; "Tendency to isolate a single root cause, whereas
  each question could elicit many different root causes" (criticism list incl. Toyota's Teruyuki Minoura); Card
  (BMJ Qual Saf 2017), as summarised there: "The arbitrary depth of the fifth why is unlikely to correlate with the
  root cause" (Card's full text not opened; PubMed record only).
- **Severity:** minor (process); major when it produces a local fix for a recurring, multi-site defect.
- **Remediation:** replace the chain with the §(b) climb: at each "why", ask _which structure made this the easy thing
  to write_ and _where else does that structure produce the same line_ (rg/co-change evidence), allow branching into
  several contributing causes, and end at a changeable decision (ownership, boundary, contract, guard), not a person.
  Card (per the same summary) suggests fishbone or "lovebug" diagrams. Trap: using the climb to justify a rewrite — stop at the first rung
  that explains all observed sites.
- **Not a finding when:** a genuine one-off typo with no structural contributor (rung 0 stop condition holds).
- **Architecture:** no (method).
- **Sources:** https://en.wikipedia.org/wiki/Five_whys ; https://pubmed.ncbi.nlm.nih.gov/27590189/

### RC-52 Structural change without characterization tests or a seam

- **Signal:** a refactor PR that moves/merges/splits logic in untested or mock-only-tested code, with no tests added
  _before_ the move that pin current behaviour; tests rewritten in the same commit as the code they cover.
- **Tool coverage:** partial — coverage diff shows untested moved lines; mutation testing (`XC-55`) shows whether
  pinned behaviour is actually asserted; the sequencing is judgement (git history of the PR).
- **Why it hurts:** without a behaviour pin, a structural change is indistinguishable from a behaviour change.
  Characterization tests "describe (characterize) the actual behavior of an existing piece of software, and therefore
  protect existing behavior … they verify the behavior that was observed when they were written" (term coined by
  Feathers).
- **Severity:** major for hotspots/money/auth paths; minor for pure renames the type checker proves.
- **Remediation:** Feathers's sequence — find or create a **seam**: "a place where you can alter behavior in your
  program without editing in that place"; "Every seam has an enabling point, a place where you can make the decision to
  use one behavior or another". In TS (Fowler's LegacySeam example): pass the collaborator as a parameter
  (`calculatePrice(order, shippingFn)`) so a test supplies a stub; module seams (DI providers, `vi.mock` at module
  boundaries) where signatures can't change. Write characterization tests through the seam, commit, then restructure
  with the tests unchanged. Trap: characterization tests are "change detectors" — they pin bugs too; record which
  pinned behaviours are known-wrong and fix those in a _separate_ behaviour-change commit.
- **Not a finding when:** mechanical refactorings fully verified by the compiler (rename symbol, move file with
  updated imports) in a strictly typed codebase.
- **Architecture:** no (method), but seams created here are often the future architectural boundary (Fowler: in a
  well-designed system "these seams would already exist").
- **Sources:** https://www.informit.com/articles/article.aspx?p=359417&seqNum=2 ; https://www.informit.com/articles/article.aspx?p=359417&seqNum=3 ; https://martinfowler.com/bliki/LegacySeam.html ; https://martinfowler.com/bliki/StranglerFigApplication.html ; https://en.wikipedia.org/wiki/Characterization_test

### RC-53 Big-bang structural migration instead of strangler fig / parallel change

- **Signal:** one PR/deploy that changes an interface and all its consumers at once across packages/services; a
  schema rename/drop in the same release as the code that stops using the column; "rewrite module X" branches that
  live for weeks; feature flags absent where old and new must coexist.
- **Tool coverage:** partial — contract-diff tools flag breaking wire changes; migration linters flag destructive DDL;
  sequencing across releases is judgement.
- **Why it hurts:** Fowler on replacement: "we've seen this simple-sounding plan go down in flames most of the time
  … it's hard to figure out the details of existing behavior. What's worse, much of that behavior is stuff that isn't
  really wanted". For interfaces with several consumers, doing the change and all migrations at once "can be hard …
  especially if the change is on a PublishedInterface" (Sato, ParallelChange); a partial deploy (one service rolled,
  the other not) breaks production.
- **Severity:** blocker for breaking changes to persisted schemas or wire contracts with independently-deployed
  consumers; minor inside one deployable with no external consumers.
- **Remediation:** **Parallel change / expand–contract**: "expand, migrate, and contract" — "In the expand phase you
  augment the interface to support both the old and the new versions … During the migrate phase you update all clients
  … Once all usages have been migrated … perform the contract phase" — releasable at every phase. **Strangler fig** for
  larger replacements: "begins with small additions, often new features, that are built on top of, yet separate to the
  legacy code base. As we do this we move bits of behavior from the legacy system into the new code base", using seams
  and accepting "transitional architecture". Trap: never running the contract phase — both versions live forever
  (Lava Flow, `XC-36`); put the contract step on the plan with an owner.
- **Not a finding when:** a private interface inside one deployable where the compiler finds every consumer and they
  ship atomically.
- **Architecture:** yes — migration strategy for boundaries.
- **Sources:** https://martinfowler.com/bliki/ParallelChange.html ; https://martinfowler.com/bliki/StranglerFigApplication.html

### RC-54 Structural change interleaved with the feature change

- **Signal:** one commit/PR both restructures (moves, renames, extracts, changes signatures) and changes behaviour;
  review diff dominated by moved lines hiding a few semantic edits; `git show --stat` with high rename/move counts plus
  new tests for new behaviour in the same commit.
- **Tool coverage:** partial — `git diff -M -C --stat` / `git log --follow` expose moves; separation is judgement.
- **Why it hurts:** reviewers cannot see the behaviour change inside the structural noise; a revert of the feature
  also reverts the refactor. Beck's cost model: "cost(change) = cost(understand) + cost(modify) + cost(validate) +
  cost(deploy)" — interleaving raises validate cost for both.
- **Severity:** minor; major on hotspots and contract changes.
- **Remediation:** Beck: "for each desired change, make the change easy (warning: this may be hard), then make the easy
  change" — preparatory structural commits (behaviour-preserving, tests unchanged and green), then a small feature
  commit. The term "preparatory refactoring" is Fowler's (`UNVERIFIED` — bliki URL returned 404 this session). Trap:
  preparatory refactoring that grows unbounded — stop when the feature change becomes a few lines.
- **Not a finding when:** a tiny change where separation would add ceremony without reducing review cost (single
  function, few lines).
- **Architecture:** no (method).
- **Sources:** https://x.com/KentBeck/status/250733358307500032 ; https://tidyfirst.substack.com/p/change

### RC-55 Preserving the wrong abstraction (when NOT to escalate a DRY fix)

- **Signal:** a shared helper/component/base class that has accumulated parameters and conditionals per caller
  (`mode`, `variant`, `isX`, `options.skipY`); each new requirement adds one more flag; callers each exercise a
  different subset. Metz's sequence: extract → "A new requirement appears for which the current abstraction is almost
  perfect" → "alter the code to take a parameter, and then add logic to conditionally do the right thing" → "Loop until
  code becomes incomprehensible."
- **Tool coverage:** partial — `sonarjs` cognitive complexity on the helper, boolean-parameter rules; the diagnosis
  (callers use disjoint subsets) is judgement: list call sites and the flags each passes.
- **Why it hurts:** "The code no longer represents a single, common abstraction, but has instead become a
  condition-laden procedure which interleaves a number of vaguely associated ideas. It is hard to understand and easy
  to break." Sunk cost keeps it alive: "the more complicated and incomprehensible the code … the more we feel pressure
  to retain it".
- **Severity:** minor; major when it is a shared-package API or a hotspot.
- **Remediation:** Metz: "the fastest way forward is back … Re-introduce duplication by inlining the abstracted code back
  into every caller. Within each caller, use the parameters being passed to determine the subset of the inlined code that
  this specific caller executes. Delete the bits that aren't needed for this particular caller." Then re-extract only
  real shared concepts. This is the counter-weight to RC-05/RC-09: the agent must not recommend "extract shared helper"
  when the evidence is look-alike code with different reasons to change. Trap: inlining a genuinely correct abstraction
  whose flags are _configuration of one concept_ (e.g. a design-system `size` prop).
- **Not a finding when:** the parameters vary one concept along a stable axis (size, locale, page size) and every
  caller uses the same code path.
- **Architecture:** no, unless the abstraction is a cross-package contract.
- **Sources:** https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction

### RC-56 Removing a fence without knowing why it is there (Chesterton + Hyrum)

- **Signal:** a diff deletes a check, retry, guard, "unused" export, odd ordering, duplicate validation, or legacy
  branch with no evidence of why it existed: no `git log -S'<snippet>'`/`git blame` investigation, no ADR/issue link,
  no consumer search; code comments like `// weird, but needed`, `DELIBERATE`, ADR references near the removed code.
- **Tool coverage:** partial — dead-code tools (`knip`, `MONO-21`, `TS-35`) prove _static_ non-use only; dynamic,
  cross-repo, reflective and wire consumers are invisible to them.
- **Why it hurts:** Chesterton: "If you don't see the use of it, I certainly won't let you clear it away. Go away and
  think. Then, when you can come back and tell me that you do see the use of it, I may allow you to destroy it."
  Hyrum: "With a sufficient number of users of an API, it does not matter what you promise in the contract: all
  observable behaviors of your system will be depended on by somebody" — "unused" behaviour at a public boundary
  usually has a consumer.
- **Severity:** major when the removed element is at a security, persistence or wire boundary; minor for internal
  code with complete static usage evidence.
- **Remediation:** investigate first: `git log -S'<exact snippet>' --oneline -- <path>` (commit that introduced it),
  `git show <sha>` (message, linked issue), search ADRs/docs for the construct, search consumers across repos; then
  either remove with the reason recorded in the commit, or keep and add the missing explanation/guard. For public
  behaviour, deprecate → measure use → remove (parallel change). Trap: treating a surprising structure as the smell
  when it is a recorded trade-off — the agent must read the linked decision before flagging.
- **Not a finding when:** the investigation is done and cited in the diff/commit, or tooling proves no consumer in a
  private scope.
- **Architecture:** yes when the fence is an ADR-backed decision — escalate rather than "fix".
- **Sources:** https://www.chesterton.org/taking-a-fence-down/ ; https://www.hyrumslaw.com/

### RC-57 Fixing the smell where it shows instead of where it lives

- **Signal:** a PR that resolves a lint/static finding at the reported site (cast removed, memo added, null-check
  added, cycle broken by lazy import) while §(b) evidence shows the same cause at other sites or an architecture smell
  elsewhere (co-change partner, cycle participant, second writer); a "cleanup" PR on a hotspot whose complexity trend
  later returns (RC-28).
- **Tool coverage:** none — judgement; the §(b) rung-2/4/6 commands produce the evidence.
- **Why it hurts:** evidence that the two levels are distinct: in 102 Java projects architectural smells were
  independent of code smells ("removing code debt does not necessarily imply the reduction/removal of architectural
  debt and vice versa"); across 3,073 C# repos design and architecture smells co-trend (ρ = 0.85) and design smells
  Granger-cause architecture smells, yet "the majority of smell pairs do not collocate". CodeScene: failed refactorings
  where "the complexity slips back in" were found "more often than not". Fowler: a smell is "a surface indication that
  usually corresponds to a deeper problem in the system".
- **Severity:** inherits the severity of the underlying structural smell; never lower the structural finding because
  the local site was fixed.
- **Remediation:** fix the site (§(c) criterion 1 — correctness first), then report the structural finding with its
  evidence (other sites, co-change %, graph edge) and a named structural move + migration path, escalating per §(c)
  thresholds. Trap: blocking the local fix on the structural one.
- **Not a finding when:** §(b) rung 2 and rung 6 show the site is unique and not coupled.
- **Architecture:** yes when the underlying smell is RC-15..RC-35.
- **Sources:** https://arxiv.org/pdf/1904.11755 ; https://www.tusharma.in/preprints/architecture_smells.pdf ; https://codescene.io/docs/guides/technical/complexity-trends.html ; https://martinfowler.com/bliki/CodeSmell.html

---

## Open questions / unverified

1. **Ousterhout red-flag wording** is from two readers' notes (Portebois quotes with chapter numbers; Sivers), not the
   print book. The term "change amplification" as a named symptom comes from a search-result snippet of lethain's notes
   (page body not opened); Sivers' notes give the definition without the label. Deep/shallow and entanglement are primary
   (Ousterhout's own repo).
2. **Garcia et al. 2009 primary texts** (QoSA "Toward a Catalogue of Architectural Bad Smells"; CSMR "Identifying
   Architectural Bad Smells") could not be opened (paywalled). Extraneous Adjacent Connector and Scattered Parasitic
   Functionality definitions are via Sharma's taxonomy; Ambiguous Interface via Sharma et al. 2020 citing Garcia;
   **Connector Envy's definition is `UNVERIFIED`** — only the name is confirmed.
3. **Newman's coupling types** (domain, pass-through, common, content) — definitions via Lebrero's notes; the O'Reilly
   chapter returned 403. "Temporal coupling" and "chatty" framings in Newman were not opened; RC-33 relies on Taibi et
   al. and Azure instead.
4. **Mo, Cai, Kazman, Xiao "Hotspot Patterns"** (WICSA 2015: Unstable Interface, Implicit Cross-Module Dependency,
   Unhealthy Inheritance, Cross-Module/Package Cycle) — PDF 403 from DTIC; only abstract-level claims via search. The
   "implicit cross-module dependency" class in §(a) is named from that abstract and supported numerically by PairSmell,
   not by the primary.
5. **Arcan Unstable Dependency rule text** reads "`Intability(x) > Instability(y) + delta` for all containers y such
   that x depends upon" — as written this flags a package _more unstable_ than its dependencies, which is SDP-compliant;
   it appears inverted relative to the prose ("depends on other components that are less stable than itself"). Treat the
   prose as authoritative; the delta value is not documented on that page. Arcan's JS/TS language support was not
   checked.
6. **Thresholds that were set for Java/C#** (Designite God Component >30 classes / >27,000 LOC; Feature Concentration LCC
    > 0.2; Dense Structure average degree > 5; Arcan data-driven thresholds from Qualitas Corpus) have no validation for
    > JS/TS folder or package granularity. Use as orientation, not gates.
7. **Abstractness (A) and D for TypeScript** have no tool; the "exported types/ports vs implementations" approximation in
   RC-17 is this file's proposal, not a sourced metric.
8. **Knowledge-island ~80% top-author share** (RC-29) is a heuristic, not a sourced threshold; code-maat and CodeScene
   publish no numeric cut-off in the pages opened.
9. **Steiger** (FSD linter) rule names, **oasdiff** behaviour, and **madge `--depends`** were cited from general
   knowledge/README without running them (madge flags are from its 8.0.0 README).
10. **Kent C. Dodds decision tree** is his (chart credited to Stephan Meijer); no primary research backs "global state is
    one of the leading causes of slow React apps" beyond his experience.
11. **Form-state ownership row** in the frontend table has no opened source.
12. **dependency-cruiser `--affected`** silently printed nothing when run from a package subdirectory (validated); whether
    this is intended behaviour or a bug was not checked in the issue tracker.
13. Fowler's "Preparatory Refactoring" bliki URL returned 404 this session; the practice is cited via Beck's tweet and
    Tidy First? only.
14. **Deliberately out of scope:** Taibi et al.'s ESB Usage (7% experienced, harmfulness 6), Too Many Technologies (11%,
    4), Local Logging, Lack of Monitoring, No API-Gateway, Lack of Microservice Skeleton and the organisational
    anti-patterns (Legacy Organization, Common Ownership, Non-homogeneous adoption, Focus on latest technologies, No
    DevOps tools) are platform/organisation decisions a code-quality agent cannot observe in a diff; they are listed
    here so their absence is not mistaken for an oversight.
