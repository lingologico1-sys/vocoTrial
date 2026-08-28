/**
 * The languages the agent will hold a conversation in.
 *
 * Shared by the browser and the Pages Functions for the same reason models.ts
 * is: the picker and the server-side allowlist cannot drift apart, and nothing
 * the client sends is passed to a provider without being looked up here first.
 *
 * Deliberately free of imports: functions/ compiles against workers-types with
 * no DOM lib, so this has to stay pure data.
 */

export interface LanguageChoice {
  /** ISO-639-1. The key the client sends; also what the prompt is built from. */
  code: string;
  /** English name, for the picker and for the agent's instructions. */
  label: string;
  /** The language's own name for itself, which is what the picker shows. */
  endonym: string;
  /**
   * How Google's Live API spells this language, where it publishes a spelling.
   *
   * ISO-639-1 is what this app stores and what a prompt is built from. The Live
   * API's `speechConfig.languageCode` takes BCP-47 with a region, and there is
   * no safe derivation between the two: the obvious `fr` -> `fr-FR` doubling
   * is right for a dozen entries here and wrong for en, pt, zh, ar and hi,
   * where a guessed region is a call that fails at connect rather than a call
   * that mishears a word.
   *
   * ABSENT MEANS DO NOT SEND IT, which is what every language did before this
   * field existed. That is why it is optional rather than filled in everywhere:
   * a language whose spelling nobody has confirmed goes on working exactly as
   * it does today, and the failure a wrong guess would cause never happens.
   *
   * ONLY THE HALF-CASCADE MODEL IS SENT ONE. Native audio takes no language
   * code at all and picks the language up from the conversation. See
   * `acceptsLanguageCode` in settings.ts, which is what decides.
   *
   * WHY IT IS WORTH SENDING AT ALL. A half-cascade model transcribes through a
   * real ASR stage, and an ASR stage that has not been told the language is
   * what put Arabic script into a French transcript where the learner had said
   * "oui". The tutor hears audio and was unaffected; the speech bubble, the
   * vocabulary list and the end-of-call report all read that text and were not.
   *
   * These are the entries Google's supported-languages table publishes for
   * Live. The rest are blank rather than guessed — `npm run probe -- --languages`
   * opens one setup per candidate and reports which the surface accepts, which
   * is how this list is meant to grow.
   */
  liveCode?: string;
  /**
   * The regional variety a tutor speaks by default, as an adjective — "Parisian".
   *
   * WHAT IT IS FOR. OpenAI's realtime API has no accent or locale field of any
   * kind: `audio.output.voice` takes a bare name and nothing else. The only
   * lever on how the tutor *sounds* is the prompt, and OpenAI's own realtime
   * guide is specific about the shape — name the variety in the role line, and
   * say it has to hold. This field is the noun that goes in that sentence. See
   * ACCENT in tutorPrompt.ts, which composes it.
   *
   * SO IT IS A SYNTHESIS FIELD AND `liveCode` IS NOT. They look like the same
   * fact spelled twice and they are not: `liveCode` is BCP-47 handed to
   * Google's ASR so it stops hedging between languages, and it never touches
   * how anything is said. This is prose handed to the model about its own
   * voice. Neither derives from the other — `fr-FR` says France, not Paris,
   * and a country is not an accent.
   *
   * ABSENT NAMES NO REGION, and composes "a native French speaker" rather than
   * nothing at all. Only French is filled in, because only French has been
   * asked for and a guessed variety is a real choice made silently: whether a
   * Spanish learner should hear Castilian or Latin American is a decision for
   * whoever is teaching them, not a default worth inventing here. Fill one in
   * when someone asks for it.
   */
  variety?: string;
  /**
   * A sample of well-formed text in the language.
   *
   * NOTHING READS THIS TODAY. It was handed to whisper-1 as `prompt`, which
   * conditions on that field as though it were the transcript leading up to the
   * audio — a style hint rather than a vocabulary list, pulling the output
   * towards the language's accents and punctuation instead of the flat
   * unaccented ASCII Whisper drifts to on hesitant speech.
   *
   * Kept rather than deleted when OpenAI Realtime was removed, because it is
   * the expensive half of an entry to write and Gemini has no equivalent field
   * to move it to: its input transcription takes no hint at all. Anything that
   * transcribes here later wants exactly this. Do not treat it as live data —
   * a wrong sample would go unnoticed until then.
   */
  sample: string;
}

