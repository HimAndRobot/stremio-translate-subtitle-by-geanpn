const https = require("https");

// Build the request body for Google Translate API
function buildRequestBody(text, from, to) {
  const escapedText = text.trim().replace(/["]/g, "\\\\\\$&").replace(/\r\n|\r|\n/g, "\\\\n");
  const encoded = encodeURIComponent(`[[["MkEWBc","[[\\"${escapedText}\\",\\"${from}\\",\\"${to}\\",1],[]]",null,"generic"]]]`);
  return `f.req=${encoded}&`;
}

// Parse the Google Translate response
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

// Make the translation request
function translateText(text, targetLanguage) {
  return new Promise((resolve) => {
    const startTime = Date.now();
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
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    };

    const req = https.request(url, options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        const elapsed = Date.now() - startTime;
        if (res.statusCode !== 200) {
          resolve({ success: false, error: `HTTP ${res.statusCode}`, raw: data.substring(0, 300), time: elapsed });
          return;
        }
        const result = parseResponse(data);
        result.time = elapsed;
        result.responseSize = data.length;
        resolve(result);
      });
    });

    req.on("error", (error) => {
      const elapsed = Date.now() - startTime;
      resolve({ success: false, error: `Request error: ${error.message}`, time: elapsed });
    });

    req.setTimeout(30000, () => {
      req.destroy();
      const elapsed = Date.now() - startTime;
      resolve({ success: false, error: "Timeout 30s", time: elapsed });
    });

    req.write(body);
    req.end();
  });
}

// Test cases
async function runTests() {
  console.log("=== POC Google Translate ===\n");

  const tests = [
    { name: "Texto pequeno", texts: ["Hello world"], lang: "pt" },
    { name: "5 textos", texts: ["Hello", "World", "How are you", "Good morning", "Goodbye"], lang: "pt" },
    { name: "20 textos", texts: Array(20).fill("This is a test sentence for translation"), lang: "pt" },
    { name: "50 textos", texts: Array(50).fill("This is a test sentence for translation"), lang: "pt" },
    { name: "Texto grande (1 longo)", texts: ["This is a very long text that will be repeated many times. ".repeat(50)], lang: "pt" },
  ];

  for (const test of tests) {
    const textToTranslate = test.texts.join(" ||| ");
    const size = Buffer.byteLength(textToTranslate, "utf8");

    console.log(`\n[TEST] ${test.name}`);
    console.log(`  Input: ${test.texts.length} texts | ${size} bytes`);

    const result = await translateText(textToTranslate, test.lang);

    if (result.success) {
      const resultArray = result.text.split("|||").map(s => s.trim());
      console.log(`  ✅ OK | ${result.time}ms | ${result.responseSize} bytes | ${resultArray.length} results`);
      if (test.texts.length <= 5) {
        console.log(`  Output: "${result.text.substring(0, 100)}..."`);
      }
    } else {
      console.log(`  ❌ FAIL | ${result.time}ms | ${result.error}`);
      if (result.raw) {
        console.log(`  Raw: ${result.raw.substring(0, 200)}`);
      }
    }

    // Delay between tests to avoid rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log("\n\n=== Test concurrent requests ===\n");

  const concurrentTests = [5, 10, 15, 20, 30];

  for (const count of concurrentTests) {
    console.log(`[TEST] ${count} requests simultâneas`);
    const concurrentStart = Date.now();
    const concurrentPromises = Array(count).fill(null).map((_, i) =>
      translateText(`Test message number ${i + 1} for concurrent testing`, "pt")
    );
    const concurrentResults = await Promise.all(concurrentPromises);
    const concurrentElapsed = Date.now() - concurrentStart;

    const successes = concurrentResults.filter(r => r.success).length;
    const failures = concurrentResults.filter(r => !r.success);

    console.log(`  Total time: ${concurrentElapsed}ms`);
    console.log(`  ✅ Successes: ${successes}/${count}`);
    if (failures.length > 0) {
      console.log(`  ❌ Failures: ${failures.length}`);
      failures.slice(0, 3).forEach((f, i) => console.log(`    ${i + 1}: ${f.error}`));
      if (failures.length > 3) console.log(`    ... e mais ${failures.length - 3}`);
    }

    // Wait between tests
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("\n=== POC Complete ===");
}

runTests().catch(console.error);
