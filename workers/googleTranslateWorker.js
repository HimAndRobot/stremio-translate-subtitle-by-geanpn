const googleTranslate = require("google-translate-api-browser");

process.on('message', async (message) => {
  const { texts, targetLanguage, corsUrl } = message;

  console.log(`[WORKER] Received ${texts.length} texts to translate to ${targetLanguage}`);
  console.log(`[WORKER] Using CORS URL: ${corsUrl}`);

  try {
    const textToTranslate = texts.join(" ||| ");
    console.log(`[WORKER] Starting translation...`);
    const result = await googleTranslate.translate(textToTranslate, {
      to: targetLanguage,
      corsUrl: corsUrl || "http://cors-anywhere.herokuapp.com/",
    });
    console.log(`[WORKER] Translation completed successfully`);

    if (!result || !result.text) {
      process.send({
        success: false,
        error: "Google Translate returned empty response"
      });
      process.exit(0);
      return;
    }

    const resultArray = result.text.split("|||");

    process.send({
      success: true,
      resultArray: resultArray
    });
    process.exit(0);
  } catch (error) {
    console.error(`[WORKER] Translation error:`, error.message);
    console.error(`[WORKER] Error stack:`, error.stack);
    process.send({
      success: false,
      error: error.message
    });
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  console.error('[WORKER] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[WORKER] Unhandled rejection:', reason);
  process.exit(1);
});