/**
 * WHY THIS LIST AND NOT A LONGER ONE
 *
 * Google exposes no languages endpoint, so unlike the model ids in models.ts
 * there is nothing to ask. Gemini's native-audio models take no language code
 * at all — see the setup handling in functions/api/live/gemini.ts — and the
 * language is carried entirely by the system instruction, so there is no field
 * to enumerate against and no upstream list to mirror.
 *
 * What decided these entries was the tier that models handle well and that
 * people actually study, chosen when the app also ran whisper-1 and its ~57
 * well-performing languages were the binding constraint. The tail is still not
 * worth offering a learner: a confident wrong transcript teaches someone they
 * said a thing they did not say, which is worse than the language being absent.
 *
 * That constraint left with OpenAI, so the list is now shorter than it strictly
 * has to be. Adding one is cheap — an ISO-639-1 code, a label, an endonym — but
 * check the model actually speaks it well before offering it, because nothing
 * in the chain will refuse a language it is bad at.
 */

// First entry is the default.
export const LANGUAGES: LanguageChoice[] = [
  {
    code: 'fr',
    liveCode: 'fr-FR',
    label: 'French',
    endonym: 'Français',
    variety: 'Parisian',
    // The sample named Montréal until the variety above was filled in. It is a
    // style hint conditioned on as though it were the transcript leading up to
    // the audio, so on the one language that now pins a variety it should not
    // be leading with the other side of the Atlantic. Metropolitan throughout.
    sample:
      "Bonjour, je m'appelle Claire. Aujourd'hui, j'aimerais parler de mes vacances à Marseille, où il a fait très chaud.",
  },
  {
    code: 'es',
    liveCode: 'es-ES',
    label: 'Spanish',
    endonym: 'Español',
    sample:
      'Hola, me llamo Andrés. Hoy quiero hablar de mi viaje a Sevilla, donde hacía muchísimo calor.',
  },
  {
    code: 'de',
    liveCode: 'de-DE',
    label: 'German',
    endonym: 'Deutsch',
    sample:
      'Guten Tag, ich heiße Jürgen. Heute möchte ich über meine Reise nach München sprechen, wo das Wetter sehr schön war.',
  },
  {
    code: 'it',
    liveCode: 'it-IT',
    label: 'Italian',
    endonym: 'Italiano',
    sample:
      "Buongiorno, mi chiamo Niccolò. Oggi vorrei parlare del mio viaggio a Perugia, dov'era tutto bellissimo.",
  },
  {
    code: 'pt',
    liveCode: 'pt-BR',
    label: 'Portuguese',
    endonym: 'Português',
    sample:
      'Bom dia, meu nome é João. Hoje eu queria falar sobre a minha viagem a São Paulo, onde estava muito calor.',
  },
  {
    code: 'nl',
    liveCode: 'nl-NL',
    label: 'Dutch',
    endonym: 'Nederlands',
    sample:
      'Goedendag, ik heet Sanne. Vandaag wil ik graag vertellen over mijn reis naar Antwerpen, waar het de hele week regende.',
  },
  {
    code: 'sv',
    label: 'Swedish',
    endonym: 'Svenska',
    sample:
      'Hej, jag heter Erik. Idag vill jag berätta om min resa till Göteborg, där det regnade hela veckan.',
  },
  {
    code: 'no',
    label: 'Norwegian',
    endonym: 'Norsk',
    sample:
      'Hei, jeg heter Ingrid. I dag vil jeg fortelle om reisen min til Tromsø, hvor været var kaldt og dagene korte.',
  },
  {
    code: 'da',
    label: 'Danish',
    endonym: 'Dansk',
    sample:
      'Goddag, jeg hedder Mette. I dag vil jeg gerne fortælle om min rejse til Århus, hvor vejret var køligt og blæsende.',
  },
  {
    code: 'fi',
    label: 'Finnish',
    endonym: 'Suomi',
    sample:
      'Hei, nimeni on Matti. Tänään haluaisin kertoa matkastani Tampereelle, jossa oli hyvin kylmä ja luminen talvi.',
  },
  {
    code: 'pl',
    liveCode: 'pl-PL',
    label: 'Polish',
    endonym: 'Polski',
    sample:
      'Dzień dobry, nazywam się Krzysztof. Dzisiaj chciałbym opowiedzieć o mojej podróży do Wrocławia, gdzie było bardzo zimno.',
  },
  {
    code: 'cs',
    label: 'Czech',
    endonym: 'Čeština',
    sample:
      'Dobrý den, jmenuji se Jiří. Dnes bych chtěl vyprávět o své cestě do Českého Krumlova, kde bylo velmi chladno.',
  },
  {
    code: 'ru',
    liveCode: 'ru-RU',
    label: 'Russian',
    endonym: 'Русский',
    sample:
      'Здравствуйте, меня зовут Анна. Сегодня я хотела бы рассказать о моей поездке в Санкт-Петербург, где было очень холодно.',
  },
  {
    // The ї and є carry the sample away from Russian, which the shared Cyrillic
    // otherwise invites whisper-1 to drift towards.
    code: 'uk',
    label: 'Ukrainian',
    endonym: 'Українська',
    sample:
      'Доброго дня, мене звати Оксана. Сьогодні я хотіла б розповісти про свою поїздку до Львова, де було дуже холодно.',
  },
  {
    code: 'ro',
    label: 'Romanian',
    endonym: 'Română',
    sample:
      'Bună ziua, mă numesc Andrei. Astăzi aș vrea să vorbesc despre călătoria mea la Brașov, unde a fost foarte frig.',
  },
  {
    code: 'hu',
    label: 'Hungarian',
    endonym: 'Magyar',
    sample:
      'Jó napot, Kovács Péternek hívnak. Ma szeretnék mesélni a szegedi utazásomról, ahol minden gyönyörű volt.',
  },
  {
    code: 'el',
    label: 'Greek',
    endonym: 'Ελληνικά',
    sample:
      'Γεια σας, με λένε Γιώργος. Σήμερα θα ήθελα να μιλήσω για το ταξίδι μου στη Θεσσαλονίκη, όπου έκανε πολλή ζέστη.',
  },
  {
    code: 'tr',
    liveCode: 'tr-TR',
    label: 'Turkish',
    endonym: 'Türkçe',
    sample:
      "Merhaba, benim adım Ayşe. Bugün İzmir'e yaptığım yolculuktan bahsetmek istiyorum, hava çok sıcaktı.",
  },
  {
    // Modern Standard Arabic, which is what whisper-1 was trained on. A learner
    // speaking Egyptian or Levantine will transcribe worse than this sample
    // suggests — the model has far less dialect audio behind it.
    code: 'ar',
    liveCode: 'ar-XA',
    label: 'Arabic',
    endonym: 'العربية',
    sample: 'مرحباً، اسمي ليلى. اليوم أود أن أتحدث عن رحلتي إلى القاهرة، حيث كان الجو حاراً جداً.',
  },
  {
    code: 'he',
    label: 'Hebrew',
    endonym: 'עברית',
    sample: 'שלום, קוראים לי דניאל. היום אני רוצה לספר על הטיול שלי לירושלים, שם היה חם מאוד.',
  },
  {
    code: 'hi',
    liveCode: 'hi-IN',
    label: 'Hindi',
    endonym: 'हिन्दी',
    sample:
      'नमस्ते, मेरा नाम अनिल है। आज मैं जयपुर की अपनी यात्रा के बारे में बात करना चाहता हूँ, जहाँ बहुत गर्मी थी।',
  },
  {
    code: 'id',
    liveCode: 'id-ID',
    label: 'Indonesian',
    endonym: 'Bahasa Indonesia',
    sample:
      'Halo, nama saya Budi. Hari ini saya ingin bercerita tentang perjalanan saya ke Yogyakarta, di mana cuacanya sangat panas.',
  },
  {
    code: 'vi',
    liveCode: 'vi-VN',
    label: 'Vietnamese',
    endonym: 'Tiếng Việt',
    sample:
      'Xin chào, tôi tên là Minh. Hôm nay tôi muốn kể về chuyến đi của tôi đến Huế, nơi trời mưa suốt cả tuần.',
  },
  {
    code: 'th',
    liveCode: 'th-TH',
    label: 'Thai',
    endonym: 'ไทย',
    sample:
      'สวัสดีครับ ผมชื่อสมชาย วันนี้ผมอยากเล่าเรื่องการเดินทางไปเชียงใหม่ ซึ่งอากาศเย็นสบายมาก',
  },
  {
    code: 'ja',
    liveCode: 'ja-JP',
    label: 'Japanese',
    endonym: '日本語',
    sample: 'こんにちは、田中と申します。今日は京都への旅行について話したいと思います。',
  },
  {
    code: 'zh',
    label: 'Mandarin Chinese',
    endonym: '中文',
    sample: '你好，我叫李明。今天我想聊聊我去北京旅行的经历。',
  },
  {
    code: 'ko',
    liveCode: 'ko-KR',
    label: 'Korean',
    endonym: '한국어',
    sample: '안녕하세요, 저는 김민수입니다. 오늘은 제주도 여행에 대해 이야기하고 싶습니다.',
  },
  {
    code: 'en',
    liveCode: 'en-US',
    label: 'English',
    endonym: 'English',
    sample:
      "Hello, my name is Alex. Today I'd like to talk about my trip to Edinburgh, where it rained the whole week.",
  },
];

export function findLanguage(code: string): LanguageChoice | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function defaultLanguageCode(): string {
  return LANGUAGES[0].code;
}
