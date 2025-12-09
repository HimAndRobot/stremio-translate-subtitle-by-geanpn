const googleTranslate = require("google-translate-api-browser");

process.on('message', async (message) => {
  const { texts, targetLanguage, corsUrl } = message;

  try {
    const textToTranslate = texts.join(" ||| ");
    const result = await googleTranslate.translate(textToTranslate, {
      to: targetLanguage,
      corsUrl: corsUrl || "http://cors-anywhere.herokuapp.com/",
    });

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
    process.send({
      success: false,
      error: error.message
    });
    process.exit(1);
  }
});
