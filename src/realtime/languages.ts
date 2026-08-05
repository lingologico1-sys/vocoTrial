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
  /** ISO-639-1. What OpenAI's input transcription takes as `language`. */
  code: string;
  /** English name, for the picker and for the agent's instructions. */
  label: string;
  /** The language's own name for itself, which is what the picker shows. */
  endonym: string;
  /**
   * A sample of well-formed text in the language, handed to whisper-1 as
   * `prompt`.
   *
   * Whisper conditions on that field as though it were the transcript leading
   * up to the audio, so it is a style hint rather than a vocabulary list: a
   * sentence carrying the language's accents, punctuation and conventions pulls
   * the output towards them. Without it Whisper drifts to flat unaccented ASCII
   * on exactly the short, hesitant utterances a learner produces most.
   */
  sample: string;
}

/**
 * WHY THIS LIST AND NOT THE PROVIDERS' FULL ONES
 *
 * Neither provider exposes a languages endpoint, so unlike the model ids in
 * models.ts there is nothing to ask. Both lists are documentation only, and
 * they are not even the same kind of list:
 *
 *  - OpenAI's whisper-1 takes an explicit `language` code. 98 exist in the
 *    tokenizer; OpenAI documents ~57 as performing well.
 *  - Gemini's native-audio models take no language code at all — see the setup
 *    handling in functions/api/live/gemini.ts. Language is carried entirely by
 *    the system instruction, so there is no field to enumerate against.
 *
 * These entries are the tier that is strong on both and that people actually
 * study. The tail of Whisper's 98 is not worth offering to a learner: word
 * error rates there run past 50%, and a confident wrong transcript teaches
 * someone they said a thing they did not say. That failure is worse than the
 * language being absent, and no amount of `sample` conditioning rescues a
 * language the model is simply weak at.
 *
 * To add one: check it is in Whisper's well-performing set, give it an
 * ISO-639-1 code whisper-1 accepts, and write a real sample — see the field
 * docs above for what makes one work.
 */

// First entry is the default.
export const LANGUAGES: LanguageChoice[] = [
  {
    code: 'fr',
    label: 'French',
    endonym: 'Français',
    sample:
      "Bonjour, je m'appelle Claire. Aujourd'hui, j'aimerais parler de mes vacances à Montréal, où il a fait très froid.",
  },
  {
    code: 'es',
    label: 'Spanish',
    endonym: 'Español',
    sample:
      'Hola, me llamo Andrés. Hoy quiero hablar de mi viaje a Sevilla, donde hacía muchísimo calor.',
  },
  {
    code: 'de',
    label: 'German',
    endonym: 'Deutsch',
    sample:
      'Guten Tag, ich heiße Jürgen. Heute möchte ich über meine Reise nach München sprechen, wo das Wetter sehr schön war.',
  },
  {
    code: 'it',
    label: 'Italian',
    endonym: 'Italiano',
    sample:
      "Buongiorno, mi chiamo Niccolò. Oggi vorrei parlare del mio viaggio a Perugia, dov'era tutto bellissimo.",
  },
  {
    code: 'pt',
    label: 'Portuguese',
    endonym: 'Português',
    sample:
      'Bom dia, meu nome é João. Hoje eu queria falar sobre a minha viagem a São Paulo, onde estava muito calor.',
  },
  {
    code: 'nl',
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
    label: 'Hindi',
    endonym: 'हिन्दी',
    sample:
      'नमस्ते, मेरा नाम अनिल है। आज मैं जयपुर की अपनी यात्रा के बारे में बात करना चाहता हूँ, जहाँ बहुत गर्मी थी।',
  },
  {
    code: 'id',
    label: 'Indonesian',
    endonym: 'Bahasa Indonesia',
    sample:
      'Halo, nama saya Budi. Hari ini saya ingin bercerita tentang perjalanan saya ke Yogyakarta, di mana cuacanya sangat panas.',
  },
  {
    code: 'vi',
    label: 'Vietnamese',
    endonym: 'Tiếng Việt',
    sample:
      'Xin chào, tôi tên là Minh. Hôm nay tôi muốn kể về chuyến đi của tôi đến Huế, nơi trời mưa suốt cả tuần.',
  },
  {
    code: 'th',
    label: 'Thai',
    endonym: 'ไทย',
    sample:
      'สวัสดีครับ ผมชื่อสมชาย วันนี้ผมอยากเล่าเรื่องการเดินทางไปเชียงใหม่ ซึ่งอากาศเย็นสบายมาก',
  },
  {
    code: 'ja',
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
    label: 'Korean',
    endonym: '한국어',
    sample: '안녕하세요, 저는 김민수입니다. 오늘은 제주도 여행에 대해 이야기하고 싶습니다.',
  },
  {
    code: 'en',
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
