const googleTranslate = require("google-translate-api-browser");
const OpenAI = require("openai");
const Bottleneck = require("bottleneck");
require("dotenv").config();

const limiters = new Map();

function getLimiter(provider, apikey) {
  const key = `${provider}:${apikey || 'no-key'}`;

  if (!limiters.has(key)) {
    let config;

    if (provider === 'Google Gemini') {
      config = {
        reservoir: 280,
        reservoirRefreshAmount: 280,
        reservoirRefreshInterval: 60 * 1000,
        maxConcurrent: 40,
        minTime: 250
      };
    } else if (provider === 'OpenAI' || provider === 'ChatGPT API') {
      config = {
        maxConcurrent: 20,
        minTime: 50
      };
    } else {
      config = {
        maxConcurrent: 15,
        minTime: 75
      };
    }

    limiters.set(key, new Bottleneck(config));
  }

  return limiters.get(key);
}

var count = 0;
async function translateTextWithRetry(
  texts,
  targetLanguage,
  provider,
  apikey,
  base_url,
  model_name,
  attempt = 1,
  maxRetries = 3,
  partialResults = null
) {
  try {
    let result = null;
    let resultArray = [];
    let tokenUsage = 0;

    switch (provider) {
      case "Google Translate": {
        const textToTranslate = texts.join(" ||| ");
        result = await googleTranslate.translate(textToTranslate, {
          to: targetLanguage,
          corsUrl: process.env.CORS_URL || "http://cors-anywhere.herokuapp.com/",
        });
        resultArray = result.text.split("|||");
        if (texts.length !== resultArray.length && resultArray.length > 0) {
          const diff = texts.length - resultArray.length;
          if (diff > 0) {
            // Attempt to correct by splitting the first element if translation was merged
            const splitted = resultArray[0].split(" ");
            if (splitted.length === diff + 1) {
              resultArray = [...splitted, ...resultArray.slice(1)];
            }
          }
        }
        break;
      }
      case "OpenAI":
      case "Google Gemini":
      case "OpenRouter":
      case "Groq":
      case "Together AI":
      case "Custom":
      case "ChatGPT API": {
        const openai = new OpenAI({
          apiKey: apikey,
          baseURL: base_url,
        });

        let prompt;
        let jsonInput;

        if (partialResults && partialResults.length > 0) {
          // Recovery prompt: use partial results to complete the translation
          jsonInput = {
            originalTexts: texts.map((text, index) => ({ index, text })),
            partialTranslations: partialResults.map((text, index) => ({ index, text }))
          };

          prompt = `You are a professional movie subtitle translator.\n\nI asked you to translate ${texts.length} subtitle texts to "${targetLanguage}", but you returned only ${partialResults.length} translations.\n\nPlease return a COMPLETE array with exactly ${texts.length} translations:\n- Keep the translations that are correct from the partial results\n- Complete the missing translations\n- Fix any incorrect translations\n\n**Strict Requirements:**\n- Output must be a JSON object with a "texts" array\n- The "texts" array must contain EXACTLY ${texts.length} elements\n- Each element must have "index" (0 to ${texts.length - 1}) and "text" (translated)\n- Preserve line breaks and formatting\n- Do not combine or split texts\n\nOriginal texts:\n${JSON.stringify(jsonInput.originalTexts)}\n\nPartial translations received:\n${JSON.stringify(jsonInput.partialTranslations)}\n`;
        } else {
          // Normal prompt
          jsonInput = {
            texts: texts.map((text, index) => ({ index, text })),
          };

          prompt = `You are a professional movie subtitle translator.\nTranslate each subtitle text in the "texts" array of the following JSON object into the specified language "${targetLanguage}".\n\nThe output must be a JSON object with the same structure as the input. The "texts" array should contain the translated texts corresponding to their original indices.\n\n**Strict Requirements:**\n- Strictly preserve line breaks and original formatting for each subtitle.\n- Do not combine or split texts during translation.\n- The number of elements in the output array must exactly match the input array.\n- Ensure the final JSON is valid and retains the complete structure.\n\nInput:\n${JSON.stringify(
            jsonInput
          )}\n`;
        }

        const completion = await openai.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: model_name,
          response_format: { type: "json_object" },
          temperature: 0.3,
        });

        const translatedJson = JSON.parse(
          completion.choices[0].message.content
        );

        resultArray = translatedJson.texts
          .sort((a, b) => a.index - b.index)
          .map((item) => item.text);

        if (completion.usage && completion.usage.total_tokens) {
          tokenUsage = completion.usage.total_tokens;
        }

        break;
      }
      default:
        throw new Error(`Provider not supported: ${provider}`);
    }

    if (!resultArray || resultArray.length === 0) {
      throw new Error(`Translation failed: No results returned from provider ${provider}`);
    }

    if (texts.length != resultArray.length) {
      if (attempt >= maxRetries) {
        throw new Error(
          `Max retries (${maxRetries}) reached. Text count mismatch: Pedidos ${texts.length}, veio ${resultArray.length}`
        );
      }

      // Second attempt: try recovery prompt with partial results
      if (attempt === 2) {
        return translateTextWithRetry(
          texts,
          targetLanguage,
          provider,
          apikey,
          base_url,
          model_name,
          attempt + 1,
          maxRetries,
          resultArray // Pass partial results for recovery
        );
      }

      // First attempt: regular retry
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      return translateTextWithRetry(
        texts,
        targetLanguage,
        provider,
        apikey,
        base_url,
        model_name,
        attempt + 1,
        maxRetries
      );
    }

    count++;
    return {
      translatedText: Array.isArray(texts) ? resultArray : result.text,
      tokenUsage: tokenUsage
    };
  } catch (error) {
    if (attempt >= maxRetries) {
      throw error;
    }

    console.error(`Attempt ${attempt}/${maxRetries} failed with error:`, error);
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    return translateTextWithRetry(
      texts,
      targetLanguage,
      provider,
      apikey,
      base_url,
      model_name,
      attempt + 1,
      maxRetries
    );
  }
}

// Wrapper function to maintain original interface
async function translateText(
  texts,
  targetLanguage,
  provider,
  apikey,
  base_url,
  model_name
) {
  const limiter = getLimiter(provider, apikey);

  return limiter.schedule(() =>
    translateTextWithRetry(
      texts,
      targetLanguage,
      provider,
      apikey,
      base_url,
      model_name
    )
  );
}

module.exports = { translateText };
