-- Table creation for MySQL
-- Run this file after database creation

CREATE TABLE IF NOT EXISTS migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_migrations_name (name)
);

CREATE TABLE IF NOT EXISTS series (
    id INT AUTO_INCREMENT PRIMARY KEY,
    series_imdbid VARCHAR(255) NOT NULL,
    series_type INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_series_imdbid (series_imdbid)
);

CREATE TABLE IF NOT EXISTS subtitle (
    id INT AUTO_INCREMENT PRIMARY KEY,
    series_imdbid VARCHAR(255) NOT NULL,
    subtitle_type INT NOT NULL,
    subtitle_seasonno INT NULL,
    subtitle_episodeno INT NULL,
    subtitle_langcode VARCHAR(10) NOT NULL,
    subtitle_path TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_subtitle_imdbid (series_imdbid),
    INDEX idx_subtitle_season_episode (subtitle_seasonno, subtitle_episodeno),
    INDEX idx_subtitle_langcode (subtitle_langcode)
);

CREATE TABLE IF NOT EXISTS translation_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    series_imdbid VARCHAR(255) NOT NULL,
    series_seasonno INT NULL,
    series_episodeno INT NULL,
    subcount INT NOT NULL,
    langcode VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'processing',
    password_hash VARCHAR(255) NULL,
    apikey_encrypted TEXT NULL,
    base_url_encrypted TEXT NULL,
    model_name_encrypted TEXT NULL,
    series_name VARCHAR(500) NULL,
    retry_attempts INT DEFAULT 0,
    token_usage_total INT DEFAULT 0,
    last_retry_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_translation_queue_imdbid (series_imdbid),
    INDEX idx_translation_queue_season_episode (series_seasonno, series_episodeno),
    INDEX idx_translation_queue_langcode (langcode),
    INDEX idx_translation_queue_status (status),
    INDEX idx_translation_queue_password (password_hash)
);

-- Commands for management

-- Clear translation queue
DELETE FROM translation_queue;

-- Delete subtitles
DELETE FROM subtitle;

-- Show table statistics
SELECT 
    'series' as table_name, COUNT(*) as records 
FROM series 
UNION ALL 
SELECT 
    'subtitle' as table_name, COUNT(*) as records 
FROM subtitle 
UNION ALL 
SELECT 
    'translation_queue' as table_name, COUNT(*) as records 
FROM translation_queue; 