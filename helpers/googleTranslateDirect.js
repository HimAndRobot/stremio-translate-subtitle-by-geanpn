function buildRequestBody(text, from, to) {
  const escapedText = text.trim().replace(/["]/g, "\\\\\\$&").replace(/\r\n|\r|\n/g, "\\\\n");
  const encoded = encodeURIComponent(`[[["MkEWBc","[[\\"${escapedText}\\",\\"${from}\\",\\"${to}\\",1],[]]",null,"generic"]]]`);
  return `f.req=${encoded}&`;
}

function parseResponse(data) {
  if (!data || data.length === 0) {
    return { success: false, error: "Empty response", raw: "" };
  }

  const cleaned = data.replace(/^\)]}'\n?/, "");

  if (cleaned.includes("<!DOCTYPE") || cleaned.includes("<html")) {
    return { success: false, error: "HTML response (rate limit/captcha)", raw: cleaned.substring(0, 500) };
  }

  try {
    const parsed = JSON.parse(cleaned);
    const innerData = JSON.parse(parsed[0][2]);

    if (!innerData || !innerData[1] || !innerData[1][0] || !innerData[1][0][0] || !innerData[1][0][0][5]) {
      return { success: false, error: "Unexpected structure", raw: cleaned.substring(0, 500) };
    }

    const translatedText = innerData[1][0][0][5].reduce((acc, item) => {
      const text = item[0];
      return acc ? `${acc} ${text}` : text;
    }, "");

    return { success: true, text: translatedText };
  } catch (parseError) {
    return { success: false, error: `Parse error: ${parseError.message}`, raw: cleaned.substring(0, 500) };
  }
}

async function translateText(text, targetLanguage) {
  const url = new URL("https://translate.google.com/_/TranslateWebserverUi/data/batchexecute");
  url.searchParams.set("rpcids", "MkEWBc");
  url.searchParams.set("source-path", "/");
  url.searchParams.set("hl", "en");
  url.searchParams.set("soc-app", "1");
  url.searchParams.set("soc-platform", "1");
  url.searchParams.set("soc-device", "1");

  const body = buildRequestBody(text, "auto", targetLanguage);

  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    body: body
  };

  try {
    const response = await fetch(url, options);
    const data = await response.text();

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}`, raw: data.substring(0, 300) };
    }

    return parseResponse(data);
  } catch (error) {
    return { success: false, error: `Request error: ${error.message}` };
  }
}

async function translateBatch(texts, targetLanguage) {
  const DELIMITER = " ||| ";

  const cleanedTexts = texts.map(text => {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/\{\\[a-zA-Z0-9]+\}/g, '');
    cleaned = cleaned.replace(/\n/g, " ");
    return cleaned;
  });

  const textToTranslate = cleanedTexts.join(DELIMITER);
  const result = await translateText(textToTranslate, targetLanguage);

  if (!result.success) {
    throw new Error(`Translation failed: ${result.error}`);
  }

  const translatedTexts = result.text.split("|||").map(s => s.trim());

  if (texts.length !== translatedTexts.length && translatedTexts.length > 0) {
    const diff = texts.length - translatedTexts.length;
    if (diff > 0) {
      const splitted = translatedTexts[0].split(" ");
      if (splitted.length === diff + 1) {
        return [...splitted, ...translatedTexts.slice(1)];
      }
    }
  }

  return translatedTexts;
}

module.exports = {
  translateText,
  translateBatch
};
