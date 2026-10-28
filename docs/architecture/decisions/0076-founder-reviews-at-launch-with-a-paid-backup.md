# 0076: At launch the founder reviews flagged content, a paid backup covers, and a half-time reviewer is hired on a volume trigger

- **Status:** Accepted
- **Date:** 2026-10-27
- **Amends:** [ADR-0074](0074-content-source-check.md). Its decision stands in full: the hold lives in the read rule,
  only rules block, and every reviewer is an employee. This ADR adds two things: who does the review work at launch,
  and the point at which a dedicated reviewer is hired. It answers ADR-0074's residual risk "the queue has no automatic way out" for the
  people side only.
- **Relates to:** spec [016](../../../specs/016-legal-compliance-framework/spec.md). It holds `016-FR-017a`, the 24-hour
  target for copyright and illegal-content notices, and `016-FR-017c`, the overdue alert. It holds `016-FR-053f` and
  `016-FR-053g`, an individual account with the review scope. It also holds the two requirements this ADR adds:
  `016-FR-053h`, who reviews and how the backup is engaged, and `016-FR-053i`, the hire trigger. Spec
  [020](../../../specs/020-content-source-check/spec.md): `020-FR-026a` (an appeal goes to a different reviewer),
  `020-FR-026b` (reviewers are employees), `020-FR-030` (no decision time target for referrals) and `020-FR-039a`
  (the shadow-mode referral forecast).

## Context

Two kinds of flagged content need a person:

- **Notices** under spec 016. A notice on copyright or illegal content must be decided within 24 hours of
  acknowledgement (`016-FR-017a`), and the clock runs on weekends. Any other ground has 7 days.
- **Referrals** under spec 020. A recipe headed for public view waits for a person whenever the check cannot clear
  it. No decision time target is set (`020-FR-030`). A slow review never publishes anything. The hold is in the read
  rule (ADR-0074 §1).

The specs require that a person decides, and that every recipe reviewer is an employee, never a user
(`020-FR-026b`). They did not say how many people, or from when. Spec 020 already allowed the owner to be the only
reviewer at launch. The 2026-10-27 path-to-success analysis looked at the business plan's staffing section. That
section budgeted a half-time employee reviewer from the first month, at about $2,773 a month. The figure is 0.5 FTE
at the BLS 43-4051 median wage for customer service representatives, times a 1.429 employer load. That one role cost about five times
the plan's first-month revenue. Nothing in the specs required it, and no measured workload supported it. Shadow mode
(`020-FR-039a`) exists to forecast that workload before anyone is hired.

The owner ruled on 2026-10-27 that the founder reviews flagged public content at launch. A paid backup reviewer
costs about $555 a month. The half-time reviewer is hired once a volume trigger is met. The owner also ruled to keep
the 24-hour target and every legal requirement, and to change only who does the work and when.

## Decision

### 1. The founder is the first reviewer at launch

The founder decides notices and referrals from launch. The founder is staff, so `020-FR-026b` holds. The founder uses
an individual account with the review scope, never a shared one (`016-FR-053f`, `016-FR-053g`).

### 2. One paid backup reviewer, who is an employee

- The backup is a named, part-time, hourly **employee** of the operator. Spec 016 sets no employee rule for notices,
  so a contractor is enough there. For referrals, a contractor breaks `020-FR-026b`. So the default is an employee,
  and the employee rule is not weakened.
- The budget is about 4 hours a week at $32.01 an hour, which is the same BLS 43-4051 wage times the same 1.429 load.
  That is about $555 a month. Extra hours during an absence or a busy week are paid at the same rate.
- The backup has their own account with the review scope and is trained on the same written review guideline before
  the scope is granted.
- The regular 4 hours are scheduled review on days the founder is off. They keep the backup in practice and clear
  the referral queue.
- With two reviewers, an appeal of a person's hold can go to a different person (`020-FR-026a`). An appeal of the
  founder's hold goes to the backup, and an appeal of the backup's hold goes to the founder.

