const PROVIDERS = [
  'Google Translate',
  'DeepL',
  'OpenAI',
  'Google Gemini',
  'OpenRouter',
  'Groq',
  'Together AI',
  'Custom'
];

const PROVIDER_CONFIGS = {
  'Google Translate': {
    requiresApiKey: false,
    requiresBaseUrl: false,
    requiresModel: false
  },
  'DeepL': {
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: false,
    defaultBaseUrl: 'https://api.deepl.com/v2',
    models: []
  },
  'OpenAI': {
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4-mini',
    models: [
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5',
      'gpt-5-mini',
      'gpt-5-nano',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'gpt-4o',
      'gpt-4o-mini'
    ]
  },
  'Google Gemini': {
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-3.6-flash',
    models: [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite'
    ]
  },
  'OpenRouter': {
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-oss-120b',
    models: [
      'openai/gpt-oss-120b',
      'openai/gpt-5.4-nano'
    ]
  },
  'Groq': {
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      'llama-3.3-70b-versatile',
      'openai/gpt-oss-120b'
    ]
  },
  'Together AI': {
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    defaultBaseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    models: ['meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1', 'Qwen/Qwen2.5-72B-Instruct-Turbo']
  },
  'Custom': {
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    defaultBaseUrl: '',
    defaultModel: '',
    models: []
  }
};

/**
 * Token usage for one hour of video, used to turn per-token list prices into a
 * figure a user can actually reason about.
 *
 * Derived for a ~1 hour episode: ~800 cues / ~10k words of source dialogue,
 * plus the per-cue JSON envelope the prompt uses, plus the instruction block
 * re-sent once per 60-cue batch, plus ~10-20% token inflation for German-style
 * compounding on the output side.
 *
 * These are deliberately a little conservative (they round up), so the number
 * shown to the user is a ceiling rather than a surprise. The addon already
 * records real usage in translation_queue.token_usage_total - if that data
 * says otherwise for your library, adjust here and every figure moves with it.
 */
const TOKENS_PER_VIDEO_HOUR = { input: 30000, output: 25000 };

/**
 * List prices in USD per 1M tokens, and a one-line note on when to pick each.
 *
 * PRICES_CHECKED_ON is the date these were last read from the providers' own
 * pricing pages. Please bump it when you touch them. Providers bill in USD, so
 * these are shown as USD without conversion.
 *
 * A model with no entry here still works fine - the UI just shows no cost
 * estimate for it rather than guessing.
 */
const PRICES_CHECKED_ON = '2026-09-09';

const MODEL_INFO = {
  // --- OpenAI -------------------------------------------------------------
  'gpt-6-astra':      { tier: 'best',     inputPer1M: 10.00, outputPer1M: 50.00, hint: 'Overkill for subtitles. Only if cost is irrelevant.' },
  'gpt-5.6-sol':      { tier: 'best',     inputPer1M: 4.00,  outputPer1M: 20.00, hint: 'Top-tier quality, well above what subtitles need.' },
  'gpt-5.6-terra':    { tier: 'best',     inputPer1M: 2.00,  outputPer1M: 12.00, hint: 'Excellent quality for tricky dialogue and wordplay.' },
  'gpt-5.6-luna':     { tier: 'budget',   inputPer1M: 0.20,  outputPer1M: 1.20,  hint: 'Newest cheap model. Best value at the low end.' },
  'gpt-5.4':          { tier: 'best',     inputPer1M: 2.50,  outputPer1M: 15.00, hint: 'Strong all-round quality if budget is not a concern.' },
  'gpt-5.4-mini':     { tier: 'balanced', inputPer1M: 0.75,  outputPer1M: 4.50,  hint: 'Recommended default. Good German for a few cents an hour.' },
  'gpt-5.4-nano':     { tier: 'budget',   inputPer1M: 0.20,  outputPer1M: 1.25,  hint: 'Cheap and fast. Prefer 5.6-luna at the same price.' },
  'gpt-5-mini':       { tier: 'budget',   inputPer1M: 0.25,  outputPer1M: 2.00,  hint: 'Previous generation. Fine, but 5.4-mini is better.' },
  'gpt-5-nano':       { tier: 'budget',   inputPer1M: 0.05,  outputPer1M: 0.40,  hint: 'Cheapest option. Expect literal, clumsy phrasing.' },

  // --- Google Gemini ------------------------------------------------------
  // The 3.6/3.7/3.8 Flash price below is promotional through 2026-12-31 and
  // is expected to roughly double from 2027-01-01.
  'gemini-3.8-flash':      { tier: 'balanced', inputPer1M: 0.75, outputPer1M: 3.75, hint: 'Newest Flash. Strong quality, promotional pricing.' },
  'gemini-3.7-flash':      { tier: 'balanced', inputPer1M: 0.75, outputPer1M: 3.75, hint: 'Strong quality, promotional pricing.' },
  'gemini-3.6-flash':      { tier: 'balanced', inputPer1M: 0.75, outputPer1M: 3.75, hint: 'Good default for Gemini. Generous free tier.' },
  'gemini-3.5-flash':      { tier: 'best',     inputPer1M: 1.50, outputPer1M: 9.00, hint: 'Higher quality, noticeably pricier than 3.6.' },
  'gemini-3.5-flash-lite': { tier: 'budget',   inputPer1M: 0.30, outputPer1M: 2.50, hint: 'Cheap with acceptable quality.' },
  'gemini-3.1-flash-lite': { tier: 'budget',   inputPer1M: 0.25, outputPer1M: 1.50, hint: 'Cheaper still. Fine for simple dialogue.' },
  'gemini-2.5-flash-lite': { tier: 'budget',   inputPer1M: 0.10, outputPer1M: 0.40, hint: 'Cheapest with a real free tier. Basic quality.' },

  // --- OpenRouter / Groq (open-weight) ------------------------------------
  // Same model, different hosts: OpenRouter is currently ~4x cheaper.
  'openai/gpt-oss-120b': { tier: 'budget', inputPer1M: 0.037, outputPer1M: 0.17, hint: 'Open-weight, very cheap. Cheaper on OpenRouter than Groq.' },
  'openai/gpt-5.4-nano': { tier: 'budget', inputPer1M: 0.20,  outputPer1M: 1.25, hint: 'OpenAI 5.4-nano via OpenRouter.' }
};

const TIER_LABELS = {
  budget: 'Budget',
  balanced: 'Balanced',
  best: 'Best quality'
};

/** Estimated USD to translate one hour of video with this model. */
function estimateUsdPerVideoHour(modelId) {
  const info = MODEL_INFO[modelId];
  if (!info) return null;
  return (
    (info.inputPer1M * TOKENS_PER_VIDEO_HOUR.input +
      info.outputPer1M * TOKENS_PER_VIDEO_HOUR.output) / 1e6
  );
}

/**
 * Format USD so the cheap end stays distinguishable - at two decimals
 * everything below a dime collapses to "$0.01" and the comparison is lost.
 */
function formatUsd(usd) {
  if (usd == null) return null;
  return usd < 0.1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}

/**
 * Short cost label for a model, e.g.
 *   "Balanced - about $0.14 per hour of video (~$1.35 / 10 episodes)"
 * Returns null when we have no verified price for the model.
 */
function describeModelCost(modelId) {
  const info = MODEL_INFO[modelId];
  const perHour = estimateUsdPerVideoHour(modelId);
  if (!info || perHour == null) return null;

  const tier = TIER_LABELS[info.tier] || info.tier;
  return `${tier} - about ${formatUsd(perHour)} per hour of video ` +
    `(~${formatUsd(perHour * 10)} / 10 episodes)`;
}
