const googleTranslate = require("google-translate-api-browser");
require("dotenv").config();

const CORS_URL = process.env.CORS_URL || "";

async function translateText(text, targetLanguage) {
  const startTime = Date.now();
  try {
    const result = await googleTranslate.translate(text, {
      to: targetLanguage,
      corsUrl: CORS_URL,
    });
    const elapsed = Date.now() - startTime;
    return { success: true, text: result.text, time: elapsed };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    return { success: false, error: error.message, time: elapsed };
  }
}

async function runTests() {
  console.log("=== POC Google Translate (usando lib) ===\n");
  console.log(`CORS_URL: ${CORS_URL || "(não configurado)"}\n`);

  const tests = [
    { name: "Texto pequeno", texts: ["Hello world"], lang: "pt" },
    { name: "5 textos", texts: ["Hello", "World", "How are you", "Good morning", "Goodbye"], lang: "pt" },
    { name: "20 textos", texts: Array(20).fill("This is a test sentence for translation"), lang: "pt" },
    { name: "50 textos", texts: Array(50).fill("This is a test sentence for translation"), lang: "pt" },
  ];

  for (const test of tests) {
    const textToTranslate = test.texts.join(" ||| ");
    const size = Buffer.byteLength(textToTranslate, "utf8");

    console.log(`\n[TEST] ${test.name}`);
    console.log(`  Input: ${test.texts.length} texts | ${size} bytes`);

    const result = await translateText(textToTranslate, test.lang);

    if (result.success) {
      const resultArray = result.text.split("|||").map(s => s.trim());
      console.log(`  ✅ OK | ${result.time}ms | ${resultArray.length} results`);
    } else {
      console.log(`  ❌ FAIL | ${result.time}ms | ${result.error}`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log("\n\n=== Test concurrent requests ===\n");

  const concurrentTests = [5, 10, 15, 20];

  for (const count of concurrentTests) {
    console.log(`[TEST] ${count} requests simultâneas`);
    const concurrentStart = Date.now();
    const concurrentPromises = Array(count).fill(null).map((_, i) =>
      translateText(`Test message number ${i + 1}`, "pt")
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
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("\n=== POC Complete ===");
}

runTests().catch(console.error);