### 3. How the backup is engaged when the founder is unavailable

- **Planned absence.** The founder records each planned absence in a rota before it starts. During it, the backup is
  the first reviewer for both notices and referrals.
- **Unplanned absence, for notices.** A notice still undecided at half its target pages the founder and the backup
  together: at 12 hours for the 24-hour tier, and at 3.5 days for the 7-day tier. If it is still undecided 2 hours
  after the page, the backup decides it. This is an alert before the deadline. `016-FR-017c` fires only once a notice
  is already overdue, which is too late to bring anyone in.
- **Referrals.** They have no time target (`020-FR-030`) and page nobody. The backup works them in scheduled hours
  and during absences.
- **Both unavailable.** The notice goes overdue, `016-FR-017c` raises its alert, and the miss counts toward the hire
  trigger. Nothing is published or removed by a timer.

### 4. The half-time reviewer is hired on a measured trigger

`016-FR-053i` is the one authoritative statement of the trigger. This section gives its shape and its reasons, and it
does not restate its numbers. The trigger fires on any one of four measures:

- **Review load.** Items decided in a week (notices, referrals and appeals) times the median handling minutes per
  item, above a weekly hour limit for several weeks in a row. The limit is the hours one founder can give to review
  while also building the product.
- **The notice target.** The share of copyright and illegal-content notices decided within 24 hours falls below the
  level `016-SC-015` sets, over a rolling window.
- **Backup hours.** The backup works well over the budget for several weeks in a row. That means the founder can no
  longer carry the first-reviewer role.
- **Referral wait.** The median time from referral to decision stays high for several weeks. This is a staffing
  signal only. It is not a decision time target, it promises the cook nothing, and `020-FR-030` is unchanged.

The dashboard shows each measure every week. When a trigger fires, the dashboard alerts the owner. The owner starts
the hire.
Until the hire starts, the backup works more hours at the hourly rate.

## Consequences

- Every legal requirement is unchanged: the 24-hour and 7-day targets, the statement of reasons, the individual
  attribution of every decision, the employee rule for recipe review and the read-rule hold.
- The reviewer cost before the trigger is about $555 a month instead of about $2,773. The founder's own hours carry
  the difference, and that is the risk this decision accepts.
- The 24-hour target now has a second person behind it from day one, through the page at 12 hours.
- `020-FR-026a`'s "different reviewer" works from launch.
- The hire is driven by measured load, not by a date. Shadow mode gives a first forecast of that load before launch.
- The dashboard must record handling minutes per decision, or the review-load measure cannot be computed.

## Residual risks

- **The founder's hours are the constraint.** Review, support, building and content all draw on one person until the
  trigger. A busy launch can cross the trigger in the first weeks. The trigger exists to catch that.
- **The backup is not on call around the clock.** A 4-hour-a-week employee can miss a 3am page on a holiday. A
  page that nobody answers ends in an overdue notice, which is visible, alerted and counted, never silent.
- **On-call terms are part of the hire.** Whether time spent reachable for a page is paid depends on the backup's
  location and contract. Counsel or the payroll provider settles it before the backup starts.
- **The trigger's numbers are a first setting.** They come from the path-to-success analysis and from `016-SC-015`,
  not from measured Commise load. Shadow mode and the first weeks of real load can show that they need to move. Moving
  them is a change to `016-FR-053i`, not to this ADR.

## Alternatives

- **A half-time employee reviewer from day one.** It is the business plan's earlier staffing, at about $2,773 a
  month. No spec required it and no measured load supported it.
- **The founder alone, with no backup.** It leaves the 24-hour target with nobody behind it on a weekend or a
  holiday, and makes `020-FR-026a`'s different reviewer impossible.
- **A contractor as the backup.** It is cheaper to engage and fine for notices, but it breaks `020-FR-026b` for
  referrals. The owner can still add one later, as extra cover for notices only.
- **Hire on a date, such as month 16.** A date is a guess about volume. The trigger reads the volume itself.
