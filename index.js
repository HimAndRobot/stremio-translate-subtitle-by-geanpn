const {
  addonBuilder,
  publishToCentral,
} = require("stremio-addon-sdk");
const opensubtitles = require("./opensubtitles");
const connection = require("./connection");
const languages = require("./languages");
const { createOrUpdateMessageSub } = require("./subtitles");
const translationQueue = require("./queues/translationQueue");
const baseLanguages = require("./langs/base.lang.json");
const isoCodeMapping = require("./langs/iso_code_mapping.json");
const crypto = require("crypto");
require("dotenv").config();

function generateSubtitleUrl(
  targetLanguage,
  imdbid,
  season,
  episode,
  provider,
  baseUrl = process.env.BASE_URL
) {
  return `${baseUrl}/subtitles/${provider}/${imdbid}/season${season}/${imdbid}-translated-${episode}-1.srt`;
}

const builder = new addonBuilder({
  id: "org.autotranslate.geanpn",
  version: "1.0.2",
  name: "Auto Subtitle Translate by geanpn",
  logo: "./subtitles/logo.webp",
  behaviorHints: {
    configurable: true,
    configurationRequired: true,
  },
  config: [
    {
      key: "provider",
      type: "select",
      options: ["Google Translate", "DeepL", "OpenAI", "Google Gemini", "OpenRouter", "Groq", "Together AI", "Custom"],
    },
    {
      key: "translateto",
      type: "select",
      options: baseLanguages,
    },
    {
      key: "apikey",
      type: "text",
    },
    {
      key: "base_url",
      type: "text",
    },
    {
      key: "model_name",
      type: "text",
    },
  ],
  description:
    "This addon takes subtitles from OpenSubtitlesV3 then translates into desired language using Google Translate, or ChatGPT (OpenAI Compatible Providers). For donations:in progress Bug report: geanpn@gmail.com",
  types: ["series", "movie"],
  catalogs: [],
  resources: ["subtitles"],
});

