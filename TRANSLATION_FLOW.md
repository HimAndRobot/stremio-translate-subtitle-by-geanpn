# Translation Flow Diagram

## Overview
This document describes the complete flow of subtitle translation from user input to final delivery.

## Entry Points

### 1. Add Subtitle (Dashboard)
**Route:** `POST /api/download`
**File:** [index.js:871-903](index.js#L871-L903)

```
User Input (Dashboard Form)
    ↓
POST /api/download
    ├─ imdbid
    ├─ type (series/movie)
    ├─ episodes []
    ├─ targetLanguage (language name)
    ├─ provider
    ├─ apikey
    ├─ base_url
    └─ model_name
    ↓
Validate & Convert Language
    languages.getKeyFromValue(targetLanguage, provider)
    → Converts "Portuguese (Brasil)" to "PT-BR"
    ↓
Add to downloadQueue
    ├─ targetLanguage: PT-BR (code)
    ├─ password_hash (from session)
    └─ other params
```

### 2. Reprocess (Existing Credentials)
**Route:** `POST /admin/reprocess`
**File:** [index.js:533-620](index.js#L533-L620)

```
User clicks "Reprocess" on failed translation
    ↓
POST /admin/reprocess
    ├─ id (translation_queue.id)
    └─ Uses encrypted credentials from DB
    ↓
Load translation from DB
    SELECT * FROM translation_queue WHERE id = ? AND password_hash = ?
    ↓
Decrypt stored credentials
    ├─ apikey_encrypted → apikey
    ├─ base_url_encrypted → base_url
    └─ model_name_encrypted → model_name
    ↓
Detect provider from base_url
    ├─ openai.com → OpenAI
    ├─ generativelanguage.googleapis.com → Google Gemini
    ├─ openrouter.ai → OpenRouter
    ├─ groq.com → Groq
    ├─ together.xyz → Together AI
    └─ default → Google Translate
    ↓
Update status & retry count
    ├─ status = 'processing'
    └─ retry_attempts++
    ↓
Push directly to translationQueue
    (Skips downloadQueue)
```

### 3. Reprocess with New Credentials
**Route:** `POST /admin/reprocess-with-credentials`
**File:** [index.js:622-686](index.js#L622-L686)

```
User clicks "Reprocess" with modal form
    ↓
POST /admin/reprocess-with-credentials
    ├─ id (translation_queue.id)
    ├─ language (optional new target)
    ├─ provider (new provider)
    ├─ apikey (new credentials)
    ├─ base_url
    └─ model_name
    ↓
Load translation from DB
    SELECT * FROM translation_queue WHERE id = ? AND password_hash = ?
    ↓
Convert language if provided
    targetLangKey = languages.getKeyFromValue(language, provider)
    ↓
Update status & retry count
    ├─ status = 'processing'
    └─ retry_attempts++
    ↓
Push directly to translationQueue
    ├─ Uses NEW credentials (not stored)
    ├─ existingTranslationQueueId = id
    └─ saveCredentials = false
```

---

## Queue Processing Flow

### downloadQueue
**File:** [queues/downloadQueue.js](queues/downloadQueue.js)

```
downloadQueue.add('download-request', {...})
    ↓
WORKER STARTS
    ↓
[STEP 1] Create translation_queue records
    FOR EACH episode:
        ├─ Check if already exists (processing/completed)
        ├─ Create message subtitle (placeholder)
        ├─ Add to subtitles table
        └─ addToTranslationQueue(...)
            INSERT INTO translation_queue
            ├─ series_imdbid
            ├─ series_seasonno
            ├─ series_episodeno
            ├─ langcode (PT-BR)
            ├─ password_hash
            ├─ status = 'pending'
            └─ token_usage_total = 0
    ↓
[STEP 2] Process each episode one by one
    FOR EACH episode:
        ├─ Fetch subtitles from OpenSubtitles
        │   opensubtitles.getsubtitles(type, imdbid, season, episode, targetLanguage)
        ├─ If no subs found → skip
        ├─ Find existing translation_queue.id
        └─ Push to translationQueue
            translationQueue.push({
                subs: [subs[0]],
                imdbid,
                season,
                episode,
                oldisocode: targetLanguage (PT-BR),
                provider,
                apikey,
                base_url,
                model_name,
                password_hash,
                saveCredentials: false,
                existingTranslationQueueId
            })
        ├─ Wait 1 second between episodes
        └─ Update progress
```

### translationQueue
**File:** [queues/translationQueue.js](queues/translationQueue.js)

```
translationQueue.push({...})
    ↓
WORKER STARTS (attempts: 1, no retry)
    ↓
[STEP 1/4] Download subtitle from OpenSubtitles
    opensubtitles.downloadSubtitles(subs, imdbid, season, episode, oldisocode)
    → Downloads .srt file to temp location
    ↓
[STEP 2/4] Parse SRT file
    Read file content
    Parse into arrays:
        ├─ subcounts[] (1, 2, 3, ...)
        ├─ timecodes[] (00:00:01,000 --> 00:00:03,500)
        └─ texts[] (subtitle text content)
    ↓
Check if supports Document Translation
    supportsDocumentTranslation(provider)
    → Returns true if provider === 'DeepL'
    ↓
┌─────────────────────────────────────────────────────────────┐
│ IF SUPPORTS DOCUMENT TRANSLATION (DeepL only)               │
└─────────────────────────────────────────────────────────────┘
    ↓
    TRY:
        ├─ Call translateSRTDocument(originalSRT, oldisocode, provider, apikey)
        │   ↓
        │   translateProvider.translateSRTDocument()
        │       ↓
        │       translateWithDeepLDocument(srtContent, targetLang, apiKey)
        │           ├─ Create FormData with SRT file
        │           ├─ POST to https://api.deepl.com/v2/document
        │           │   ├─ file: Buffer(srtContent)
        │           │   └─ target_lang: PT-BR
        │           ├─ Get document_id & document_key
        │           ├─ Poll status (max 60 attempts, 1s interval)
        │           │   POST /v2/document/{document_id}
        │           │   Check status: queued → translating → done
        │           └─ Download result
        │               POST /v2/document/{document_id}/result
        │               → Returns translated SRT content
        │   ↓
        ├─ Save translated SRT to file
        │   {original}-translated.srt
        ├─ Update translation_queue
        │   UPDATE translation_queue
        │   SET status = 'completed',
        │       token_usage_total = charCount
        │   WHERE id = translationQueueId
        └─ RETURN {success: true, method: 'document-api', characterCount}
    ↓
    CATCH (Document API failed):
        ├─ Log error message
        ├─ Log "Falling back to Text API (batch mode)"
        └─ Continue to batch flow below
    ↓
┌─────────────────────────────────────────────────────────────┐
│ BATCH MODE (Text API fallback or non-DeepL providers)      │
└─────────────────────────────────────────────────────────────┘
    ↓
[STEP 3/4] Create batch records
    ├─ Delete existing batches for this translation_queue_id
    ├─ Determine batch size
    │   ├─ ChatGPT API: 50 entries per batch
    │   └─ Others: 60 entries per batch
    ├─ Divide texts into batches
    └─ INSERT INTO subtitle_batches
        FOR EACH batch:
            ├─ translation_queue_id
            ├─ batch_number (1, 2, 3, ...)
            ├─ subtitle_entries (JSON array)
            │   [{index, counter, timecode, text}, ...]
            └─ status = 'pending'
    ↓
[STEP 4/4] Queue batch translation jobs
    FOR EACH batch:
        ├─ Get batch.id from subtitle_batches
        └─ batchQueue.add('translate-batch', {
              batchId,
              provider,
              apikey,
              base_url,
              model_name,
              targetLanguage: oldisocode (PT-BR)
          })
    → All batches queued in parallel
    ↓
[CLEANUP] Remove temporary .srt file
```

### batchQueue
**File:** [queues/batchQueue.js](queues/batchQueue.js)

```
batchQueue.add('translate-batch', {...})
    ↓
WORKER STARTS (attempts: 3, exponential backoff)
    ↓
Load batch from DB
    connection.getSubtitleBatch(batchId)
    → Returns {batch_number, subtitle_entries: [...]}
    ↓
Extract texts to translate
    textsToTranslate = subtitle_entries.map(e => e.text)
    ↓
Call translation API
    translateText(textsToTranslate, targetLanguage, provider, apikey, base_url, model_name)
    ↓
┌─────────────────────────────────────────────────────────────┐
│ translateProvider.translateText()                           │
└─────────────────────────────────────────────────────────────┘
    Uses rate limiter (Bottleneck) per provider+apikey
    ↓
    Calls translateTextWithRetry() (max 3 retries)
    ↓
    SWITCH provider:
        ├─ Google Translate
        │   Uses google-translate-api-browser
        │   Returns translated texts array
        │
        ├─ DeepL (Text API - fallback for HE/TH/VI or Document fail)
        │   FOR EACH text:
        │       POST https://api.deepl.com/v2/translate
        │       {text: [text], target_lang: PT-BR}
        │   Returns translated texts array
        │
        └─ AI Providers (ChatGPT, OpenAI, Gemini, etc)
            Creates OpenAI client
            Builds prompt:
                "Translate these {N} subtitle texts to {language}.
                 Return JSON: {texts: [{index, text}, ...]}"
            Calls chat.completions.create()
            Parses JSON response
            Returns translated texts array (sorted by index)
    ↓
    Validates result:
        ├─ Check if texts.length == resultArray.length
        ├─ If mismatch → retry
        └─ Return {translatedText, tokenUsage}
    ↓
Save translated texts to batch
    connection.saveTranslatedBatch(batchId, result.translatedText)
    UPDATE subtitle_batches
    SET translated_entries = JSON,
        status = 'completed',
        token_usage = tokenUsage
    ↓
Check if all batches completed
    connection.checkAllBatchesCompleted(translationQueueId)
    ↓
    IF all completed:
        ├─ Build final SRT file
        │   ├─ Load all batches ordered by batch_number
        │   ├─ Combine all translated_entries
        │   ├─ Reconstruct SRT format:
        │   │   counter
        │   │   timecode
        │   │   translated_text
        │   │   (blank line)
        │   └─ Save to subtitles/{providerPath}/{lang}/{imdbid}/...
        ├─ Calculate total token usage
        │   SUM(token_usage) from all batches
        └─ Update translation_queue
            UPDATE translation_queue
            SET status = 'completed',
                token_usage_total = totalTokens
    ↓
    ELSE (batches still pending):
        └─ Wait for other batch workers to complete
```

---

## Error Handling

### Document API Errors
```
DeepL Document API fails
    ├─ Language not supported (HE, TH, VI)
    ├─ Network error
    ├─ API quota exceeded
    └─ 400/500 errors
    ↓
Falls back to Batch Mode (Text API)
    → Same flow as non-DeepL providers
```

### Batch Translation Errors
```
translateText() throws error after 3 retries
    ↓
Mark batch as failed
    UPDATE subtitle_batches SET status = 'failed'
    ↓
Cancel all remaining batches
    UPDATE subtitle_batches
    SET status = 'failed'
    WHERE translation_queue_id = ? AND status IN ('pending', 'processing')
    ↓
Mark translation_queue as failed
    UPDATE translation_queue SET status = 'failed'
    ↓
Create error message subtitle
    "Translation failed: {error message}"
```

### Translation Queue Errors
```
translationQueue worker throws error
    ↓
Job fails (attempts: 1, no retry)
    ↓
Update translation_queue status to 'failed'
    ↓
User can manually reprocess from dashboard
```

---

## Data Flow Summary

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER INPUT                                │
│  Dashboard Form / Reprocess Button                              │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ├─ Add Subtitle → POST /api/download → downloadQueue
             ├─ Reprocess (stored creds) → POST /admin/reprocess → translationQueue
             └─ Reprocess (new creds) → POST /admin/reprocess-with-credentials → translationQueue
             ↓
┌────────────────────────────────────────────────────────────────────┐
│                     DOWNLOAD QUEUE                                 │
│  - Create translation_queue records (status: pending)             │
│  - Fetch subtitles from OpenSubtitles                             │
│  - Push each episode to translationQueue                          │
└────────────┬───────────────────────────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────────────────────────┐
│                   TRANSLATION QUEUE                                │
│  - Download .srt file from OpenSubtitles                          │
│  - Parse SRT (subcounts, timecodes, texts)                        │
│                                                                    │
│  IF DeepL:                                                         │
│    TRY Document API (1 request, fast)                             │
│      → Success: Save & Mark completed                             │
│      → Fail: Fall to batch mode                                   │
│                                                                    │
│  BATCH MODE:                                                       │
│    - Create subtitle_batches records                              │
│    - Push each batch to batchQueue (parallel)                     │
└────────────┬───────────────────────────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────────────────────────┐
│                      BATCH QUEUE                                   │
│  - Load batch entries from DB                                     │
│  - Call translateText() API                                       │
│  - Save translated texts to batch                                 │
│  - Check if all batches completed                                 │
│    → If yes: Build final SRT & mark completed                     │
│    → If no: Wait for other batches                                │
└────────────┬───────────────────────────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────────────────────────┐
│                       FINAL RESULT                                 │
│  - Translated .srt file saved to disk                             │
│  - translation_queue.status = 'completed'                         │
│  - translation_queue.token_usage_total updated                    │
│  - User can stream translated subtitles via Stremio               │
└────────────────────────────────────────────────────────────────────┘
```

---

## Key Database Tables

### translation_queue
```sql
- id
- series_imdbid
- series_seasonno
- series_episodeno
- langcode (PT-BR, EN-US, etc)
- password_hash (user identifier)
- status (pending, processing, completed, failed)
- token_usage_total
- retry_attempts
- apikey_encrypted (optional)
- base_url_encrypted (optional)
- model_name_encrypted (optional)
- created_at
- updated_at
```

### subtitle_batches
```sql
- id
- translation_queue_id (FK)
- batch_number
- subtitle_entries (JSON: [{index, counter, timecode, text}, ...])
- translated_entries (JSON: [{index, text}, ...])
- status (pending, processing, completed, failed)
- token_usage
- created_at
- updated_at
```

---

## Performance Optimization

### DeepL Document API (Fast Path)
- **1 request** for entire subtitle file
- **No batching** overhead
- **Preserves SRT formatting** automatically
- **~5-10 seconds** for typical episode

### Batch Mode (Fallback/Other Providers)
- **10-15 requests** for typical episode (60 entries/batch)
- **Parallel processing** (all batches at once)
- **Rate limiting** per provider/apikey
- **~30-60 seconds** for typical episode

### Language Support
- **DeepL Document API**: All languages except HE, TH, VI (if those fail, fallback to batch)
- **DeepL Text API**: All supported languages
- **Other providers**: Depends on provider
