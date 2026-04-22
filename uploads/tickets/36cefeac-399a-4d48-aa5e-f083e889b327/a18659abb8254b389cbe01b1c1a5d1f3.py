#!/usr/bin/env python3
"""
Standalone MDB/CSV Azure uploader service.

Runs continuously and uploads only .mdb and .csv files from a hardcoded local
folder to a hardcoded Azure Blob container path prefix.
"""

import logging
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from azure.core.exceptions import (
    AzureError,
    HttpResponseError,
    ServiceRequestError,
    ServiceResponseError,
)
from azure.storage.blob import BlobServiceClient

# ============================================================================
# HARD-CODED CONFIGURATION
# ============================================================================
CONNECT_STR = "DefaultEndpointsProtocol=https;AccountName=elimage;AccountKey=REPLACE_ME;EndpointSuffix=core.windows.net"
CONTAINER_NAME = "spvdataflow"
SOURCE_ROOT = r"D:\REPLACE\WITH\LOCAL\FOLDER"
AZURE_PREFIX = "MDBCSV"

ALLOWED_EXTENSIONS = {".mdb", ".csv"}
SCAN_INTERVAL_SECONDS = 12 * 60 * 60  # every 12 hours
# Lower parallelism on slow SMB / large .mdb to reduce write timeouts and throttling.
MAX_WORKERS = 2
MAX_CONCURRENCY_PER_BLOB = 1
RETRY_ATTEMPTS = 5
BASE_TIMEOUT_SECONDS = 300
MDB_CSV_TIMEOUT_SECONDS = 1800
# Seconds for TLS / connect; data transfer uses upload_blob(timeout=...).
CONNECTION_TIMEOUT_SECONDS = 600
BACKOFF_BASE_SECONDS = 2
# ============================================================================

shutdown_requested = False


def setup_logging() -> logging.Logger:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        handlers=[
            logging.FileHandler("mdb_csv_upload_service.log"),
            logging.StreamHandler(),
        ],
    )
    return logging.getLogger("mdb_csv_upload_service")


logger = setup_logging()


def handle_signal(signum, _frame):
    global shutdown_requested
    logger.info("Received shutdown signal %s", signum)
    shutdown_requested = True


def timeout_for_file(file_path: Path) -> int:
    if file_path.suffix.lower() in ALLOWED_EXTENSIONS:
        return max(BASE_TIMEOUT_SECONDS, MDB_CSV_TIMEOUT_SECONDS)
    return BASE_TIMEOUT_SECONDS


def iter_upload_candidates(root: Path):
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS:
            yield path


def build_blob_name(root: Path, file_path: Path) -> str:
    relative = file_path.relative_to(root).as_posix()
    if AZURE_PREFIX:
        return f"{AZURE_PREFIX}/{relative}"
    return relative


def ensure_container(blob_service_client: BlobServiceClient):
    container_client = blob_service_client.get_container_client(CONTAINER_NAME)
    try:
        container_client.get_container_properties()
        logger.info("Container '%s' already exists", CONTAINER_NAME)
    except Exception:
        blob_service_client.create_container(CONTAINER_NAME)
        logger.info("Container '%s' created", CONTAINER_NAME)
    return container_client


def _blob_size_if_exists(blob_client) -> int | None:
    """Return blob size in bytes, or None if the blob does not exist."""
    try:
        return blob_client.get_blob_properties().size
    except Exception:
        return None