builder.defineSubtitlesHandler(async function (args) {
  console.log("Subtitle request received:", args);
  const { id, config, stream } = args;

  const targetLanguage = languages.getKeyFromValue(
    config.translateto,
    config.provider
  );

  if (!targetLanguage) {
    console.log("Unsupported language:", config.translateto);
    return Promise.resolve({ subtitles: [] });
  }

  // Extract imdbid from id
  let imdbid = null;
  if (id.startsWith("dcool-")) {
    imdbid = "tt5994346";
  } else if (id !== null && id.startsWith("tt")) {
    const parts = id.split(":");
    if (parts.length >= 1) {
      imdbid = parts[0];
    } else {
      console.log("Invalid ID format.");
    }
  }

  if (imdbid === null) {
    console.log("Invalid ID format.");
    return Promise.resolve({ subtitles: [] });
  }

  const { type, season = null, episode = null } = parseId(id);

  const providerPath = config.password
    ? crypto.createHash('sha256').update(config.password).digest('hex')
    : 'translated';

  try {
    // 1. Check if already exists in database
    const existingSubtitle = await connection.getsubtitles(
      imdbid,
      season,
      episode,
      targetLanguage
    );

    if (existingSubtitle.length > 0) {
      console.log(
        "Subtitle found in database:",
        generateSubtitleUrl(
          targetLanguage,
          imdbid,
          season,
          episode,
          providerPath
        )
      );
      return Promise.resolve({
        subtitles: [
          {
            id: `${imdbid}-subtitle`,
            url: generateSubtitleUrl(
              targetLanguage,
              imdbid,
              season,
              episode,
              providerPath
            ),
            lang: `${targetLanguage}-translated`,
          },
        ],
      });
    }

    // 2. If not found, search OpenSubtitles
    const subs = await opensubtitles.getsubtitles(
      type,
      imdbid,
      season,
      episode,
      targetLanguage
    );

    if (!subs || subs.length === 0) {
      await createOrUpdateMessageSub(
        "No subtitles found on OpenSubtitles",
        imdbid,
        season,
        episode,
        targetLanguage,
        providerPath
      );
      return Promise.resolve({
        subtitles: [
          {
            id: `${imdbid}-subtitle`,
            url: generateSubtitleUrl(
              targetLanguage,
              imdbid,
              season,
              episode,
              providerPath
            ),
            lang: `${targetLanguage}-translated`,
          },
        ],
      });
    }

    const foundSubtitle = subs[0];

    const mappedFoundSubtitleLang = isoCodeMapping[foundSubtitle.lang] || foundSubtitle.lang;

    if (mappedFoundSubtitleLang === targetLanguage) {
      console.log(
        "Desired language subtitle found on OpenSubtitles, returning it directly."
      );
      await connection.addsubtitle(
        imdbid,
        type,
        season,
        episode,
        foundSubtitle.url.replace(`${process.env.BASE_URL}/`, ""),
        targetLanguage
      );
      return Promise.resolve({
        subtitles: [
          {
            id: `${imdbid}-subtitle`,
            url: foundSubtitle.url,
            lang: foundSubtitle.lang,
          },
        ],
      });
    }

    console.log(
      "Subtitles found on OpenSubtitles, but not in target language. Translating..."
    );

    const password_hash = config.password
      ? crypto.createHash('sha256').update(config.password).digest('hex')
      : null;

    const queueStatus = await connection.checkForTranslation(
      imdbid,
      season,
      episode,
      targetLanguage,
      password_hash
    );

    console.log(`[CHECK] queueStatus="${queueStatus}" | ${imdbid} S${season}E${episode} lang:${targetLanguage} | pwHash:${password_hash ? password_hash.substring(0,8)+'...' : 'NULL'}`);

    if (queueStatus === 'processing') {
      console.log("Translation already in progress, returning placeholder");
      return Promise.resolve({
        subtitles: [
          {
            id: `${imdbid}-subtitle`,
            url: generateSubtitleUrl(
              targetLanguage,
              imdbid,
              season,
              episode,
              providerPath
            ),
            lang: `${targetLanguage}-translated`,
          },
        ],
      });
    }

    if (queueStatus === 'failed') {
      console.log(`[FAILED] Translation ${imdbid} S${season}E${episode} lang:${targetLanguage} is FAILED - returning error subtitle WITHOUT adding to queue`);

      return Promise.resolve({
        subtitles: [
          {
            id: `${imdbid}-subtitle`,
            url: generateSubtitleUrl(
              targetLanguage,
              imdbid,
              season,
              episode,
              providerPath
            ),
            lang: `${targetLanguage}-translated`,
          },
        ],
      });
    }

    console.log(`[NEW] Translation ${imdbid} S${season}E${episode} lang:${targetLanguage} does NOT exist - adding to queue`);

    await createOrUpdateMessageSub(
      "Translating subtitles. Please wait 1 minute and try again.",
      imdbid,
      season,
      episode,
      targetLanguage,
      providerPath
    );

    // 3. Process and translate subtitles
    translationQueue.push({
      subs: [foundSubtitle], // Pass the found subtitle to the queue
      imdbid: imdbid,
      season: season,
      episode: episode,
      oldisocode: targetLanguage,
      provider: config.provider,
      apikey: config.apikey ?? null,
      base_url: config.base_url ?? "https://api.openai.com/v1/responses",
      model_name: config.model_name ?? "gpt-4o-mini",
      password: config.password ?? null,
      saveCredentials: config.saveCredentials ?? true,
    });

    console.log(
      "Subtitles processed",
      generateSubtitleUrl(
        targetLanguage,
        imdbid,
        season,
        episode,
        providerPath
      )
    );

    await connection.addsubtitle(
      imdbid,
      type,
      season,
      episode,
      generateSubtitleUrl(
        targetLanguage,
        imdbid,
        season,
        episode,
        providerPath
      ).replace(`${process.env.BASE_URL}/`, ""),
      targetLanguage
    );

    return Promise.resolve({
      subtitles: [
        {
          id: `${imdbid}-subtitle`,
          url: generateSubtitleUrl(
            targetLanguage,
            imdbid,
            season,
            episode,
            providerPath
          ),
          lang: `${targetLanguage}-translated`,
        },
      ],
    });
  } catch (error) {
    console.error("Error processing subtitles:", error);
    return Promise.resolve({ subtitles: [] });
  }
});

