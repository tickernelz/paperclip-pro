import type { SpeechToTextProvider } from "./types/instance.js";

export const SPEECH_TO_TEXT_LANGUAGES: Record<SpeechToTextProvider, readonly string[]> = {
  openai_compatible: [
    "af", "ar", "hy", "az", "be", "bs", "bg", "ca", "zh", "hr", "cs", "da", "nl", "en", "et", "fi", "fr",
    "gl", "de", "el", "he", "hi", "hu", "is", "id", "it", "ja", "kn", "kk", "ko", "lv", "lt", "mk", "ms",
    "mr", "mi", "ne", "no", "fa", "pl", "pt", "ro", "ru", "sr", "sk", "sl", "es", "sw", "sv", "tl", "ta",
    "th", "tr", "uk", "ur", "vi", "cy",
  ],
  deepgram: [
    "multi", "af", "af-ZA", "ar", "ar-AE", "ar-SA", "ar-QA", "ar-KW", "ar-SY", "ar-LB", "ar-PS", "ar-JO",
    "ar-EG", "ar-SD", "ar-TD", "ar-MA", "ar-DZ", "ar-TN", "ar-IQ", "ar-IR", "hy", "as", "as-IN", "be", "bn",
    "bs", "bg", "ca", "zh-HK", "zh", "zh-CN", "zh-Hans", "zh-TW", "zh-Hant", "hr", "cs", "cs-CZ", "da",
    "da-DK", "nl", "en", "en-US", "en-AU", "en-GB", "en-IN", "en-NZ", "et", "fi", "nl-BE", "fr", "fr-CA",
    "ka", "ka-GE", "de", "de-CH", "el", "gu", "gu-IN", "he", "hi", "hu", "id", "it", "ja", "kn", "kk",
    "kk-KZ", "ko", "ko-KR", "lv", "lt", "mk", "ms", "mr", "mn", "ne", "no", "ps", "ps-AF", "fa", "pl", "pt",
    "pt-BR", "pt-PT", "pa", "pa-IN", "ro", "ru", "sr", "sk", "sl", "es", "es-419", "sv", "sv-SE", "tl", "ta",
    "te", "th", "th-TH", "tr", "tr-TR", "uk", "ur", "vi",
  ],
  elevenlabs: [
    "af", "am", "ar", "hy", "as", "ast", "az", "be", "bn", "bs", "bg", "my", "yue", "ca", "ceb", "hr", "cs",
    "da", "nl", "en", "et", "fil", "fi", "fr", "ff", "gl", "ka", "de", "el", "gu", "ha", "he", "hi", "hu",
    "is", "id", "it", "ja", "jv", "kam", "kn", "kk", "ko", "ky", "lo", "lv", "ln", "lt", "lg", "lb", "mk",
    "ms", "ml", "mt", "zh", "mi", "mr", "mn", "ne", "no", "oc", "or", "ps", "fa", "pl", "pt", "pa", "ro",
    "ru", "sr", "sn", "sd", "sk", "sl", "so", "ckb", "es", "sw", "sv", "tg", "ta", "te", "th", "tr", "uk",
    "ur", "uz", "vi", "cy", "wo", "zu",
  ],
  google: [
    "af-ZA", "am-ET", "ar-AE", "ar-BH", "ar-DZ", "ar-EG", "ar-IL", "ar-IQ", "ar-JO", "ar-KW", "ar-LB",
    "ar-MA", "ar-MR", "ar-OM", "ar-PS", "ar-QA", "ar-SA", "ar-SY", "ar-TN", "ar-XA", "ar-YE", "as-IN",
    "ast-ES", "az-AZ", "be-BY", "bg-BG", "bn-BD", "bn-IN", "bs-BA", "ca-ES", "ceb-PH", "ckb-IQ",
    "cmn-Hans-CN", "cmn-Hant-TW", "cs-CZ", "cy-GB", "da-DK", "de-DE", "el-GR", "en-AU", "en-GB", "en-IN",
    "en-PH", "en-US", "es-419", "es-ES", "es-MX", "es-US", "et-EE", "eu-ES", "fa-IR", "ff-SN", "fi-FI",
    "fil-PH", "fr-CA", "fr-FR", "ga-IE", "gl-ES", "gu-IN", "ha-NG", "hi-IN", "hr-HR", "hu-HU", "hy-AM",
    "id-ID", "ig-NG", "is-IS", "it-IT", "iw-IL", "ja-JP", "jv-ID", "ka-GE", "kam-KE", "kea-CV", "kk-KZ",
    "km-KH", "kn-IN", "ko-KR", "ky-KG", "lb-LU", "lg-UG", "ln-CD", "lo-LA", "lt-LT", "luo-KE", "lv-LV",
    "mi-NZ", "mk-MK", "ml-IN", "mn-MN", "mr-IN", "ms-MY", "mt-MT", "my-MM", "ne-NP", "nl-NL", "no-NO",
    "nso-ZA", "ny-MW", "oc-FR", "om-ET", "or-IN", "pa-Guru-IN", "pl-PL", "ps-AF", "pt-BR", "pt-PT", "ro-RO",
    "ru-RU", "rup-BG", "sd-IN", "si-LK", "sk-SK", "sl-SI", "sn-ZW", "so-SO", "sq-AL", "sr-RS", "su-ID",
    "sv-SE", "sw", "sw-KE", "ta-IN", "te-IN", "tg-TJ", "th-TH", "tr-TR", "uk-UA", "umb-AO", "ur-PK", "uz-UZ",
    "vi-VN", "wo-SN", "xh-ZA", "yo-NG", "yue-Hant-HK", "zu-ZA",
  ],
};

export const SPEECH_TO_TEXT_GOOGLE_LOCATIONS: readonly string[] = ["us", "eu", "global"];

export const SPEECH_TO_TEXT_DEFAULT_KEY_ENV_VARS: Record<SpeechToTextProvider, string> = {
  openai_compatible: "OPENAI_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  google: "GOOGLE_APPLICATION_CREDENTIALS",
};
