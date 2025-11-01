const googleLanguages = require("./langs/translateGoogleFree.lang.json");
const chatgptLanguages = require("./langs/translateChatGpt.lang.json");
const deeplLanguages = require("./langs/translateDeepL.lang.json");

function getValueFromKey(key) {
  return data[key];
}

function getKeyFromValue(value, provider) {
  let langMap;
  switch (provider) {
    case "Google Translate":
      langMap = googleLanguages;
      break;
    case "DeepL":
      langMap = deeplLanguages;
      break;
    case "ChatGPT API":
    case "OpenAI":
    case "Google Gemini":
    case "OpenRouter":
    case "Groq":
    case "Together AI":
    case "Custom":
      langMap = chatgptLanguages;
      break;
    default:
      throw new Error(`Provider not found: ${provider}`);
  }

  for (let key in langMap) {
    if (langMap[key] === value) {
      return key;
    }
  }
  return null;
}

function getAllValues() {
  return Object.values(data);
}

module.exports = {
  getAllValues,
  getKeyFromValue,
  getValueFromKey,
};
