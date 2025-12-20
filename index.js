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
const languageToISO6392 = require("./langs/language_to_iso639_2.json");
const crypto = require("crypto");
require("dotenv").config();

function getISO6392Code(languageName, shortCode) {
  const iso6392 = languageToISO6392[languageName];
  if (iso6392) {
    return iso6392;
  }
  return `${shortCode}-translated`;
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
    {
      key: "password",
      type: "text",
    },
    {
      key: "saveCredentials",
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
  const { id, config, extra } = args;

  const targetLanguage = languages.getKeyFromValue(
    config.translateto,
    config.provider
  );

  if (!targetLanguage) {
    console.log("Unsupported language:", config.translateto);
    return Promise.resolve({ subtitles: [] });
  }

  const iso6392Lang = getISO6392Code(config.translateto, targetLanguage);

  let password_hash = null;
  if (config.username && config.password) {
    password_hash = crypto.createHash('sha256').update(config.username + config.password).digest('hex');
  } else if (config.password) {
    password_hash = crypto.createHash('sha256').update(config.password).digest('hex');
  }

  const providerPath = password_hash || 'translated';

  const existingRecord = await connection.checkForTranslationByStremioId(id, password_hash);
  if (existingRecord && existingRecord.subtitle_path) {
    console.log(`[HANDLER] Found existing record for stremio_id: ${id}, status: ${existingRecord.status}`);

    return Promise.resolve({
      subtitles: [{
        id: `${id}-subtitle`,
        url: `${process.env.BASE_URL}/subtitles/${existingRecord.subtitle_path}`,
        lang: iso6392Lang,
      }],
    });
  }

  const parsed = parseId(id);
  let imdbid = null;
  let season = null;
  let episode = null;
  let type = parsed.type;

  if (id.startsWith("kkh-")) {
    console.log('[HANDLER] KissKH format detected, resolving...');
    const integrations = require("./integrations");
    try {
      const resolved = await integrations.kisskh.resolveKissKHId(id, password_hash);
      if (resolved) {
        imdbid = resolved.imdbid;
        season = resolved.season;
        episode = resolved.episode;
        type = "series";
        console.log(`[HANDLER] KissKH resolved to ${imdbid} S${season}E${episode} (similarity: ${(resolved.similarity * 100).toFixed(1)}%)`);

        if (resolved.similarity < 0.70) {
          console.log(`[HANDLER] Low similarity (${(resolved.similarity * 100).toFixed(1)}%), marking as manual_search`);
          const unknownImdb = 'unknown';
          const subtitlePath = `${providerPath}/${unknownImdb}/S${season}E${episode}.srt`;

          await connection.addToTranslationQueue(
            unknownImdb, season, episode, 0, targetLanguage, password_hash,
            null, null, null, null, null, id, subtitlePath, type, 'manual_search'
          );

          await createOrUpdateMessageSub(
            "We couldn't automatically identify this content. Please access the dashboard to search and add subtitles manually.",
            subtitlePath
          );

          return Promise.resolve({
            subtitles: [{
              id: `${id}-subtitle`,
              url: `${process.env.BASE_URL}/subtitles/${subtitlePath}`,
              lang: iso6392Lang,
            }],
          });
        }
      } else {
        throw new Error('Failed to resolve KissKH ID');
      }
    } catch (error) {
      console.error(`[HANDLER] KissKH resolution failed: ${error.message}`);
      return Promise.resolve({ subtitles: [] });
    }
  } else if (id.startsWith("dcool-")) {
    console.log('[HANDLER] DCool format detected, resolving...');
    imdbid = "tt5994346";
    const match = id.match(/dcool-(.+)::(.+)-episode-(\d+)/);
    if (match) {
      const [, , , ep] = match;
      type = "series";
      season = 1;
      episode = Number(ep);
      console.log(`[HANDLER] DCool resolved to ${imdbid} S${season}E${episode}`);
    } else {
      console.error('[HANDLER] Invalid DCool format');
      return Promise.resolve({ subtitles: [] });
    }
  } else if (id.startsWith("tt")) {
    console.log('[HANDLER] IMDb format detected');
    const parts = id.split(":");
    imdbid = parts[0];

    const match = id.match(/tt(\d+):(\d+):(\d+)/);
    if (match) {
      const [, , s, e] = match;
      type = "series";
      season = Number(s);
      episode = Number(e);
      console.log(`[HANDLER] IMDb resolved to ${imdbid} S${season}E${episode}`);
    } else {
      type = "movie";
      season = 1;
      episode = 1;
      console.log(`[HANDLER] IMDb resolved to ${imdbid} (movie)`);
    }
  }

  if (!imdbid && extra && extra.filename) {
    console.log(`[HANDLER] Trying Cinemeta fallback with filename: ${extra.filename}`);
    try {
      const { searchContent } = require("./utils/search");
      const searchResults = await searchContent(extra.filename);

      if (searchResults.results && searchResults.results.length > 0) {
        imdbid = searchResults.results[0].id;
        type = searchResults.results[0].type;
        console.log(`[HANDLER] Cinemeta found: ${imdbid} (${searchResults.results[0].name})`);

        if (type === "movie") {
          season = 1;
          episode = 1;
        }
      }
    } catch (error) {
      console.error(`[HANDLER] Cinemeta fallback failed: ${error.message}`);
    }
  }

  if (!imdbid) {
    console.error('[HANDLER] Could not resolve IMDb ID from stremioId');
    return Promise.resolve({ subtitles: [] });
  }

  const subtitlePath = type === "movie"
    ? `${providerPath}/${imdbid}/movie.srt`
    : `${providerPath}/${imdbid}/S${season}E${episode}.srt`;

  try {
    const lockResult = await connection.checkAndLockForTranslation(
      imdbid,
      season,
      episode,
      password_hash
    );

    console.log(`[HANDLER] lockResult="${JSON.stringify(lockResult)}" | ${imdbid} S${season}E${episode} lang:${targetLanguage}`);

    if (lockResult.alreadyExists) {
      const statusMessages = {
        'completed': 'Subtitle found in database (completed), returning it',
        'processing': 'Translation in progress, returning placeholder',
        'failed': 'Translation failed, returning error subtitle',
        'manual_search': 'Manual search required, returning help message'
      };

      console.log(`[HANDLER] ${statusMessages[lockResult.status]}`);

      const subtitleUrl = lockResult.subtitle_path
        ? `${process.env.BASE_URL}/subtitles/${lockResult.subtitle_path}`
        : `${process.env.BASE_URL}/subtitles/${subtitlePath}`;

      return Promise.resolve({
        subtitles: [
          {
            id: `${id}-subtitle`,
            url: subtitleUrl,
            lang: iso6392Lang,
          },
        ],
      });
    }

    console.log("[HANDLER] No translation found, adding to queue");

    await connection.addToTranslationQueue(
      imdbid,
      season,
      episode,
      0,
      targetLanguage,
      password_hash,
      null,
      null,
      null,
      null,
      null,
      id,
      subtitlePath,
      type
    );

    translationQueue.push({
      stremioId: id,
      extra: extra,
      oldisocode: targetLanguage,
      provider: config.provider,
      apikey: config.apikey,
      base_url: config.base_url,
      model_name: config.model_name,
      password_hash: password_hash,
    });

    console.log("[HANDLER] Job queued for automatic processing");

    await createOrUpdateMessageSub(
      "We are processing your subtitle. Please check the dashboard or wait 1 minute.",
      subtitlePath
    );

    return Promise.resolve({
      subtitles: [
        {
          id: `${id}-subtitle`,
          url: `${process.env.BASE_URL}/subtitles/${subtitlePath}`,
          lang: iso6392Lang,
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
const multer = require("multer");
const path = require("path");

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

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads', 'temp');
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `subtitle-${uniqueSuffix}.srt`);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.srt') {
      return cb(new Error('Only .srt files are allowed'));
    }
    cb(null, true);
  }
});

async function detectUserType(req) {
  const passwordHash = req.session.userPasswordHash;
  const adapter = await connection.getAdapter();

  const userResults = await adapter.query(
    'SELECT username, needs_addon_reconfiguration FROM users WHERE password_hash = ?',
    [passwordHash]
  );

  if (userResults.length > 0) {
    return {
      isOldUser: false,
      hasUsername: true,
      username: userResults[0].username,
      needsAddonReconfiguration: Boolean(userResults[0].needs_addon_reconfiguration)
    };
  }

  const queueResults = await adapter.query(
    'SELECT COUNT(*) as count FROM translation_queue WHERE password_hash = ?',
    [passwordHash]
  );

  if (queueResults[0].count > 0) {
    return {
      isOldUser: true,
      hasUsername: false,
      username: null,
      needsAddonReconfiguration: false
    };
  }

  return {
    isOldUser: false,
    hasUsername: false,
    username: null,
    needsAddonReconfiguration: false
  };
}

async function attachUserInfo(req, res, next) {
  try {
    req.userInfo = await detectUserType(req);
    next();
  } catch (error) {
    console.error('Error detecting user type:', error);
    req.userInfo = { isOldUser: false, hasUsername: false, username: null, needsAddonReconfiguration: false };
    next();
  }
}

function requireAuth(req, res, next) {
  if (!req.session.userPasswordHash) {
    return res.redirect('/admin/login');
  }
  next();
}

app.get("/", (_, res) => {
  res.redirect("/configure");
});

app.post("/api/create-user", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const bcrypt = require('bcryptjs');
    const passwordHash = crypto.createHash('sha256').update(username + password).digest('hex');
    const passwordBcrypt = await bcrypt.hash(password, 10);
    const adapter = await connection.getAdapter();

    const existingUser = await adapter.query(
      'SELECT id, needs_addon_reconfiguration FROM users WHERE username = ?',
      [username]
    );

    if (existingUser.length === 0) {
      await adapter.query(
        'INSERT INTO users (username, password_hash, password_bcrypt, needs_addon_reconfiguration) VALUES (?, ?, ?, ?)',
        [username, passwordHash, passwordBcrypt, false]
      );
    } else if (existingUser[0].needs_addon_reconfiguration) {
      await adapter.query(
        'UPDATE users SET needs_addon_reconfiguration = ? WHERE username = ?',
        [false, username]
      );
      console.log(`[CREATE-USER] User ${username} reconfigured addon, marking needs_addon_reconfiguration=false`);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Create user error:', error);
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

app.get("/admin/login", (req, res) => {
  if (req.session.userPasswordHash) {
    return res.redirect('/admin/dashboard');
  }
  res.sendFile(__dirname + '/views/login.html');
});

app.get("/admin/migrate", requireAuth, async (req, res) => {
  try {
    const userInfo = await detectUserType(req);

    if (!userInfo.isOldUser) {
      return res.redirect('/admin/dashboard');
    }

    res.sendFile(__dirname + '/views/migrate-account.html');
  } catch (error) {
    console.error('Error accessing migration page:', error);
    res.redirect('/admin/dashboard');
  }
});

app.post("/admin/auth", async (req, res) => {
  const { username, password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  try {
    const adapter = await connection.getAdapter();

    if (username && username.trim() !== '') {
      const passwordHash = crypto.createHash('sha256').update(username + password).digest('hex');

      const userResults = await adapter.query(
        'SELECT COUNT(*) as count FROM users WHERE password_hash = ?',
        [passwordHash]
      );

      if (userResults[0].count > 0) {
        req.session.userPasswordHash = passwordHash;
        return res.json({ success: true, redirect: '/admin/dashboard' });
      }

      return res.status(401).json({ error: 'Invalid credentials' });
    } else {
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

      const queueResults = await adapter.query(
        'SELECT COUNT(*) as count FROM translation_queue WHERE password_hash = ?',
        [passwordHash]
      );

      if (queueResults[0].count > 0) {
        req.session.userPasswordHash = passwordHash;
        return res.json({ success: true, redirect: '/admin/dashboard' });
      }

      return res.status(401).json({ error: 'Invalid password' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

app.get("/api/user-info", requireAuth, async (req, res) => {
  try {
    const userInfo = await detectUserType(req);
    res.json(userInfo);
  } catch (error) {
    console.error('User info error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

app.post("/api/migrate-account", requireAuth, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const bcrypt = require('bcryptjs');
    const adapter = await connection.getAdapter();

    const oldPasswordHash = req.session.userPasswordHash;

    const userInfo = await detectUserType(req);
    if (!userInfo.isOldUser) {
      return res.status(400).json({ error: 'Account already migrated' });
    }

    const newPasswordHash = crypto.createHash('sha256').update(username + password).digest('hex');
    const passwordBcrypt = await bcrypt.hash(password, 10);

    const existingUser = await adapter.query(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );

    if (existingUser.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    await adapter.query(
      'INSERT INTO users (username, password_hash, password_bcrypt, needs_addon_reconfiguration) VALUES (?, ?, ?, ?)',
      [username, newPasswordHash, passwordBcrypt, true]
    );

    await adapter.query(
      'UPDATE translation_queue SET password_hash = ? WHERE password_hash = ?',
      [newPasswordHash, oldPasswordHash]
    );

    req.session.userPasswordHash = newPasswordHash;

    return res.json({
      success: true,
      message: 'Account migrated successfully'
    });
  } catch (error) {
    console.error('Migration error:', error);
    return res.status(500).json({ error: 'Failed to migrate account' });
  }
});

app.get("/admin/dashboard", requireAuth, attachUserInfo, async (req, res) => {
  try {
    const adapter = await connection.getAdapter();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    const offset = (page - 1) * limit;

    const translations = await adapter.query(
      `SELECT id, series_imdbid, series_seasonno, series_episodeno, langcode, status,
              series_name, poster, retry_attempts, token_usage_total, created_at, type
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

    const groupedSeries = new Map();

    for (const translation of translations) {
      const key = translation.series_imdbid;

      if (!groupedSeries.has(key)) {
        const isMovie = translation.type === 'movie';

        groupedSeries.set(key, {
          series_imdbid: translation.series_imdbid,
          series_name: translation.series_name,
          poster: translation.poster,
          episodes: [],
          isMovie: isMovie,
          type: translation.type || 'series',
          total_tokens: 0
        });
      }

      groupedSeries.get(key).episodes.push(translation);
    }

    for (const seriesGroup of groupedSeries.values()) {
      seriesGroup.episodes.sort((a, b) => {
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        return dateB - dateA;
      });

      seriesGroup.total_tokens = seriesGroup.episodes.reduce((sum, ep) =>
        sum + (ep.token_usage_total || 0), 0
      );

      const uniqueLangs = [...new Set(seriesGroup.episodes.map(ep => ep.langcode))];
      seriesGroup.languages = uniqueLangs.join(', ');
    }

    const allGroupedSeries = Array.from(groupedSeries.values());
    const totalSeries = allGroupedSeries.length;
    const totalPages = Math.max(1, Math.ceil(totalSeries / limit));
    const paginatedSeries = allGroupedSeries.slice(offset, offset + limit);

    const corsProxy = process.env.CORS_URL || '';
    const migrationDeadline = new Date('2025-11-17T23:59:59');

    res.render('dashboard', {
      translations,
      groupedSeries: paginatedSeries,
      corsProxy,
      languages: baseLanguages,
      userInfo: req.userInfo,
      migrationDeadline: migrationDeadline.toISOString(),
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalSeries: totalSeries,
        limit: limit,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
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
        stremioId: translation.stremio_id,
        imdbid: translation.series_imdbid,
        season: translation.series_seasonno,
        episode: translation.series_episodeno,
        oldisocode: targetLangKey,
        provider: provider,
        apikey: apikey || null,
        base_url: base_url || null,
        model_name: model_name || null,
        password_hash: req.session.userPasswordHash,
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

app.get("/api/subtitles/:imdbid/:season/:episode", requireAuth, async (req, res) => {
  try {
    const { imdbid, season, episode } = req.params;
    const { getAllSubtitles } = require("./opensubtitles");

    const type = (season && season !== 'null' && episode && episode !== 'null') ? 'series' : 'movie';
    const subtitles = await getAllSubtitles(
      type,
      imdbid,
      (season && season !== 'null') ? parseInt(season) : null,
      (episode && episode !== 'null') ? parseInt(episode) : null
    );

    res.json({ subtitles });
  } catch (error) {
    console.error("Subtitles API error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/upload-subtitle", requireAuth, upload.single('subtitle'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    res.json({
      success: true,
      filePath: req.file.path,
      filename: req.file.originalname
    });
  } catch (error) {
    console.error("Upload subtitle error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/download", requireAuth, async (req, res) => {
  try {
    const { imdbid, type, episodes, targetLanguage, provider, apikey, base_url, model_name, customSubtitles } = req.body;

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
      password_hash: req.session.userPasswordHash,
      customSubtitles: customSubtitles || null
    });

    res.json({ success: true, message: `Queued ${episodes.length} episode(s) for translation` });
  } catch (error) {
    console.error("Download API error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/identify-content", requireAuth, async (req, res) => {
  try {
    const { id, imdbId, name, poster } = req.body;

    if (!id || !imdbId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const adapter = await connection.getAdapter();

    const result = await adapter.query(
      'SELECT * FROM translation_queue WHERE id = ? AND password_hash = ?',
      [id, req.session.userPasswordHash]
    );

    if (result.length === 0) {
      return res.status(404).json({ error: 'Translation not found' });
    }

    const translation = result[0];
    const oldSubtitlePath = translation.subtitle_path;
    const newSubtitlePath = oldSubtitlePath.replace('/unknown/', `/${imdbId}/`);

    await adapter.query(
      'UPDATE translation_queue SET series_imdbid = ?, series_name = ?, poster = ?, status = ?, subtitle_path = ? WHERE id = ?',
      [imdbId, name || null, poster || null, 'failed', newSubtitlePath, id]
    );

    console.log(`[IDENTIFY] Content identified: ${imdbId} (${name})`);
    console.log(`[IDENTIFY] Updated subtitle_path: ${oldSubtitlePath} -> ${newSubtitlePath}`);
    res.json({ success: true, message: 'Content identified! Now reprocess your episode to start translation' });
  } catch (error) {
    console.error("Identify content error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/download-subtitle/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const adapter = await connection.getAdapter();

    const result = await adapter.query(
      'SELECT * FROM translation_queue WHERE id = ? AND password_hash = ?',
      [id, req.session.userPasswordHash]
    );

    if (result.length === 0) {
      return res.status(404).json({ error: 'Translation not found' });
    }

    const translation = result[0];

    if (translation.status !== 'completed') {
      return res.status(400).json({ error: 'Translation is not completed yet' });
    }

    if (!translation.subtitle_path) {
      return res.status(404).json({ error: 'Subtitle path not found in database' });
    }

    const fs = require('fs');
    const path = require('path');
    const fullPath = path.join(__dirname, 'subtitles', translation.subtitle_path);

    console.log(`[DOWNLOAD] Attempting to download subtitle for translation ${id}`);
    console.log(`[DOWNLOAD] subtitle_path from DB: ${translation.subtitle_path}`);
    console.log(`[DOWNLOAD] fullPath: ${fullPath}`);
    console.log(`[DOWNLOAD] File exists: ${fs.existsSync(fullPath)}`);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        error: 'Subtitle file not found',
        path: translation.subtitle_path,
        fullPath: fullPath
      });
    }

    const isMovie = translation.type === 'movie';

    let fileName;
    if (isMovie) {
      fileName = `${translation.series_name || translation.series_imdbid}_${translation.langcode}.srt`;
    } else {
      fileName = `${translation.series_name || translation.series_imdbid}_S${String(translation.series_seasonno).padStart(2, '0')}E${String(translation.series_episodeno).padStart(2, '0')}_${translation.langcode}.srt`;
    }

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    const fileStream = fs.createReadStream(fullPath);
    fileStream.pipe(res);
  } catch (error) {
    console.error("Download subtitle error:", error);
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

async function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Received shutdown signal, starting graceful shutdown...`);

  server.close(async () => {
    console.log('[SHUTDOWN] HTTP server closed');

    try {
      const batchQueue = require('./queues/batchQueue');
      const Worker = require('bullmq').Worker;

      console.log('[SHUTDOWN] Closing workers...');

      const translationWorker = translationQueue.workers ? translationQueue.workers[0] : null;
      const batchWorker = batchQueue.workers ? batchQueue.workers[0] : null;

      const closePromises = [];

      if (translationWorker instanceof Worker) {
        closePromises.push(translationWorker.close());
      }

      if (batchWorker instanceof Worker) {
        closePromises.push(batchWorker.close());
      }

      await Promise.all(closePromises);
      console.log('[SHUTDOWN] All workers closed');

      await connection.disconnect();
      console.log('[SHUTDOWN] Database connection closed');

      console.log('[SHUTDOWN] Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      console.error('[SHUTDOWN] Error during shutdown:', error);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error('[SHUTDOWN] Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  console.error('[CRITICAL] Uncaught Exception:', error);
  console.error('[CRITICAL] Stack:', error.stack);
  console.error('[CRITICAL] Server continuing to run...');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Promise Rejection at:', promise);
  console.error('[CRITICAL] Reason:', reason);
  console.error('[CRITICAL] Server continuing to run...');
});
