const googleTranslate = require("google-translate-api-browser");
const fs = require("fs").promises;
const OpenAI = require("openai");
require("dotenv").config();

var count = 0;
async function translateTextWithRetry(
  texts,
  targetLanguage,
  provider,
  apikey,
  base_url,
  model_name,
  attempt = 1,
  maxRetries = 3
) {
  try {
    let result = null;
    let resultArray = [];

    switch (provider) {
      case "Google Translate": {
        const textToTranslate = texts.join(" ||| ");
        result = await googleTranslate.translate(textToTranslate, {
          to: targetLanguage,
          corsUrl: process.env.CORS_URL || "http://cors-anywhere.herokuapp.com/",
        });
        resultArray = result.text.split("|||");
        if (texts.length !== resultArray.length && resultArray.length > 0) {
          console.log(texts);
          console.log(resultArray);
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
        const jsonInput = {
          texts: texts.map((text, index) => ({ index, text })),
        };

        const prompt = `You are a professional movie subtitle translator.\nTranslate each subtitle text in the "texts" array of the following JSON object into the specified language "${targetLanguage}".\n\nThe output must be a JSON object with the same structure as the input. The "texts" array should contain the translated texts corresponding to their original indices.\n\n**Strict Requirements:**\n- Strictly preserve line breaks and original formatting for each subtitle.\n- Do not combine or split texts during translation.\n- The number of elements in the output array must exactly match the input array.\n- Ensure the final JSON is valid and retains the complete structure.\n\nInput:\n${JSON.stringify(
          jsonInput
        )}\n`;

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

        break;
      }
      default:
        throw new Error(`Provider not supported: ${provider}`);
    }

    if (texts.length != resultArray.length) {
      console.log(
        `Attempt ${attempt}/${maxRetries} failed. Text count mismatch:`,
        texts.length,
        resultArray.length
      );
      await fs.writeFile(
        `debug/errorTranslate${count}.json`,
        JSON.stringify(
          {
            attempt,
            texts,
            translatedText: resultArray,
          },
          null,
          2
        )
      );

      if (attempt >= maxRetries) {
        throw new Error(
          `Max retries (${maxRetries}) reached. Text count mismatch.`
        );
      }

      // Wait and retry
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
    return Array.isArray(texts) ? resultArray : result.text;
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
  return translateTextWithRetry(
    texts,
    targetLanguage,
    provider,
    apikey,
    base_url,
    model_name
  );
}

module.exports = { translateText };
