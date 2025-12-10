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

  try {
    console.log(`[WORKER] Starting translation of ${texts.length} texts to ${targetLanguage}`);
    console.log(`[WORKER] Using CORS URL: ${corsUrl}`);

    const textToTranslate = texts.join(" ||| ");
    const result = await googleTranslate.translate(textToTranslate, {
      to: targetLanguage,
      corsUrl: corsUrl,
    });

    if (!result || !result.text) {
      console.error('[WORKER] Google Translate returned empty response');
      process.send({ success: false, error: "Google Translate returned empty response" });
      process.exit(0);
      return;
    }

    const resultArray = result.text.split("|||");
    console.log(`[WORKER] Translation successful - received ${resultArray.length} results`);
    process.send({ success: true, resultArray });
    process.exit(0);
  } catch (error) {
    console.error(`[WORKER] Translation error: ${error.message}`);
    console.error(`[WORKER] Error stack: ${error.stack}`);
    process.send({ success: false, error: error.message });
    process.exit(1);
  }
});