function parseId(id) {
  if (id.startsWith("tt")) {
    const match = id.match(/tt(\d+):(\d+):(\d+)/);
    if (match) {
      const [, , season, episode] = match;
      return {
        type: "series",
        season: Number(season),
        episode: Number(episode),
      };
    } else {
      return { type: "movie", season: 1, episode: 1 };
    }
  } else if (id.startsWith("dcool-")) {
    // New format: dcool-tomorrow-with-you::tomorrow-with-you-episode-1
    const match = id.match(/dcool-(.+)::(.+)-episode-(\d+)/);
    if (match) {
      const [, , title, episode] = match;
      return {
        type: "series",
        title: title,
        episode: Number(episode),
        season: 1, // Assuming season 1 for this format
      };
    }
  }
  return { type: "unknown", season: 0, episode: 0 };
}

// Comment out this line for local execution, uncomment for production deployment
// Cannot publish to central locally as there is no public IP, so it won't show up in the Stremio store

if (process.env.PUBLISH_IN_STREMIO_STORE == "TRUE") {
  publishToCentral(`http://${process.env.ADDRESS}/manifest.json`);
}

const port = process.env.PORT || 3000;
const address = process.env.ADDRESS || "0.0.0.0";
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const getRouter = require("stremio-addon-sdk/src/getRouter");

const { createBullBoard } = require("@bull-board/api");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
const { ExpressAdapter } = require("@bull-board/express");

const app = express();

app.set('view engine', 'ejs');
app.set('views', './views');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.ENCRYPTION_KEY || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use((_, res, next) => {
  res.setHeader("Cache-Control", "max-age=10, public");
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.userPasswordHash) {
    return res.redirect('/admin/login');
  }
  next();
}

app.get("/", (_, res) => {
  res.redirect("/configure");
});

app.get("/admin/login", (req, res) => {
  if (req.session.userPasswordHash) {
    return res.redirect('/admin/dashboard');
  }
  res.sendFile(__dirname + '/views/login.html');
});

