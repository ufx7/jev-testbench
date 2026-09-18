# jev-testbench

Two related tools for working with [TypeSafe's Jev](https://docs.typesafe.ai) model:

1. **`src/bench/`** — a black-box test bench measuring things TypeSafe doesn't
   publish: determinism, latency by payload size, the practical input-context
   ceiling, confidence/probability semantics per question type, and behavior
   under concurrent load. Run with `npm run all`, or individually (`npm run
   determinism`, `npm run latency`, etc).
2. **`src/collab/`** — a reusable harness for measuring whether pairing Jev
   with an LLM (Claude, GPT, anything) actually helps on *your* task, and how
   to wire the two together. See below.

## Setup

```bash
npm install
cp .env.example .env   # then fill in TYPESAFE_API_KEY yourself
```

## The collaboration bench (`src/collab/`)

### What it measures

Given a task with an enumerable action space (legal actions computed by your
own code at each step — no free-form action spaces), the harness runs three
arms and reports where they actually differ:

- **`llm_autonomous`** — your LLM adapter picks the next action directly,
  unconstrained. It may name something outside the legal set; that's tracked,
  not prevented, since hallucination/illegal-action rate is one of the things
  worth measuring.
- **`scripted_plus_jev`** — your code enumerates legal actions, Jev's
  Choice picks among them. No LLM generation anywhere in this loop.
- **`llm_plus_jev`** — your LLM proposes a few candidate actions with
  rationale; Jev arbitrates among them (always restricted to legal actions);
  low confidence triggers an escalation retry, and if that's still
  inconclusive the episode stops rather than guessing.

**Jev is not a peer arm to your LLM.** It makes one typed judgment per call
and stops — it can't enumerate its own options, apply an action, or manage
state. `scripted_plus_jev` is really "a scripted policy your code owns, with
Jev supplying the one judgment the code can't make itself," not an
autonomous Jev agent. Keep that framing in any write-up of results.

### Statistical rigor (why this isn't just print-the-numbers)

An earlier version of this tool printed directional claims like "arm A
improved success rate over arm B" straight off small-sample percentages.
That's the exact failure mode that makes ad hoc LLM evals untrustworthy —
report the numbers with confidence, and nobody notices they were noise. This
version instead:

- Reports a **Wilson score interval** on every success rate, not just the
  point estimate.
- Runs **exact McNemar's test**, per level, matched by episode index, for
  every arm pair — because episodes across arms on the same level are
  *paired* samples, not independent ones, and pooling across levels of the
  same nominal "difficulty" conflates a level's own hardness with the arm
  effect. A result is only called significant with p < 0.05 **and** at least
  5 discordant pairs — McNemar has low power below that regardless of p.
- Flags **ceiling effects** automatically: if every arm scores 0% or 100% on
  a level, there is no discriminative signal there, and the report says so
  instead of silently printing identical numbers next to each other.
- Tracks cost and latency **separately per model** (a Claude call and a Jev
  call are not the same unit of anything) and reports LLM cost as `n/a`
  rather than silently assuming a price, unless you supply your model's
  per-token rate.

None of this replaces running enough episodes. It just stops the tool from
telling you something false with confidence when you haven't.

### Using it on your own task

Implement `CollabTask`, and either `LLMDirectActor`, `LLMProposer`, or both
(see `src/collab/types.ts`). `src/collab/example/gridTask.ts` is a worked
example (a tiny text-navigation puzzle with a BFS-computed optimal path
length); `src/collab/example/mockLLM.ts` is a **mock** LLM stand-in used only
to prove the harness runs end-to-end without an API key — swap it for a real
adapter before trusting any result about a real model.

```bash
npm run collab-demo -- <episodes-per-arm> <confidence-threshold>
```

### Known limitations

- Only models one collaboration pattern (LLM proposes, Jev arbitrates).
  Other real patterns — Jev as a post-hoc safety/loop-detection reflex, Jev
  as a staged multi-call reviewer — need a different runner shape.
- Escalation retries currently re-ask the LLM with the same input; they
  don't yet tell it *why* it's being asked again, so a near-deterministic
  LLM may just reproduce the same low-confidence answer.
- `difficulty` is a label you assign, not something the tool verifies.
- Requires an enumerable, describable-in-text action space; doesn't cover
  continuous control, vision-based tasks, etc.
