/**
 * Every word on the student page, in one place.
 *
 * THE CHROME IS IN THE TARGET LANGUAGE, not in the learner's. A student
 * learning French meets a French page — the tabs, the buttons, the empty states
 * — because the twenty minutes around a conversation are as much exposure as
 * the conversation, and a page that switches to English the moment the tutor
 * stops talking teaches that French is the exercise rather than the medium.
 *
 * WHAT IS NOT HERE IS AS DELIBERATE. Word definitions, grammar notes and the
 * end-of-call evaluation arrive in the learner's own language, because those
 * are explanations — a grammar note the reader cannot read is not immersion,
 * it is a blank. Those come from the model, in the L1 the student picked, and
 * never pass through this table.
 *
 * FRENCH ONLY, FOR NOW. A second target language is a second table and a lookup
 * keyed on the session's language — which is why this is a flat object of
 * finished strings rather than French prose scattered through the JSX. The
 * shape is the migration path; nothing else about it matters yet.
 */

export const FR = {
  // --- Chrome
  tagline: 'Parle avec ton tuteur',
  l1Label: 'Ma langue',
  /*
   * ONE TAB, TWO NAMES, AND THE NAME FOLLOWS THE LESSON. Before the first
   * conversation ends it is where the consigne lives, and calling it Évaluation
   * then would name a thing the student cannot have yet. Afterwards the
   * consigne has been acted on and the reading is what the tab is for. The id
   * behind both is unchanged — see Eleve.tsx.
   */
  tabConsignes: 'Consignes',
  tabEvaluation: 'Évaluation',
  tabDictionary: 'Dictionnaire',
  tabVocab: 'Vocabulaire',

  // --- The consigne
  consigneTitle: 'Ta consigne',
  consigneQuestions: 'Les questions',
  /*
   * Shown under the questions when there is no consigne prose, so the panel
   * never opens on a bare numbered list with nothing saying what to do with it.
   */
  consigneNoBrief: 'Réponds à ces questions en parlant avec ton tuteur.',
  /*
   * THERE WAS A COUNTDOWN HERE — "Il te reste 3 questions", counting down
   * rather than up, because a learner mid-conversation who reads "3 sur 8" is
   * reading a mark. It went when per-question reporting had to go, and it has
   * not come back with it: the questions tick on the consigne itself now, which
   * says the same thing without putting a number in front of a learner. See
   * ConsignePanel.
   */
  questionsAllDone: 'Tu as répondu à toutes les questions',
  /*
   * Said once the list is done, and it now says the opposite of what it used to.
   *
   * The old line was "keep talking until the end", written when a clock ran the
   * conversation and finishing the questions changed nothing. Finishing them is
   * the end now — the page tells the tutor to close — so a learner told to keep
   * going would be talking against a tutor that is saying goodbye. What they
   * need instead is a second of warning, so the goodbye is not abrupt.
   */
  questionsKeepTalking: 'Ton tuteur va conclure la conversation.',

  // --- The call
  starting: 'Connexion…',
  hangUp: 'Raccrocher',
  micStart: 'Commencer la conversation',
  pillStart: 'Clique ici pour commencer',
  pillAgain: 'Clique ici pour recommencer',
  pillOpening: 'Le tuteur commence…',
  pillListening: 'Je t’écoute…',
  pillWaiting: 'À toi de parler.',
  bubbleIdle: 'Ton tuteur te parlera ici.',
  /*
   * Said in the first person plural on purpose. The call was not dropped and
   * nothing went wrong — it ended because nobody was using it, and a learner who
   * walked away should come back to a page that reads as patient rather than as
   * broken. The one thing it must not do is look like the errors above it.
   */
  idleEnded: 'La conversation s’est arrêtée : personne ne parlait plus.',
  /*
   * The other way a call ends by itself, and it must not read like the line
   * above it. That one is "nobody was here"; this one is "you were here and
   * the tutor was not", which is a different thing to be told and the only one
   * of the two that is nobody's fault but ours.
   *
   * IT SAYS THE ANSWERS ARE KEPT BECAUSE THEY ARE. The report is written from
   * the transcript rather than from the count, and the gate on it is two
   * minutes of conversation and not a finished list — so a learner cut off at
   * question four still has everything they said and can still be marked on
   * it. A student who thinks the lesson was lost will start again from the
   * top, which is the one outcome worth writing a line to prevent.
   */
  tutorGone:
    'Le tuteur ne répond plus. Ce n’est pas de ta faute — tes réponses sont bien enregistrées.',

  // --- No session published
  /*
   * THE CODE SCREEN. A student arrives with six characters read off a board and
   * types them in; there is no other way in, which is what stops one class
   * seeing another's lesson. The wording says "ton professeur" rather than
   * naming a page or a link, because the code comes from a person.
   */
  codeTitle: 'Ton code',
  codeBody: 'Entre les six caractères que ton professeur t’a donnés.',
  codeAction: 'Ouvrir la conversation',
  /*
   * Two misses, said differently on purpose. One is "that is not a code at
   * all", which sends the student back to what they typed; the other is "that
   * code is not one of ours", which sends them back to their teacher. Reading
   * the same sentence for both would hide which of the two it was.
   */
  codeMalformed: 'Un code, c’est six lettres et chiffres. Vérifie ce que tu as tapé.',
  codeUnknown: 'Aucune conversation sous ce code. Redemande-le à ton professeur.',
  loadFailedTitle: 'Impossible de charger ton tuteur',
  loadFailedBody: 'Vérifie ta connexion, puis recharge la page.',
  retry: 'Réessayer',

  // --- Evaluation
  evalIdle: 'Ton évaluation apparaîtra ici à la fin de la conversation.',
  evalDuring: 'Parle avec ton tuteur. L’évaluation viendra après.',
  evalTooShort: 'Il faut parler au moins deux minutes pour être évalué.',
  /*
   * Why the button under this line is greyed out.
   *
   * IT NAMES THE REASON, NOT THE RULE. "Encore 40 s de conversation" told the
   * learner what the app wanted without saying why it wanted it, and a button
   * they can see but cannot press needs the why or it reads as broken. What is
   * short is their own answers — a level is read off how much they said, and
   * under two minutes of conversation there is not enough of it to place them
   * honestly. The shortfall still gets named, because a learner who is told
   * only "too short" cannot tell whether they are ten seconds or five minutes
   * away.
   */
  evalRemaining: (text: string) =>
    `Tes réponses sont trop courtes pour évaluer ton niveau avec justesse. Encore ${text} de conversation.`,
  /*
   * The same shortfall, said to somebody who did finish. It has to differ,
   * because the plain line reads as "you did not do enough" to a learner who
   * did everything they were set — the list was simply short. It names the real
   * reason instead, which is that a minute of speech is not enough to read.
   */
  evalRemainingDone: (text: string) =>
    `Tu as répondu à tout, mais très vite : tes réponses sont trop courtes pour évaluer ton niveau avec justesse. Encore ${text} de conversation.`,
  evalButton: 'Évalue-moi',
  evalWorking: 'Je relis notre conversation…',
  evalFailed: 'L’évaluation n’a pas pu être écrite.',
  evalElapsed: (text: string) => `Durée : ${text}`,

  /*
   * The mid-call line, said twice over because it is read in two places. The
   * long one is what the panel says when there is no consigne to show; the
   * short one is the strip under the questions, where the questions themselves
   * have already made the point that a conversation is happening.
   */
  evalLive: 'Conversation en cours',

  evalBestTitle: 'Tes meilleures phrases',
  /*
   * The risk section, and the wording is doing real work.
   *
   * "Tes risques" would read as a warning. What it reports is the opposite: how
   * far the learner reached past the easy answer, with a failed reach counting
   * for more than a safe success. The heading has to carry that, because a
   * learner who reads it as a fault column learns to play safer — which is the
   * exact behaviour the section exists to undo.
   */
  evalAmbitionTitle: 'Tes prises de risque',
  evalAmbitionStretched: 'Tu as osé des structures difficiles.',
  evalAmbitionMixed: 'Tu as osé par moments.',
  evalAmbitionSafe: 'Tu es resté sur des phrases sûres.',
  evalBestEmpty: 'Rien à citer cette fois — parle un peu plus la prochaine fois.',
  evalLevelTitle: 'Ton niveau',
  evalLadderTitle: 'Ce que tu as montré',
  evalPatternsTitle: 'À corriger',
  evalNextTitle: 'Pour progresser',
  evalUnplaced:
    'Tu n’as pas assez parlé pour que je puisse situer ton niveau. Recommence et parle plus longtemps.',
  evalYouAre: (band: string) => `Tu es au niveau ${band}.`,
  evalBorderline: (band: string) => `Tu es tout près du niveau ${band}.`,
  evalSaid: 'Tu as dit',
  evalBetter: 'Mieux',

  /*
    --- The advanced marker

    A SECOND READING, NOT A SECOND VOICE. Everything below belongs to the exam
    rubric a teacher can pick instead of a scale — see evaluators.ts — and it
    follows the same division as the rest of this file: French chrome, and
    anything explaining a mistake arriving from the model in the learner's own
    language. Nothing here is generated.

    THE DETERMINISTIC PROSE IS TRANSLATED HERE RATHER THAN SHIPPED IN ENGLISH.
    Stage 3 computes its can-do statements and its confidence note as English
    strings — they are the same on every run, so a model has no business
    rewriting them — and rendering those raw would put English paragraphs under
    a French heading. The panel keys off `can_do_key`, `confidence_coverage` and
    `confidence_sample` instead, and the English originals stay in oralMarker.ts
    for whatever teacher-facing surface comes later.
  */
  advTitleIb: 'Ta note',
  advTitleCefr: 'Ton niveau',
  advAlsoIb: 'Sur l’échelle IB',
  advAlsoCefr: 'Sur l’échelle CECRL',
  /*
    The one line that keeps two answers from competing.

    A student who reads a 6 and "B1 emerging" in the same panel will try to make
    one explain the other, and they do not: the mark is a grade out of 7, the
    level is a list of things you can do. They are computed from the same three
    criteria and never from each other, so they are free to disagree — and when
    they do, the disagreement is the informative part.
  */
  advTwoScales:
    'Ces deux résultats ne mesurent pas la même chose : la note situe ta performance sur 7, le niveau décrit ce que tu sais faire. Il arrive qu’ils ne disent pas exactement la même chose.',
  /*
    The mark, to the nearest half point, with a French decimal comma.

    ALWAYS ONE DECIMAL, including on a whole number: "6,0 / 7", never "6 / 7".
    The zero is what tells a student the scale has halves in it, and a scale
    that shows halves only sometimes teaches nobody where 6,5 came from.

    This replaced "Bande 5–6 / noté 6 pour l’instant". A band is arithmetically
    honest — it is exactly the set of profiles where the three criteria
    disagree — and students read it as its lower number, which is the one thing
    it does not mean. The half point carries the same information with nothing
    left to interpret. See `computeHalfMark`.
  */
  advHalfMark: (mark: number) => `${mark.toFixed(1).replace('.', ',')} / 7`,
  /*
    The weakest criterion, named.

    This is what survived the band. "Bande 5–6" was never the useful half of
    that display — the useful half was the sentence saying which of three things
    was holding the mark down, and that sentence works just as well under a
    number as under a range.
  */
  advLimiting: (names: string) => `${names} : c’est ce qui te coûte le plus de points.`,
  advCriteriaTitle: 'Le détail',
  advCriterionA: 'Langue',
  advCriterionB: 'Vocabulaire et pertinence',
  advCriterionC: 'Interaction',
  advOutOf: (score: number) => `${score}/7`,
  advStrengthTitle: 'Ce que tu as bien fait',
  advFixesTitle: 'À corriger',
  advPractiseTitle: 'À travailler',
  advPractisePrompt: 'Essaie de répondre à ça',
  advCanDoTitle: 'Ce que tu sais faire',
  /*
    CAN_DO from oralMarker.ts, in French, keyed the same way.

    Written to the student rather than about a candidate — the CEFR originals
    are "Can narrate past events", which is a descriptor an examiner reads. A
    learner reads "tu sais raconter", and the difference between those two
    sentences is most of what makes a level feel like an achievement rather
    than a classification.
  */
  advCanDo: {
    B1: [
      'Tu sais raconter des événements passés et décrire comment c’était.',
      'Tu sais parler de tes projets et expliquer tes choix.',
      'Tu sais tenir une conversation imprévue sur des sujets familiers sans beaucoup d’aide.',
      'Tu sais donner ton avis et le justifier brièvement.',
    ],
    B1_EMERGING: [
      'Tu es à l’aise sur les sujets familiers et tu commences à raconter au passé.',
      'Tu sais donner des raisons simples pour tes opinions, mais pas encore à chaque fois.',
      'Tu comptes encore sur ton interlocuteur pour ouvrir de nouveaux sujets.',
    ],
    A2: [
      'Tu sais décrire ta famille, tes études, ton environnement et ta routine en termes simples.',
      'Tu sais parler d’événements récents en phrases courtes et reliées.',
      'Tu sais participer à de courts échanges sur des sujets familiers, avec un peu d’aide.',
    ],
    A2_EMERGING: [
      'Tu sais répondre brièvement sur des sujets proches et familiers.',
      'Tu sais faire des phrases simples au présent ; le passé et le futur sont encore fragiles.',
      'Tu as encore besoin qu’on répète ou qu’on simplifie assez souvent.',
    ],
    A1: [
      'Tu sais utiliser des mots isolés et des phrases apprises sur des sujets très familiers.',
      'Tu as besoin de répétitions, de reformulations et d’aide pour avancer.',
    ],
  },
  advUnplaced:
    'Tu n’as pas assez parlé pour recevoir une note. Recommence et parle plus longtemps.',

  /* What a narrow conversation cost. Never phrased as a penalty — see R3. */
  advConfidenceTitle: 'Ce que cette conversation pouvait mesurer',
  advCoveragePartial:
    'Une partie seulement des questions difficiles a été posée, donc certaines structures n’ont jamais eu l’occasion d’apparaître.',
  advCoverageMinimal:
    'Aucune question ne demandait de raconter au passé ni de donner un avis, donc ces structures n’ont jamais eu l’occasion d’apparaître. Ta note reflète ce que les questions permettaient de montrer.',
  advSampleThin: 'La conversation était courte : quelques questions de plus donneraient une image plus complète.',
  advSampleShort: 'La conversation était trop courte pour juger avec certitude.',
  /* R3 again, said to the student in one sentence. Nothing was taken away. */
  advNoPenalty:
    'Rien ne t’a été retiré pour autant : on n’évalue que ce que la conversation a permis de montrer.',

  /*
    The two caveats this mode owes a student, and neither is optional.

    The first is spec §1.1, which asks for a fixed disclaimer beside any mark:
    this reads one section of one exam, and pronunciation is not in it. Rendered
    in French rather than the spec's English, because the page is French and a
    disclaimer nobody reads protects nobody.

    The second is §3b, and it is the more honest of the two. The transcript came
    from a speech model that quietly repairs learner grammar as it listens, so
    the grammar mark is only as good as what survived. Saying so is what makes
    this practice feedback rather than a grade.
  */
  advDisclaimer:
    'Note projetée pour la conversation générale seulement. Ce n’est pas une note officielle d’évaluation interne IB. La prononciation et l’intonation ne sont pas évaluées.',
  advTranscriptCaveat:
    'Cette lecture se fait sur la transcription de ce que tu as dit, et la transcription corrige parfois les petites erreurs toute seule. À utiliser pour progresser, pas comme une note définitive.',

  // --- Dictionary
  dictPlaceholder: 'Tape un mot français…',
  dictSearch: 'Chercher',
  dictEmpty: 'Tape un mot français, ou appuie longuement sur un mot de la conversation.',
  dictLoading: 'Je cherche…',
  dictNoResult: 'Je n’ai rien trouvé pour ce mot.',
  dictSave: 'Ajouter à mon vocabulaire',
  dictSaved: 'Dans ton vocabulaire',
  dictConjugation: 'Conjugaison',

  // --- Vocab
  vocabEmpty:
    'Ton vocabulaire est vide. Cherche un mot dans le dictionnaire, puis ajoute-le à ton vocabulaire.',
  vocabEmptyCategory: 'Aucun mot dans cette catégorie.',
  vocabSortAlpha: 'A–Z',
  vocabSortRecent: 'Récent',
  vocabCount: (n: number) => (n === 1 ? '1 mot' : `${n} mots`),
  vocabRemove: 'Retirer',
  vocabCats: {
    all: 'Tous',
    verb: 'Verbe',
    noun: 'Nom',
    adjective: 'Adjectif',
    adverb: 'Adverbe',
    expression: 'Expression',
    other: 'Autre',
  } as Record<string, string>,
} as const;

/**
 * A duration, said the way a person says it.
 *
 * Used for the elapsed clock and for how much longer is needed before the
 * evaluation unlocks, so it has to read naturally at both ten seconds and ten
 * minutes. Seconds are dropped past a minute: "2 min" is what somebody wants to
 * know, and "2 min 03 s" invites them to watch it.
 */
export function frenchDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  if (minutes === 0) return `${seconds} s`;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds} s`;
}
