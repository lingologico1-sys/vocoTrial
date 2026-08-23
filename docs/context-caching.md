# Context caching — what it would be worth, and what is in the way

Notes only. Nothing in this file has been acted on: every cost path still bills
cached tokens at the full input rate, and no prompt has been restructured to
earn a discount. Written down so the next person starts from the measurements
rather than from the arithmetic.

---

## The terms

Reported for `gemini-3.7-flash` on Vertex, and **not independently verified** —
this came in as prose rather than off Google's pricing page, and the model id
itself is still flagged `unverified: true` in
[report.ts](../src/realtime/report.ts) and
[oralRubric.ts](../src/realtime/oralRubric.ts), meaning no call has been
confirmed to connect on it. Treat all three numbers as claims to check before
anything is priced against them:

- **90% off** cached input tokens, against the standard input rate.
- **Implicit caching on by default** per project, no storage cost. Explicit
  caching gets the same 90% with a guarantee, and is billed for storage by the
  hour.
- **4,096 tokens minimum** to trigger caching at all.

The first pass over a prompt is charged in full either way; the discount is on
the re-reads.

That floor is the whole story below. It is not a discount that scales down
gracefully — a prefix under it earns nothing, however often it repeats.

## What each path would get

Token counts are `chars ÷ 4`, which is a proxy and not a measurement. Where a
number lands near the floor that distinction is the finding, not a caveat.

### Advanced marker — clears it, thinly

The repeated prefix is the whole instruction up to `## STATISTICS`: **~4,705
tokens** of 4,770. It is laid out the right way round already, and by design —
the fixed rubric and the worked example come first, the per-call statistics are
interpolated at the tail, and the transcript travels in `contents` after both.

Two things to know before trusting it:

- The margin over 4,096 is about 15%, inside the error of a `chars ÷ 4`
  estimate. **Confirm with `countTokens` before assuming these calls cache.**
- Per-L1 prefixes cache independently. A class sharing one L1 repeats one
  prefix all day and is fine; a rare L1 may never repeat inside the TTL. Moving
  the `${l1.label}` sentence out of the middle of the instruction would pool
  them, at the cost of burying the one line that decides what language the
  report is written in. Only worth it for a genuinely mixed cohort.

The retry in [_advanced.ts](../functions/api/report/_advanced.ts) re-sends a
byte-identical prompt seconds later, so its "a failed run pays for two full
calls" note is pessimistic under caching — the second call's *input* would drop
to a tenth. Its output is still charged in full, which is most of the bill on a
reasoning model.

### Standard report — sits under the floor

Fixed prefix **~2,590 tokens**, and the transcript after it lengthens the
request without lengthening the prefix. It cannot cache as built, no matter how
many students share a language and an evaluator.

Padding it to 4,096 would be cheaper per call — 410 tokens charged against
2,590 — but the honest version of that change is to give this path a worked
example the way the oral rubric has one, which crosses the floor *and* improves
the marks. That is a piece of work, not a caching tweak.

### Dictionary lookups — far under it

**~955 tokens** fixed. Correctly ordered (instruction, then the two-turn
few-shot, then the ask) and nowhere near the minimum. Nothing worth doing:
inflating a word lookup to 4k tokens to save a fraction of a cent is a bad
trade in both latency and design.

### Live tutor calls — out of scope entirely

Context caching is a `generateContent` feature; the Live socket takes no cache
handle. This is also where the money actually is — audio in and out, at rates
an order of magnitude above text — so a 90% discount on the report paths does
not touch the dominant line of the bill. The lever there remains
`contextWindowCompression`, which the setup frame does not set. See the
`ceilingUsd` note in [cost.ts](../src/realtime/cost.ts) for what the re-read
costs today.

## The change that is now unblocked

[analyse.ts](../functions/api/report/analyse.ts) prices cached tokens at the
full rate and says why: no confirmed figure. That condition is met if the 90%
above holds — and the fix is two-part, because `promptTokenCount` **includes**
the cached tokens rather than sitting beside them:

```ts
const cached = usage?.cachedContentTokenCount ?? 0;
const fresh = (usage?.promptTokenCount ?? 0) - cached;
// fresh × rate + cached × rate × 0.1
```

Same shape in `_advanced.ts`. Re-rating without the subtraction would count the
cached tokens twice.

Both routes already read `cachedContentTokenCount` and
[diagnostic.ts](../src/eleve/diagnostic.ts) already prints it, so **whether any
of this is firing can be read off one real report against the deployment** — no
documentation required. That measurement is the right first step, and it costs
one call.