def upload_one_file(container_client, root: Path, file_path: Path):
    blob_name = build_blob_name(root, file_path)
    blob_client = container_client.get_blob_client(blob_name)

    try:
        local_size = file_path.stat().st_size
    except OSError as exc:
        return ("failed", str(file_path), blob_name, f"Cannot stat file: {exc}")

    remote_size = _blob_size_if_exists(blob_client)
    if remote_size is not None and remote_size == local_size:
        return (
            "skipped",
            str(file_path),
            blob_name,
            f"Blob already exists (size match {local_size} bytes)",
        )
    if remote_size is not None and remote_size != local_size:
        logger.info(
            "Blob size mismatch for %s (remote=%s local=%s), overwriting",
            blob_name,
            remote_size,
            local_size,
        )

    timeout_sec = timeout_for_file(file_path)
    last_error = None

    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            with open(file_path, "rb") as f:
                blob_client.upload_blob(
                    f,
                    length=local_size,
                    overwrite=True,
                    max_concurrency=MAX_CONCURRENCY_PER_BLOB,
                    timeout=timeout_sec,
                )
            return ("uploaded", str(file_path), blob_name, f"attempt={attempt}")
        except (
            ServiceRequestError,
            ServiceResponseError,
            HttpResponseError,
            AzureError,
            OSError,
        ) as exc:
            last_error = exc
            if attempt < RETRY_ATTEMPTS:
                # Upload may have finished despite client error (timeouts, disconnects).
                rs = _blob_size_if_exists(blob_client)
                if rs is not None and rs == local_size:
                    logger.warning(
                        "Upload error but blob matches local size (%s bytes): %s | %s",
                        local_size,
                        blob_name,
                        exc,
                    )
                    return (
                        "uploaded",
                        str(file_path),
                        blob_name,
                        f"attempt={attempt} (verified after error)",
                    )
                sleep_for = BACKOFF_BASE_SECONDS**attempt
                logger.warning(
                    "Upload failed (%s/%s) for %s: %s. Retrying in %ss",
                    attempt,
                    RETRY_ATTEMPTS,
                    file_path,
                    exc,
                    sleep_for,
                )
                time.sleep(sleep_for)
                continue
            break

    return ("failed", str(file_path), blob_name, str(last_error))


def run_single_cycle():
    root = Path(SOURCE_ROOT)
    if not root.exists():
        raise FileNotFoundError(f"SOURCE_ROOT does not exist: {root}")

    logger.info("Starting upload cycle")
    logger.info("Source: %s", root)
    logger.info("Target container: %s, prefix: %s", CONTAINER_NAME, AZURE_PREFIX or "<none>")

    blob_service_client = BlobServiceClient.from_connection_string(
        CONNECT_STR,
        connection_timeout=CONNECTION_TIMEOUT_SECONDS,
    )
    container_client = ensure_container(blob_service_client)

    candidates = list(iter_upload_candidates(root))
    logger.info("Found %s candidate files (.mdb/.csv)", len(candidates))

    if not candidates:
        logger.info("No files to process in this cycle")
        return {"uploaded": 0, "skipped": 0, "failed": 0, "total": 0}

    uploaded = 0
    skipped = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_map = {
            executor.submit(upload_one_file, container_client, root, file_path): file_path
            for file_path in candidates
        }

        total = len(future_map)
        completed = 0
        for future in as_completed(future_map):
            completed += 1
            status, src_path, blob_name, message = future.result()
            if status == "uploaded":
                uploaded += 1
                logger.info("UPLOADED | %s -> %s | %s", src_path, blob_name, message)
            elif status == "skipped":
                skipped += 1
                logger.info("SKIPPED  | %s -> %s | %s", src_path, blob_name, message)
            else:
                failed += 1
                logger.error("FAILED   | %s -> %s | %s", src_path, blob_name, message)

            if completed % 50 == 0 or completed == total:
                logger.info(
                    "Progress %s/%s | uploaded=%s skipped=%s failed=%s",
                    completed,
                    total,
                    uploaded,
                    skipped,
                    failed,
                )

    logger.info(
        "Cycle finished | total=%s uploaded=%s skipped=%s failed=%s",
        len(candidates),
        uploaded,
        skipped,
        failed,
    )
    return {"uploaded": uploaded, "skipped": skipped, "failed": failed, "total": len(candidates)}


def run_service():
    logger.info("MDB/CSV Azure upload service started")
    logger.info("Scan interval: %s seconds", SCAN_INTERVAL_SECONDS)
    logger.info("Press Ctrl+C to stop")

    while not shutdown_requested:
        cycle_start = time.time()
        try:
            run_single_cycle()
        except Exception as exc:
            logger.exception("Cycle failed with unexpected error: %s", exc)

        elapsed = int(time.time() - cycle_start)
        sleep_remaining = max(5, SCAN_INTERVAL_SECONDS - elapsed)
        logger.info("Next cycle in %s seconds", sleep_remaining)

        for _ in range(sleep_remaining):
            if shutdown_requested:
                break
            time.sleep(1)

    logger.info("MDB/CSV Azure upload service stopped")


def main():
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    command = sys.argv[1].lower() if len(sys.argv) > 1 else "start"
    if command == "once":
        result = run_single_cycle()
        logger.info("Single cycle result: %s", result)
        return
    if command == "start":
        run_service()
        return

    print("Usage:")
    print("  python mdb_csv_upload_service.py start   # Run continuously (service mode)")
    print("  python mdb_csv_upload_service.py once    # Run single upload cycle")
    sys.exit(1)


if __name__ == "__main__":
    main()
