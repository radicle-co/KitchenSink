---
name: 'design-pattern-contracts'
description: 'Catalogue of design-pattern CONTRACTS and COMPOSITIONS for this monorepo — how to combine patterns into a coherent system, and the specific breach that makes each named pattern fail while still wearing its name. Load when selecting a pattern, designing a composition, or grading whether an existing pattern is implemented correctly.'
---

# Design-pattern contracts and compositions

Reference material, consulted per pattern. It answers two questions the repository's other documents
do not: **how do patterns combine into a system**, and **what exactly does each pattern promise**, so
a breach can be named instead of felt.

**This is not the pattern catalogue.** `docs/engineering/ENGINEERING_EXCELLENCE.md` →
_Design Patterns, Principles & Code Quality_ already lists which pattern solves which problem, plus
SOLID, deep modules, connascence and the smell list. Read that for **selection**. Read this for
**composition** and **correctness**, which it does not cover.

**The standing rule** (`CLAUDE.md`): apply a pattern **everywhere one genuinely fits**, individually
and composed. It is wrong in exactly two ways — the **wrong pattern or combination**, or the **right
pattern implemented wrong**. Count is never the failure.

---

## 1. Compositions — how patterns combine

A pattern alone solves a local problem. Patterns composed are what make a system coherent, and the
composition is where the design actually lives. When you propose one, state **what each part owns**
and **where the seams are**.

> **Test for a fake composition:** if the parts cannot be tested or replaced independently, it is one
> pattern wearing three names, not a composition.

| Composition                                       | Each part owns                                                                                     | Reach for it when                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Statechart + headless hook + adapter**          | machine owns legal transitions · hook owns orchestration/effects · adapter owns platform rendering | one behaviour must ship to web and native without duplicated logic            |
| **Registry + discriminated-union render map**     | registry owns what exists · union owns exhaustiveness · map owns per-case rendering                | new cases arrive over time and the dispatcher must not be edited for each     |
| **Specification/policy module + value object**    | policy owns the rule · value object owns the legal shape                                           | a business rule is asked in several places and must not drift between them    |
| **Ports & adapters + repository**                 | domain owns the port · adapter owns the driver · repository owns aggregate persistence             | the domain must stay testable and free of infra types                         |
| **Decorator stack over one transport**            | each decorator owns exactly one orthogonal concern (retry, cache, log, auth)                       | cross-cutting behaviour would otherwise be re-implemented per call site       |
| **Factory + strategy**                            | factory owns selection · strategy owns the algorithm                                               | which algorithm to run is a runtime decision with more than two branches      |
| **Command + optimistic update + reconciliation**  | command owns intent · optimistic layer owns the provisional view · reconciler owns truth           | a mutation must feel instant but the server is authoritative                  |
| **Builder + value object + parse-don't-validate** | builder owns assembly · VO owns invariants · parser owns the boundary                              | an aggregate is only meaningful when complete and must be illegal-state-proof |
| **Observer + event bus + idempotent handler**     | producer owns emission · bus owns delivery · handler owns effect-once                              | fan-out is needed and delivery is at-least-once                               |
| **Facade + ports**                                | facade owns the entry point · ports own the capabilities                                           | a subsystem has many collaborators but callers need one door                  |

**Composition smells**

- **Overlapping responsibilities.** Two patterns that both own "which one runs" produce a seam nobody
  can reason about. Give the decision exactly one home.
- **A seam nothing crosses.** An interface with one implementation and no test double is indirection
  tax, not a seam. Either a second implementation is real, or the boundary is imagined.
- **Transitive leakage.** The composition is only as clean as its most leaky part: a repository that
  returns ORM rows re-couples the domain no matter how correct the ports around it are.
- **Ceremony around a satisfied intent.** If the language already provides the pattern, composing
  _onto_ it adds names without adding structure. See §3.

---

## 2. Contracts — the breach that makes each pattern fail

A pattern that fails its contract is **worse than not using it**, because the name now lies to every
future reader. Grade the contract, never the label. A breach found here is a finding of the same
severity as a missing pattern.

| Pattern              | Its promise                                     | The breach to look for                                                                       |
| -------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Strategy**         | algorithms interchangeable behind one interface | reaches back into its context; or callers must configure each implementation differently     |
| **State/Statechart** | all legal transitions live in the machine       | a transition performed outside it — the invariant is gone and the diagram is now fiction     |
| **Observer**         | producers don't know consumers                  | no unsubscribe (leak); or correctness depends on notification order                          |
| **Repository**       | domain-defined persistence port                 | ORM/driver types in the signature — the domain now depends on infra                          |
| **Adapter**          | translates between two interfaces               | adds or changes behaviour; it is a decorator or a service in disguise                        |
| **Decorator**        | substitutable for what it wraps                 | changes the interface, or silently swallows/alters errors, so the stack cannot compose       |
| **Facade**           | one entry point over a subsystem                | accumulated logic and became a layer with rules of its own                                   |
| **Factory**          | hides a construction decision                   | `new` with extra steps — no branching, no invariant, no lifecycle hidden                     |
| **Builder**          | invalid only until built                        | exposes a half-built object, or `build()` can return something that fails its own invariants |
| **Registry**         | one authoritative place things are registered   | multiple registration points, so entries drift and lookup order becomes load-bearing         |
| **Singleton**        | one owned lifecycle                             | ambient mutable global state, reachable and writable from anywhere, untestable in isolation  |
| **Value object**     | equal by value, immutable                       | mutable fields, or compares by reference                                                     |
| **Command**          | intent is data, separable from execution        | executes inside its own construction, so it can't be queued, retried, logged or undone       |
| **Ports & adapters** | dependencies point inward                       | domain imports infra — the arrow reversed and the test seam died with it                     |
| **DTO**              | flat, behaviour-free boundary shape             | grew methods or invariants, and is now a domain object leaking across the wire               |
| **Template Method**  | stable skeleton, varying steps                  | subclasses override the skeleton, or the base calls back into subclass state mid-flight      |
| **Composite**        | uniform treatment of leaf and node              | callers must type-check which one they have — the point of the pattern is gone               |

---

## 3. Intent already satisfied — credit it, add nothing

The language or a library may already provide the pattern. That **counts as using it**; it is not a
gap, and adding machinery on top is the most damaging move available.

| Construct                                    | Already IS         |
| -------------------------------------------- | ------------------ |
| TS discriminated union + exhaustive `switch` | Visitor            |
| TanStack Query mutation                      | Command            |
| `React.lazy` / dynamic `import()`            | Proxy              |
| `Object.freeze` behind a factory function    | Immutable Value    |
| A zod schema parsed at the boundary          | Parser / Guard     |
| React context provider                       | Service Locator    |
| Module-scope `const` map keyed by a union    | Registry           |
| `AbortController` threaded through a request | Cancellation Token |
| A pure reducer over a union of actions       | State + Command    |

Name which one the existing construct already is, credit it in the pattern register, and stop.

---

## 4. Using this

When **selecting**: read `ENGINEERING_EXCELLENCE.md` § _Design Patterns_ for which pattern fits the
problem, then §1 here for what it should compose with.

When **grading an existing shape**: find it in §2 and check the promise, not the name. If it is not
in §2, state the contract you are holding it to before judging it.

When **something looks missing**: check §3 first — the pattern may already be there without ceremony.
