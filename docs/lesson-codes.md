# The lingomondo lesson code

A student is handed six characters. They type them into whichever app the
lesson lives in and the lesson opens. That is the whole feature, and this file
is the contract the apps have to agree on so that it can one day be *one* box
rather than three.

This is written down because the format is not any one app's to change.
LingoLecto has been minting these since before vocoTrial had a student page;
vocoTrial matches it as of this commit; scriptomondo has no code system yet and
should copy this rather than invent a fourth thing.

## The format

| | |
|---|---|
| Length | 6 characters |
| Alphabet | `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` |
| Example | `K7MPQR` |
| URL parameter | `?token=K7MPQR` |
| Case | Upper on the way out; accepted in any case on the way in |
| Prefix | None |

The alphabet is the 26 letters and 10 digits minus `I`, `O`, `0` and `1` — the
characters that get read for one another off a whiteboard. 32 characters, so
six of them is 32^6, a little over a billion.

`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, in that order, is the string itself. Two
apps agreeing on "no confusable characters" but writing the set differently
still agree on the contract; the constant is written out in each app so that a
reader can compare them by eye.

## What each app owes

**Minting.** Draw `LESSON_CODE_LENGTH` characters from the alphabet, then check
the code is not already taken *in your own store* and draw again if it is.
Retry a bounded number of times and fail loudly rather than overwriting — a
collision that silently replaces a live lesson is the one failure worth
spending code on. LingoLecto retries 20 times against an R2 prefix list;
vocoTrial does the same in `functions/api/sessions/publish.ts`.

**Accepting.** Trim, upper-case, then match against the alphabet — not against
`[A-Z0-9]`. A code with an `O` in it was mistyped, and answering "that is not a
code" is more use to the student than a lookup that finds nothing.

**Linking.** `?token=` is the parameter. It is LingoLecto's, it is already in
circulation on links handed to real students, and a second spelling would mean
every future shared link had to know which app it was pointing at. vocoTrial
used to read `?c=`; it reads `token` now and no longer accepts the old name.

**Never treating a code as a secret.** A code is the student's entire
credential today, and a billion-wide keyspace is not a keyspace to defend one
with. It stops a typo landing in another class's lesson. It does not stop
somebody grinding the space, and no app should put anything behind a code that
it would mind a stranger reaching. The fix is real accounts, and all three apps
owe that.

## What is deliberately missing

**A code does not say which app it belongs to.** Nothing in `K7MPQR`
distinguishes a reading from a conversation, and two apps minting independently
can land on the same six characters. That is the cost of dropping vocoTrial's
old `VOCO-` prefix, and it was paid on purpose: a code that announces its app
cannot be the code a shared resolver hands to whichever app owns it.

**So there is no shared resolver yet.** The thing this format exists to make
possible — one box, any lingomondo lesson — needs a registry mapping a code to
an app, and the three apps do not have one. It probably belongs in
`mondo-monorepo` rather than in any of them. Until it exists:

- each app checks uniqueness only within its own store;
- a cross-app collision is possible and would show as a student reaching the
  wrong app's lesson, or reaching nothing;
- a student needs to know which app to open, which is what the link in their
  hand tells them.

Building the registry is the moment to decide whether existing codes are
migrated or grandfathered. Nothing here forecloses either.

## Where it lives in each app

| App | Format owner | Minted in | Read in |
|---|---|---|---|
| vocoTrial | `src/realtime/lessonCodes.ts` | `functions/api/sessions/publish.ts` | `src/eleve/Eleve.tsx` |
| LingoLecto | inline, `src/index.js` | `src/index.js`, the publish handler | `public/index.html` |
| scriptomondo | — | — | — |

LingoLecto calls it a *token* throughout its own code. It is the same thing;
the URL parameter keeps that name for the reason given above.