app.post("/admin/auth", async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  try {
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

    const adapter = await connection.getAdapter();
    const results = await adapter.query(
      'SELECT COUNT(*) as count FROM translation_queue WHERE password_hash = ?',
      [passwordHash]
    );

    if (results[0].count > 0) {
      req.session.userPasswordHash = passwordHash;
      return res.json({ success: true, redirect: '/admin/dashboard' });
    }

    return res.status(401).json({ error: 'Invalid password' });
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

app.get("/admin/dashboard", requireAuth, async (req, res) => {
  try {
    const adapter = await connection.getAdapter();
    const translations = await adapter.query(
      `SELECT id, series_imdbid, series_seasonno, series_episodeno, langcode, status,
              series_name, poster, retry_attempts, token_usage_total, created_at
       FROM translation_queue
       WHERE password_hash = ?
       ORDER BY created_at DESC`,
      [req.session.userPasswordHash]
    );

    for (const translation of translations) {
      const batchStats = await adapter.query(
        `SELECT COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed,
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed
         FROM subtitle_batches
         WHERE translation_queue_id = ?`,
        [translation.id]
      );

      translation.batches_total = Number(batchStats[0]?.total) || 0;
      translation.batches_completed = Number(batchStats[0]?.completed) || 0;
      translation.batches_failed = Number(batchStats[0]?.failed) || 0;
    }

    // Group translations by series
    const groupedSeries = new Map();

    for (const translation of translations) {
      const key = `${translation.series_imdbid}_${translation.langcode}`;

      if (!groupedSeries.has(key)) {
        groupedSeries.set(key, {
          series_imdbid: translation.series_imdbid,
          series_name: translation.series_name,
          poster: translation.poster,
          langcode: translation.langcode,
          episodes: [],
          isMovie: !translation.series_seasonno && !translation.series_episodeno,
          total_tokens: 0
        });
      }

      groupedSeries.get(key).episodes.push(translation);
    }

    for (const seriesGroup of groupedSeries.values()) {
      seriesGroup.total_tokens = seriesGroup.episodes.reduce((sum, ep) =>
        sum + (ep.token_usage_total || 0), 0
      );
    }

    const corsProxy = process.env.CORS_URL || '';

    res.render('dashboard', {
      translations,
      groupedSeries: Array.from(groupedSeries.values()),
      corsProxy,
      languages: baseLanguages
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send('Error loading dashboard');
  }
});

app.get("/admin/settings", requireAuth, async (req, res) => {
  try {
    res.render('settings');
  } catch (error) {
    console.error('Settings error:', error);
    res.status(500).send('Error loading settings');
  }
});

app.post("/admin/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true, redirect: '/admin/login' });
});

app.post("/admin/reprocess", requireAuth, async (req, res) => {
  const { id } = req.body;

  try {
    const adapter = await connection.getAdapter();
    const result = await adapter.query(
      'SELECT * FROM translation_queue WHERE id = ? AND password_hash = ?',
      [id, req.session.userPasswordHash]
    );

    if (result.length === 0) {
      return res.status(404).json({ error: 'Translation not found' });
    }

    const translation = result[0];

    await connection.updateTranslationStatus(
      translation.series_imdbid,
      translation.series_seasonno,
      translation.series_episodeno,
      translation.langcode,
      'processing'
    );

    const newRetryCount = (translation.retry_attempts || 0) + 1;
    await adapter.query(
      'UPDATE translation_queue SET retry_attempts = ?, last_retry_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newRetryCount, translation.id]
    );

    const subs = await opensubtitles.getsubtitles(
      translation.series_seasonno ? 'series' : 'movie',
      translation.series_imdbid,
      translation.series_seasonno,
      translation.series_episodeno,
      translation.langcode
    );

    if (subs && subs.length > 0) {
      const { decryptCredential } = require('./utils/crypto');
      const encryptionKey = process.env.ENCRYPTION_KEY;

      let apikey = null;
      let base_url = null;
      let model_name = null;

      if (encryptionKey && encryptionKey.length === 32) {
        if (translation.apikey_encrypted) {
          apikey = decryptCredential(translation.apikey_encrypted, encryptionKey);
        }
        if (translation.base_url_encrypted) {
          base_url = decryptCredential(translation.base_url_encrypted, encryptionKey);
        }
        if (translation.model_name_encrypted) {
          model_name = decryptCredential(translation.model_name_encrypted, encryptionKey);
        }
      }

      const provider = base_url ?
        (base_url.includes('openai.com') ? 'OpenAI' :
         base_url.includes('generativelanguage.googleapis.com') ? 'Google Gemini' :
         base_url.includes('openrouter.ai') ? 'OpenRouter' :
         base_url.includes('groq.com') ? 'Groq' :
         base_url.includes('together.xyz') ? 'Together AI' : 'Custom')
        : 'Google Translate';

      translationQueue.push({
        subs: subs,
        imdbid: translation.series_imdbid,
        season: translation.series_seasonno,
        episode: translation.series_episodeno,
        oldisocode: translation.langcode,
        provider: provider,
        apikey: apikey,
        base_url: base_url,
        model_name: model_name,
        password_hash: req.session.userPasswordHash,
        saveCredentials: false,
      });

      console.log(`Reprocess job queued for ${translation.series_imdbid} with provider ${provider}`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Reprocess error:', error);
    res.status(500).json({ error: 'Failed to reprocess' });
  }
});

app.post("/admin/reprocess-with-credentials", requireAuth, async (req, res) => {
  const { id, language, provider, apikey, base_url, model_name } = req.body;

  try {
    const adapter = await connection.getAdapter();
    const result = await adapter.query(
      'SELECT * FROM translation_queue WHERE id = ? AND password_hash = ?',
      [id, req.session.userPasswordHash]
    );

    if (result.length === 0) {
      return res.status(404).json({ error: 'Translation not found' });
    }

    const translation = result[0];
    const targetLanguage = language || translation.langcode;

    const targetLangKey = languages.getKeyFromValue(targetLanguage, provider);

    await connection.updateTranslationStatus(
      translation.series_imdbid,
      translation.series_seasonno,
      translation.series_episodeno,
      translation.langcode,
      'processing'
    );

    const newRetryCount = (translation.retry_attempts || 0) + 1;
    await adapter.query(
      'UPDATE translation_queue SET retry_attempts = ?, last_retry_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newRetryCount, translation.id]
    );

    const subs = await opensubtitles.getsubtitles(
      translation.series_seasonno ? 'series' : 'movie',
      translation.series_imdbid,
      translation.series_seasonno,
      translation.series_episodeno,
      targetLangKey
    );

    if (subs && subs.length > 0) {
      translationQueue.push({
        subs: subs,
        imdbid: translation.series_imdbid,
        season: translation.series_seasonno,
        episode: translation.series_episodeno,
        oldisocode: targetLangKey,
        provider: provider,
        apikey: apikey || null,
        base_url: base_url || null,
        model_name: model_name || null,
        password_hash: req.session.userPasswordHash,
        saveCredentials: false,
        existingTranslationQueueId: translation.id,
      });

      console.log(`Reprocess job queued for ${translation.series_imdbid} with provider ${provider} to language ${targetLanguage} (reusing translation_queue ${translation.id})`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Reprocess with credentials error:', error);
    res.status(500).json({ error: 'Failed to reprocess' });
  }
});

app.post("/admin/delete", requireAuth, async (req, res) => {
  const { id } = req.body;

  try {
    const adapter = await connection.getAdapter();
    const result = await adapter.query(
      'SELECT * FROM translation_queue WHERE id = ? AND password_hash = ?',
      [id, req.session.userPasswordHash]
    );

    if (result.length === 0) {
      return res.status(404).json({ error: 'Translation not found' });
    }

    const translation = result[0];

    await connection.deletetranslationQueue(
      translation.series_imdbid,
      translation.series_seasonno,
      translation.series_episodeno,
      translation.langcode
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

app.get("/configure", (_req, res) => {
  fs.readFile("./configure.html", "utf8", (err, data) => {
    if (err) {
      res.status(500).send("Error loading configuration page");
      return;
    }

    const html = data
      .replace("<%= languages %>", JSON.stringify(baseLanguages))
      .replace(
        "<%= baseUrl %>",
        process.env.BASE_URL || `http://${address}:${port}`
      );

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });
});

const batchQueue = require("./queues/batchQueue");
const downloadQueue = require("./queues/downloadQueue");

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [
    new BullMQAdapter(translationQueue),
    new BullMQAdapter(batchQueue),
    new BullMQAdapter(downloadQueue)
  ],
  serverAdapter,
});

const bullBoardAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
    return res.status(401).send('Authentication required');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  const validUsername = process.env.BULL_BOARD_USERNAME || 'admin';
  const validPassword = process.env.BULL_BOARD_PASSWORD || 'admin';

  if (username === validUsername && password === validPassword) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
  return res.status(401).send('Invalid credentials');
};

app.use("/admin/queues", bullBoardAuth, serverAdapter.getRouter());

app.use("/subtitles", async (req, _res, next) => {
  if (!req.path.endsWith('.srt')) {
    return next();
  }

  const pathMatch = req.path.match(/\/([^\/]+)\/([^\/]+)\/(?:season(\d+)\/)?([^\/]+)-translated/);

  if (!pathMatch) {
    return next();
  }

  const [, provider, imdbid, season] = pathMatch;
  const episodeMatch = req.path.match(/-translated-(\d+)-/);
  const episode = episodeMatch ? episodeMatch[1] : null;

  let langcode = null;
  try {
    const adapter = await connection.getAdapter();
    const translationInfo = await adapter.query(
      `SELECT langcode FROM translation_queue
       WHERE series_imdbid = ? AND series_seasonno = ? AND series_episodeno = ?
       LIMIT 1`,
      [imdbid, season ? parseInt(season) : null, episode ? parseInt(episode) : null]
    );
    langcode = translationInfo.length > 0 ? translationInfo[0].langcode : null;

    if (!langcode) {
      console.log(`No translation found for ${imdbid} S${season}E${episode}`);
      return next();
    }

    const queueStatus = await connection.checkForTranslation(
      imdbid,
      season ? parseInt(season) : null,
      episode ? parseInt(episode) : null,
      langcode
    );

    if (queueStatus === 'failed') {
      console.log(`File access for failed translation ${imdbid}, triggering retry...`);

      await connection.updateTranslationStatus(
        imdbid,
        season ? parseInt(season) : null,
        episode ? parseInt(episode) : null,
        langcode,
        'processing'
      );

      const subs = await opensubtitles.getsubtitles(
        season ? 'series' : 'movie',
        imdbid,
        season ? parseInt(season) : null,
        episode ? parseInt(episode) : null,
        langcode
      );

      if (subs && subs.length > 0) {
        const password_hash = (provider && provider !== 'translated') ? provider : null;

        translationQueue.push({
          subs: subs,
          imdbid: imdbid,
          season: season ? parseInt(season) : null,
          episode: episode ? parseInt(episode) : null,
          oldisocode: langcode,
          provider: provider,
          apikey: process.env.DEFAULT_API_KEY || null,
          base_url: process.env.DEFAULT_BASE_URL || null,
          model_name: process.env.DEFAULT_MODEL || null,
          password_hash: password_hash,
          saveCredentials: false,
        });

        console.log(`Retry job created for ${imdbid}, serving error subtitle meanwhile`);
      }
    } else if (queueStatus === 'processing') {
      console.log(`File access for processing translation ${imdbid}, serving placeholder...`);
    } else if (queueStatus === 'completed') {
      console.log(`File access for completed translation ${imdbid}, serving translated file`);
    }
  } catch (error) {
    console.error('Error checking translation status:', error);
  }

  next();
});

app.get("/api/search", requireAuth, async (req, res) => {
  try {
    const { q } = req.query;
    const { searchContent } = require("./utils/search");
    const result = await searchContent(q);
    res.json(result);
  } catch (error) {
    console.error("Search API error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/episodes/:imdbid", requireAuth, async (req, res) => {
  try {
    const { imdbid } = req.params;
    const { getEpisodes } = require("./utils/search");
    const result = await getEpisodes(imdbid);
    res.json(result);
  } catch (error) {
    console.error("Episodes API error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/download", requireAuth, async (req, res) => {
  try {
    const { imdbid, type, episodes, targetLanguage, provider, apikey, base_url, model_name } = req.body;

    if (!imdbid || !type || !episodes || episodes.length === 0 || !targetLanguage || !provider) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const targetLangKey = languages.getKeyFromValue(targetLanguage, provider);
    if (!targetLangKey) {
      return res.status(400).json({ error: `Invalid language: ${targetLanguage} for provider ${provider}` });
    }

    const downloadQueue = require("./queues/downloadQueue");

    await downloadQueue.add('download-request', {
      imdbid,
      type,
      episodes,
      targetLanguage: targetLangKey,
      provider,
      apikey,
      base_url,
      model_name,
      password_hash: req.session.userPasswordHash
    });

    res.json({ success: true, message: `Queued ${episodes.length} episode(s) for translation` });
  } catch (error) {
    console.error("Download API error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.use("/subtitles", express.static("subtitles"));
app.use("/public", express.static("public"));

app.use(getRouter(builder.getInterface()));

const server = app.listen(port, address, () => {
  console.log(`Server started: http://${address}:${port}`);
  console.log("Manifest available:", `http://${address}:${port}/manifest.json`);
  console.log("Configuration:", `http://${address}:${port}/configure`);
  console.log("Bull Board Dashboard:", `http://${address}:${port}/admin/queues`);
});

server.on("error", (error) => {
  console.error("Server startup error:", error);
});
