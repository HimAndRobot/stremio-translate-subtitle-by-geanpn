const DatabaseFactory = require('./database/DatabaseFactory');

let dbAdapter = null;

// Initialize database connection
async function initializeDatabase() {
    if (!dbAdapter) {
        try {
            dbAdapter = await DatabaseFactory.createAndConnect();
            console.log('Database initialized successfully!');
        } catch (error) {
            console.error('Database initialization error:', error);
            throw error;
        }
    }
    return dbAdapter;
}

// Get adapter instance
async function getAdapter() {
    if (!dbAdapter) {
        await initializeDatabase();
    }
    return dbAdapter;
}

// Utility methods for backward API compatibility
async function addToTranslationQueue(imdbid, season = null, episode = null, count, langcode, password_hash = null, apikey_encrypted = null, base_url_encrypted = null, model_name_encrypted = null, series_name = null, poster = null, stremioId = null, subtitle_path = null, type = null, status = 'processing') {
    const adapter = await getAdapter();
    return adapter.addToTranslationQueue(imdbid, season, episode, count, langcode, password_hash, apikey_encrypted, base_url_encrypted, model_name_encrypted, series_name, poster, stremioId, subtitle_path, type, status);
}

async function deletetranslationQueue(imdbid, season = null, episode = null, langcode) {
    const adapter = await getAdapter();
    return adapter.deletetranslationQueue(imdbid, season, episode, langcode);
}

async function checkForTranslation(imdbid, season = null, episode = null, password_hash = null) {
    const adapter = await getAdapter();
    return adapter.checkForTranslation(imdbid, season, episode, password_hash);
}

async function checkAndLockForTranslation(imdbid, season = null, episode = null, password_hash = null) {
    const adapter = await getAdapter();
    return adapter.checkAndLockForTranslation(imdbid, season, episode, password_hash);
}

async function checkForTranslationByStremioId(stremioId, password_hash = null) {
    const adapter = await getAdapter();
    return adapter.checkForTranslationByStremioId(stremioId, password_hash);
}

async function updateTranslationStatus(imdbid, season = null, episode = null, langcode, status) {
    const adapter = await getAdapter();
    return adapter.updateTranslationStatus(imdbid, season, episode, langcode, status);
}

async function updateTranslationCredentials(imdbid, season = null, episode = null, langcode, password_hash, apikey_encrypted, base_url_encrypted, model_name_encrypted) {
    const adapter = await getAdapter();
    return adapter.updateTranslationCredentials(imdbid, season, episode, langcode, password_hash, apikey_encrypted, base_url_encrypted, model_name_encrypted);
}

async function updateTokenUsage(imdbid, season = null, episode = null, langcode, tokens) {
    const adapter = await getAdapter();
    return adapter.updateTokenUsage(imdbid, season, episode, langcode, tokens);
}

async function checkseries(imdbid) {
    const adapter = await getAdapter();
    return adapter.checkseries(imdbid);
}

async function addseries(imdbid, type) {
    const adapter = await getAdapter();
    return adapter.addseries(imdbid, type);
}

async function getSubCount(imdbid, season, episode, langcode) {
    const adapter = await getAdapter();
    return adapter.getSubCount(imdbid, season, episode, langcode);
}

async function addsubtitle(imdbid, type, season = null, episode = null, path, langcode) {
    const adapter = await getAdapter();
    return adapter.addsubtitle(imdbid, type, season, episode, path, langcode);
}

async function getsubtitles(imdbid, season = null, episode = null, langcode) {
    const adapter = await getAdapter();
    return adapter.getsubtitles(imdbid, season, episode, langcode);
}

async function checksubtitle(imdbid, season = null, episode = null, subtitlepath, langcode) {
    const adapter = await getAdapter();
    return adapter.checksubtitle(imdbid, season, episode, subtitlepath, langcode);
}

async function createSubtitleBatches(translationQueueId, batches) {
    const adapter = await getAdapter();
    return adapter.createSubtitleBatches(translationQueueId, batches);
}

async function getSubtitleBatch(batchId) {
    const adapter = await getAdapter();
    return adapter.getSubtitleBatch(batchId);
}

async function updateBatchTranslation(batchId, translatedEntries, tokenUsage) {
    const adapter = await getAdapter();
    return adapter.updateBatchTranslation(batchId, translatedEntries, tokenUsage);
}

async function updateBatchStatus(batchId, status) {
    const adapter = await getAdapter();
    return adapter.updateBatchStatus(batchId, status);
}

async function getBatchesForTranslation(translationQueueId) {
    const adapter = await getAdapter();
    return adapter.getBatchesForTranslation(translationQueueId);
}

async function areAllBatchesComplete(translationQueueId) {
    const adapter = await getAdapter();
    return adapter.areAllBatchesComplete(translationQueueId);
}

async function getTranslationQueueIdFromBatch(batchId) {
    const adapter = await getAdapter();
    return adapter.getTranslationQueueIdFromBatch(batchId);
}

// Function to close the connection
async function closeConnection() {
    if (dbAdapter) {
        await dbAdapter.disconnect();
        dbAdapter = null;
    }
}

// Automatically initialize on module load
initializeDatabase().catch(console.error);

module.exports = {
    addToTranslationQueue,
    deletetranslationQueue,
    updateTranslationStatus,
    updateTranslationCredentials,
    updateTokenUsage,
    getSubCount,
    checkseries,
    addseries,
    addsubtitle,
    getsubtitles,
    checkForTranslation,
    checkAndLockForTranslation,
    checkForTranslationByStremioId,
    checksubtitle,
    closeConnection,
    getAdapter,
    createSubtitleBatches,
    getSubtitleBatch,
    updateBatchTranslation,
    updateBatchStatus,
    getBatchesForTranslation,
    areAllBatchesComplete,
    getTranslationQueueIdFromBatch
};
