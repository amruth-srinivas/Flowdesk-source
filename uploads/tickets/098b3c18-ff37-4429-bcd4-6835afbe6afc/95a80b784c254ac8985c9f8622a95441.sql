-- Improve prefix-ID lookups used by /api/metadata/check-images and /check-rfid-pdfs.
-- Run in production during low traffic. CONCURRENTLY avoids long write locks.

-- 1) Prefix LIKE optimization for queries such as file_name LIKE 'A50347B%.jpg'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_elimages_file_name_pattern
ON metadata.elimages (file_name text_pattern_ops);

-- 2) Optional extension-focused partial indexes to reduce scanned index size.
-- These help when queries always target a known extension.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_elimages_file_name_jpg_pattern
ON metadata.elimages (file_name text_pattern_ops)
WHERE lower(file_name) LIKE '%.jpg';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_elimages_file_name_pdf_pattern
ON metadata.elimages (file_name text_pattern_ops)
WHERE lower(file_name) LIKE '%.pdf';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_elimages_file_name_ivc_pattern
ON metadata.elimages (file_name text_pattern_ops)
WHERE lower(file_name) LIKE '%.ivc';

