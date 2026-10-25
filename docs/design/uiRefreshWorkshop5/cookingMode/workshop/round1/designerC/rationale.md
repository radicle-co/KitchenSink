# Designer C, round 1: Glance from across the kitchen

**The idea.** One screen, read at two distances. A top band shows at most two things at one cooking size: the one thing
to do, with its amount, and the time left. The rest is at 17, and the cook reads it up close.

## Decisions

1. **Type alone makes the two distances.** The phone cannot know where the cook stands. I reject proximity and camera
   sensing (privacy, battery, poor accuracy) and a mode toggle (brief §3b). Sizes: 40 far, 17 near, 13 labels (CK-016).
2. **One cooking size: 40.** With the spec's figures (cap 0.727, about 163 pt per inch on a phone, 132 on a tablet),
   40 gives a 4.5 mm capital: 15.6′ at 1 m and 17.0′ at 3 ft, so it meets SC-007. A tablet gives 19′ at 1 m. No study
   measured real reading distance. The cost is about 15 characters per line, so the far band holds three lines at most.
3. **The far band shows an action, not a step.** A step is a list of short actions in order, each with its amount
   (CK-034, P1, CK-001). The band shows the first unticked action and "2 of 4". Ticks are optional, on 56 pt rows, and
   a second tap undoes one. Next ticks the rest.
4. **The band follows the state.** Doing: the action and the soonest timer. All ticked: "Up next", step 4. Waiting:
   the time alone. Two timers: "Next to do, in 8:12: Turn the potatoes", named by task, not by clock (CK-031).
5. **The next step is always in view, and quiet.** "Then · Step 3" ends the near band (CK-033, CK-021). It moves to
   the far band once every action is ticked. It never moves on by itself (CK-003, Hamada 3.5 of 10). One step holds
   the focus and the next is a preview, which keeps FR-032's "one step at a time".
6. **A wait offers work and never plans it.** The list "While it roasts · if you like" offers only the prep of later
   steps, such as a board and foil for step 5. That prep cannot depend on the oven. No tips and no chatter (CK-033,
   CK-036).
7. **Timers.** Every timer is in the dock on every step, named by task and step. The soonest one is also in the far
   band. A cook can name a timer of their own ("Turn the potatoes · yours", CK-031).
8. **A finished timer reaches a cook who is not looking.**
    - In the app, the whole screen turns to the inverse surface once. The big change in brightness is visible from
      across a room. It shows a bell, the task at 40 and a time that counts up past zero. Stop is 112 tall,
      with + 5 and + 10 min below it. No flashing (WCAG 2.3.1), no steel fill (P4), and not colour alone (NFR-004).
    - A locked or silent iPhone (iOS 26) gets an AlarmKit alarm. Its title is the task and its one extra button is
      "Open step". The countdown is our Live Activity (CK-030).
    - If the cook does not allow alarms, a calm notice shows while a timer runs. The app still rings, because the
      screen stays on.
9. **Ingredients from any step (R1).** "11" opens a sheet. The far line stays visible above the scrim. The servings
   stepper is at the top of the list (R1, amended). The items of this step say "Step 2" in words.
10. **Wet hands.** No swipe between steps. Back and Next are 72 tall (CK-002). Text is never a target. A stray tap can
    only change a tick, and a second tap undoes it.

## Sizes (P5)

- **Drawn:** 390 light and dark, 1194 × 834 in a stand (ingredients | step | timers, CK-032), and 1280 web.
- **Left off:** 834, 1024 and 768. Below about 1100 wide the timer column folds into the dock. Round 2 draws them.

## Rejected

- The first attempt's paragraph at 34: easy to read, slow to glance at, and it hides what is next.
- A giant timer at its own size (a fourth size). Pulsing or flashing alarms (not calm, a photosensitivity risk).
- A "get ready" chime, because of alarm fatigue (CK-036). Swipes and tap zones on text, because wet touches fire them.

## Both cooks (§3b)

- **The cook who struggles** gets one action at a glance, amounts where they are used, the next step, and wait work.
- **The experienced cook** never ticks, reads the near band once, taps Next, and ignores the offers.

## Open and not checked

- **Stale far line.** A cook who never ticks sees action 1 for the whole step. It is the weakest point. Review it.
- **Data.** Steps must be stored as action lines. A step stored as a paragraph shows its first sentence.
- **Not researched:** the Android alarm path and alarms in a browser. The web note is an assumption.
- **Not tested:** the largest Dynamic Type, and real cooks. Every claim here is heuristic judgement, not user evidence.
