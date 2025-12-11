const googleTranslate = require("google-translate-api-browser");

// Capture uncaught exceptions from the library (isolated in this child process)
process.on('uncaughtException', (error) => {
  console.error(`[WORKER] Uncaught Exception: ${error.message}`);
  try {
    process.send({ success: false, error: `Uncaught: ${error.message}` });
  } catch (e) {
    // Ignore if we can't send
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[WORKER] Unhandled Rejection: ${reason}`);
  try {
    process.send({ success: false, error: `Unhandled: ${reason}` });
  } catch (e) {
    // Ignore if we can't send
  }
  process.exit(1);
});

process.on('message', async (message) => {
  const { texts, targetLanguage, corsUrl } = message;
  const startTime = Date.now();

  try {
    const textToTranslate = texts.join(" ||| ");
    const textSize = Buffer.byteLength(textToTranslate, "utf8");

    // Log first 200 chars to help debug corrupted responses
    const preview = textToTranslate.substring(0, 200).replace(/\n/g, '\\n');
    console.log(`[WORKER] texts=${texts.length} | size=${textSize} bytes | lang=${targetLanguage} | preview="${preview}"`);

    const result = await googleTranslate.translate(textToTranslate, {
      to: targetLanguage,
      corsUrl: corsUrl,
    });

    const elapsed = Date.now() - startTime;

    if (!result || !result.text) {
      console.error(`[WORKER] FAIL empty response | time=${elapsed}ms`);
      process.send({ success: false, error: "Google Translate returned empty response" });
      process.exit(1);
      return;
    }

    const resultArray = result.text.split("|||").map(s => s.trim());
    console.log(`[WORKER] OK results=${resultArray.length} | time=${elapsed}ms`);
    process.send({ success: true, resultArray });
    process.exit(0);
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[WORKER] FAIL ${error.message} | time=${elapsed}ms`);
    process.send({ success: false, error: error.message });
    process.exit(1);
  }
});
