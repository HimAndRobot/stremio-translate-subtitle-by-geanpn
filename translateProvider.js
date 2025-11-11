const googleTranslate = require("google-translate-api-browser");
const OpenAI = require("openai");
const Bottleneck = require("bottleneck");
const FormData = require("form-data");
const { encode, decode } = require('@toon-format/toon');
require("dotenv").config();

const limiters = new Map();

const DOCUMENT_TRANSLATION_PROVIDERS = ['DeepL'];

async function translateWithDeepLText(texts, targetLang, apiKey) {
  const translatedTexts = [];

  for (const text of texts) {
    const response = await fetch('https://api.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: [text],
        target_lang: targetLang
      })
    });

    if (!response.ok) {
      throw new Error(`DeepL API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    translatedTexts.push(data.translations[0].text);
  }

  return translatedTexts;
}

function buildSRTFromTexts(texts, originalSRT) {
  const lines = originalSRT.split('\n');
  let srtOutput = '';
  let textIndex = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (/^\d+$/.test(line)) {
      srtOutput += line + '\n';
      i++;

      if (i < lines.length && /^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/.test(lines[i].trim())) {
        srtOutput += lines[i] + '\n';
        i++;

        let subtitleText = '';
        while (i < lines.length && lines[i].trim() !== '') {
          subtitleText += lines[i] + '\n';
          i++;
        }

        if (textIndex < texts.length) {
          srtOutput += texts[textIndex] + '\n';
          textIndex++;
        }

        srtOutput += '\n';
        i++;
      }
    } else {
      i++;
    }
  }

  return srtOutput.trim();
}

function supportsDocumentTranslation(provider) {
  return DOCUMENT_TRANSLATION_PROVIDERS.includes(provider);
}

async function translateSRTDocument(srtContent, targetLanguage, provider, apikey) {
  switch(provider) {
    case 'DeepL':
      return await translateWithDeepLDocument(srtContent, targetLanguage, apikey);
    default:
      throw new Error(`Document translation not supported for ${provider}`);
  }
}

async function translateWithDeepLDocument(srtContent, targetLang, apiKey) {
  const FormData = require('form-data');
  const https = require('https');

  const form = new FormData();
  form.append('file', Buffer.from(srtContent), 'subtitle.srt');
  form.append('target_lang', targetLang);

  const uploadResponse = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.deepl.com',
      path: '/v2/document',
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        ...form.getHeaders()
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`DeepL document upload error: ${res.statusCode} - ${data}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    });

    req.on('error', reject);
    form.pipe(req);
  });

  const { document_id, document_key } = uploadResponse;

  let status = 'queued';
  let attempts = 0;
  const maxAttempts = 60;

  while (status !== 'done' && status !== 'error' && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;

    const statusResponse = await fetch(
      `https://api.deepl.com/v2/document/${document_id}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ document_key })
      }
    );

    if (!statusResponse.ok) {
      throw new Error(`DeepL status check error: ${statusResponse.status}`);
    }

    const statusData = await statusResponse.json();
    status = statusData.status;
  }

  if (status === 'error') {
    throw new Error('DeepL document translation failed');
  }

  if (status !== 'done') {
    throw new Error('DeepL document translation timeout');
  }

  const downloadResponse = await fetch(
    `https://api.deepl.com/v2/document/${document_id}/result`,
    {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ document_key })
    }
  );

  if (!downloadResponse.ok) {
    throw new Error(`DeepL download error: ${downloadResponse.status}`);
  }

  return await downloadResponse.text();
}

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
    } else if (provider === 'DeepL') {
      config = {
        maxConcurrent: 10,
        minTime: 100
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
      case "DeepL": {
        resultArray = await translateWithDeepLText(texts, targetLanguage, apikey);
        tokenUsage = texts.join('').length;
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
        let toonInput;
        let useTOON = true;

        if (partialResults && partialResults.length > 0) {
          // Recovery prompt: use partial results to complete the translation
          const recoveryData = {
            originalTexts: texts.map((text, index) => ({ index, text })),
            partialTranslations: partialResults.map((text, index) => ({ index, text }))
          };

          toonInput = encode(recoveryData);
          const inputSize = JSON.stringify(recoveryData).length;
          const toonSize = toonInput.length;
          console.log(`[TOON Recovery] Size reduction: ${inputSize} → ${toonSize} chars (${Math.round((1 - toonSize/inputSize) * 100)}% saved)`);

          prompt = `Translate subtitle texts to "${targetLanguage}". Return ONLY TOON format, NO explanations.

CRITICAL: You returned only ${partialResults.length} of ${texts.length} translations. Return ALL ${texts.length}.

Rules:
- Keep correct translations from partial results
- Complete missing translations
- Output EXACTLY ${texts.length} items in "texts" array
- Preserve line breaks
- Return ONLY TOON format (no markdown, no explanations)

Input:
${toonInput}
`;
        } else {
          // Normal prompt with TOON
          const inputData = {
            texts: texts.map((text, index) => ({ index, text })),
          };

          toonInput = encode(inputData);
          const inputSize = JSON.stringify(inputData).length;
          const toonSize = toonInput.length;
          console.log(`[TOON] Size reduction: ${inputSize} → ${toonSize} chars (${Math.round((1 - toonSize/inputSize) * 100)}% saved)`);

          prompt = `Translate subtitles to "${targetLanguage}". Return ONLY TOON format, NO markdown, NO explanations.

Rules:
- Translate each text in "texts" array
- Output EXACTLY ${texts.length} items
- Preserve line breaks
- Keep same structure
- Return ONLY raw TOON format

Input:
${toonInput}
`;
        }

        const completion = await openai.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: model_name,
          temperature: 0.3,
        });

        let responseContent = completion.choices[0].message.content;
        let translatedJson;

        // Clean markdown code blocks and extract TOON/JSON content
        responseContent = responseContent.trim();

        // Remove markdown code blocks (```toon ... ```)
        const codeBlockMatch = responseContent.match(/```(?:toon|TOON|json|JSON)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          responseContent = codeBlockMatch[1].trim();
        }

        // Remove any leading explanatory text before TOON data
        // TOON format starts with a key followed by array declaration
        const toonStartMatch = responseContent.match(/(?:^|\n)(\w+\[\d+\]\{[\s\S]+)/);
        if (toonStartMatch) {
          responseContent = toonStartMatch[1].trim();
        }

        // Parse TOON response (no fallback)
        try {
          translatedJson = decode(responseContent);
          console.log('[TOON] ✓ Successfully parsed TOON response');
        } catch (toonError) {
          console.error('[TOON] ✗ Failed to parse TOON response');
          console.error('[TOON] Error:', toonError.message);
          console.error('[TOON] Response preview:', responseContent.substring(0, 300));
          throw new Error(`Failed to parse TOON response: ${toonError.message}`);
        }

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

module.exports = {
  translateText,
  translateSRTDocument,
  supportsDocumentTranslation
};
