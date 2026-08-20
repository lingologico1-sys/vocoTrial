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
   * THE COUNTDOWN COUNTS DOWN, not up. "Il te reste 3 questions" is a thing to
   * finish; "3 sur 8 répondues" is a score, and a learner mid-conversation who
   * reads a score reads it as a mark. Same number, and only one of them is
   * about the lesson rather than about them.
   */
  questionsLeftOne: 'Il te reste 1 question',
  questionsLeftMany: 'Il te reste {n} questions',
  questionsAllDone: 'Tu as répondu à toutes les questions',
  /*
   * Said once the list is done, because the call does not end there and a
   * learner who thinks it has will stop talking and wait.
   */
  questionsKeepTalking: 'Continue à parler avec ton tuteur jusqu’à la fin.',

  // --- The call
  starting: 'Connexion…',
  hangUp: 'Raccrocher',
  micStart: 'Commencer la conversation',
  pillStart: 'Clique ici pour commencer',
  pillAgain: 'Clique ici pour recommencer',
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
  evalRemaining: (text: string) => `Encore ${text} de conversation pour être évalué.`,
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

  // --- The consigne, read back in the report
  evalTaskTitle: 'Ta consigne',
  evalTaskMet: 'Réussi',
  evalTaskPartly: 'En partie',
  evalTaskMissing: 'Pas vu',
  /*
   * Said in as many words because "Pas vu" on its own reads as a failure, and
   * it is not one: the tutor steers the conversation, so a structure that never
   * came up is as often the conversation's doing as the learner's.
   */
  evalTaskMissingNote: 'Cette structure n’est pas apparue dans la conversation.',

  evalBestTitle: 'Tes meilleures phrases',
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
