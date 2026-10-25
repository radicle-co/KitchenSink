# Designer A, round 1: Now and next

**The idea.** Every screen answers two questions: what do I do now, and what is coming. The cook never has to hold
the next step in memory. A wait in the recipe becomes a calm "while you wait" moment. It offers work from later
steps, and the cook takes it or rests.

**Decisions.**

1. **Now is one goal with its actions as short lines** ("Butter the chicken": mash, strip, push). Each line has its
   amount in 600 and a 32 pt tick. Ticking is optional, and a ticked line stays visible, muted, as a record of what is
   done. Need IDs: CK-034, CK-001, CK-020, CK-008.
2. **Next is always on screen, under Now, and quieter.** It is an outlined card, 17 pt, with the step number, a
   one-line summary and the things it needs. On tablet and web a third, quieter line adds "Then", because cooks look
   one or two steps ahead. Need IDs: CK-033, CK-003, CK-021.
3. **The fast stretch is warned one step early.** Next steps that run together turn Next into a sand-tinted card,
   "Next 2 steps go fast". It lists what to have out before tapping Done. Need IDs: CK-021, CK-022.
4. **A wait becomes the moment.** While the roast runs, the top card is the countdown at reading size, with the one
   cue that falls inside it ("At 1:10:00, turn the oven down. You will be told"). Under it:
    - **The optional task list.** It shows two tasks at most, taken from later steps. Each shows its source
      step and time, and has a "Do it now" button.
    - **A plain line for the quiet stretch:** `After that, nothing needs you for about an hour`.
    - **Suggest, never schedule.** The cook can ignore the tasks, and the Done button names the obvious next move.
      Need IDs: CK-033, CK-003, CK-036, CK-007.
5. **Timers live in a dock that survives every screen.** Each timer is named by its task and step ("Rest the chicken ·
   step 7"). It shows the time at reading size, so a cook can read it from across the counter, and has a 52 pt
   Pause. Two timers stack in the dock. Need IDs: CK-031, CK-020.
6. **A finished timer reaches a cook who is not looking.**
    - **The alarm:** on the lock screen it is a full alarm, through silent mode: AlarmKit on iOS 26, and the alarm
      path on Android. It shows the task and step, rings until Stop, and offers +5 min.
    - **Back in the app:** the finished timer becomes the new Now ("Take the chicken out"). The dock row turns sand
      with a bell and counts on past zero ("Over by 0:00:42"), and Stop is filled.
    - Color is never the only signal: the bell, the words and the count carry it. CK-030, CK-031, NFR-004.
7. **Ingredients come from any step, in the order of use.** `For this step` is first, then `Coming up`, then `Used`.
   Servings sit above them. On phone they are a sheet over the step. On tablet and web they are a pinned column.
   Need IDs: CK-001, R1, CK-012, CK-020.
8. **No swipe.** A wet finger or a splash can scroll by accident, and losing the place costs more than a tap saves.
   Done is 72 pt and wide. Back is 72 pt and narrow, so it is hard to hit by mistake. Need IDs: CK-002, CK-008.
9. **Tablet 1194 in a stand has three columns:** ingredients, then Now and Next, then timers, while-you-wait and a
   "Done" record. Web 1280 uses the same layout. Need IDs: CK-032, CK-016.
10. **Type: one cooking reading size, 30 pt**, for action lines and timers. Everything else is 13 or 17, so there are
    three sizes per screen. At 30 pt a phone capital is about 12.8 arc-minutes at 3 feet and 16 at about 2.4 feet. On a
    tablet in a stand it is about 16 at 3 feet. I chose 30, not 34, so that Now and Next fit together on a 390 phone.
    The research shows tablets, not phones, are the devices read from across the counter (CK-032). Dynamic Type
    raises it.

**Rejected.**

- **One step per screen (the first attempt).** The research's strongest conflict: no next step and no wait state.
- **A scheduled parallel plan** (the app reorders the recipe). Cooks rated a planned order 3.5 out of 10, and
  experienced cooks rated it 2.0 (CK-003).
- **Chatty tips during waits.** Unprompted tips were missed, and some cooks found chatter in the way (CK-036). This
  design offers one cue and two optional tasks, never more.
- **A full timer screen** (timers that hide the recipe failed in five apps, CK-031), and **a sideways phone** (no
  evidence, CK-032).

**Both cooks.** The struggling cook gets the place, the next step, what to have ready, ticks and a calm wait. The experienced cook
reads past Next and the tasks, never ticks, and taps Done once per step. Nothing blocks or asks to be dismissed
(brief §3b).

**Open question.** A phone that is the cook's only device: is 30 pt enough there? The other choice is 34 pt, with Next cut to one line.
