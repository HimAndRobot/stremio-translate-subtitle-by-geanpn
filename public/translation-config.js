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
    defaultModel: 'gpt-4o-mini',
    models: [
      'gpt-5',
      'gpt-5-mini',
      'gpt-5-nano',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-3.5-turbo'
    ]
  },
  'Google Gemini': {
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite']
  },
  'OpenRouter': {
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.0-flash-exp:free',
    models: ['google/gemini-2.0-flash-exp:free', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.1-405b-instruct']
  },
  'Groq': {
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768']
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
