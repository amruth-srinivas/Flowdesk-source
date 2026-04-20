from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Dict, Any, Optional, Set, Iterator
from datetime import datetime
import requests
import io
import os
from urllib.parse import urlparse, urlunparse
from ..db.session import get_db
from ..models.metadata import ElImage  # Adjust import path as needed
from minio import Minio
from minio.error import S3Error

router = APIRouter(prefix="/api/metadata", tags=["Metadata"])

# Keep OR/LIKE query sizes bounded for large Excel uploads.
ID_QUERY_CHUNK_SIZE = int(os.getenv("METADATA_ID_QUERY_CHUNK_SIZE", "100"))
DEFAULT_BULK_RECORD_LIMIT = int(os.getenv("METADATA_BULK_DEFAULT_LIMIT", "1500"))
MAX_BULK_RECORD_LIMIT = int(os.getenv("METADATA_BULK_MAX_LIMIT", "2000"))


def chunked(values: List[str], size: int) -> Iterator[List[str]]:
    if size <= 0:
        size = 100
    for i in range(0, len(values), size):
        yield values[i:i + size]

# Normalize MinIO URLs stored in DB to use container-reachable endpoint
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "10.10.12.73:9000")
MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
BUCKET_NAME = "filecenter"

# Initialize MinIO client
try:
    minio_client = Minio(
        endpoint=MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=MINIO_SECURE
    )
except Exception as e:
    print(f"[WARNING] Failed to initialize MinIO client: {e}")
    minio_client = None

def rewrite_minio_url_if_needed(url: Optional[str]) -> Optional[str]:
    if not url or not url.startswith("http"):
        return url
    try:
        parsed = urlparse(url)
        # If it already points to the configured endpoint, keep it
        if parsed.netloc == MINIO_ENDPOINT:
            return url
        # If this looks like a MinIO path (contains filecenter bucket), rewrite host
        if "/filecenter/" in parsed.path:
            scheme = "https" if MINIO_SECURE else "http"
            new_parsed = parsed._replace(scheme=scheme, netloc=MINIO_ENDPOINT)
            return urlunparse(new_parsed)
        # If URL already has a valid hostname/IP, use it as-is
        if parsed.netloc and ('.' in parsed.netloc or ':' in parsed.netloc):
            return url
    except Exception as e:
        print(f"[WARNING] Error rewriting URL {url}: {e}")
        return url
    return url

def extract_minio_object_path(minio_path: str) -> Optional[str]:
    """
    Extract object path from MinIO URL or path.
    
    Examples:
    - http://host:9000/filecenter/EL-images/file.jpg -> EL-images/file.jpg
    - /filecenter/EL-images/file.jpg -> EL-images/file.jpg
    - filecenter/EL-images/file.jpg -> EL-images/file.jpg
    - EL-images/file.jpg -> EL-images/file.jpg
    """
    if not minio_path:
        return None
    
    # Remove http:// or https:// prefix
    if minio_path.startswith(('http://', 'https://')):
        parsed = urlparse(minio_path)
        path = parsed.path
    else:
        path = minio_path
    
    # Remove leading /
    if path.startswith('/'):
        path = path[1:]
    
    # Remove bucket name prefix if present
    if path.startswith(f"{BUCKET_NAME}/"):
        path = path[len(f"{BUCKET_NAME}/"):]
    
    return path if path else None

def get_file_path_for_fetching(file_record, file_id: str) -> Dict[str, Optional[str]]:
    """
    Determine the correct file path for fetching based on file_id suffix and storage availability.
    
    Rules:
    1. If file_id ends with '_A', it's Azure-only → use azure_path
    2. If file_id ends with '_L', prefer minio_path
    3. If minio_path exists and is a full URL → use it (after rewrite if needed)
    4. If minio_path is relative/invalid but azure_path exists → prefer azure_path
    5. If no minio_path but azure_path exists → use azure_path
    6. Otherwise construct MinIO URL from relative path if possible
    
    Args:
        file_record: ElImage record from database
        file_id: The file_id being requested (may contain suffix like _A or _L)
        
    Returns:
        Dict with 'type' ('minio' or 'azure') and 'path' (object path for MinIO, URL for Azure)
    """
    # Check if file_id indicates storage preference
    if file_id.endswith('_A'):
        # Azure-only file
        if file_record.azure_path:
            return {'type': 'azure', 'path': file_record.azure_path}
        return {'type': None, 'path': None}
    
    if file_id.endswith('_L'):
        # Local file preferred
        if file_record.minio_path:
            object_path = extract_minio_object_path(file_record.minio_path)
            if object_path:
                return {'type': 'minio', 'path': object_path}
        return {'type': None, 'path': None}
    
    # Default logic: prefer minio_path if available
    if file_record.minio_path:
        object_path = extract_minio_object_path(file_record.minio_path)
        if object_path:
            return {'type': 'minio', 'path': object_path}
        # If minio_path is invalid but azure_path exists, use azure
        if file_record.azure_path:
            return {'type': 'azure', 'path': file_record.azure_path}
    
    # No minio_path, use azure_path if available
    if file_record.azure_path:
        return {'type': 'azure', 'path': file_record.azure_path}
    
    return {'type': None, 'path': None}

def extract_machine_from_path(path: Optional[str]) -> Optional[str]:
    """
    Extract machine segment from a storage path.

    Example path:
    http://localhost:9000/filecenter/EL-images/Jinchen_aftertrim_Vega_bad/2025/10/13/NG/A50382B_Z_131025_114511.jpg
    → returns "Jinchen_aftertrim_Vega_bad"

    Strategy: split by "/", locate the first 4-digit year segment, and take the
    immediate previous segment as the machine name.
    """
    if not path:
        return None
    try:
        segments = path.split('/')
        for idx, seg in enumerate(segments):
            if len(seg) == 4 and seg.isdigit():
                if idx - 1 >= 0:
                    return segments[idx - 1]
                break
    except Exception:
        return None
    return None

def get_storage_path(record):
    """
    Get the preferred storage path with priority: minio_path first, then azure_path.
    Returns only minio_path if it exists, otherwise returns azure_path.
    
    Args:
        record: ElImage record
        
    Returns:
        storage_path: The preferred path (minio_path if exists, otherwise azure_path)
    """
    # Return minio_path if it exists, otherwise return azure_path
    return record.minio_path if record.minio_path else record.azure_path

def build_file_record(record, include_presigned_url: bool = True):
    """
    Build a file record dictionary with priority on minio_path.
    Returns records with minio_path (local) or azure_path (cloud).
    Appends suffix to the ID based on storage type: 'L' for minio_path, 'A' for azure_path.
    Includes cloud_only flag when only azure_path exists (no local path).
    For MinIO files, optionally generates presigned URLs for downloads.
    
    Args:
        record: ElImage record
        include_presigned_url: whether to generate presigned URL for MinIO path
        
    Returns:
        dict: File record with storage_path and paths, or None if neither path exists
    """
    # Determine the base ID (without extension)
    base_id = record.file_name.rsplit('.', 1)[0] if '.' in record.file_name else record.file_name
    
    # Check if we have minio_path or only azure_path
    if record.minio_path:
        # Local storage - append 'L'
        suffix = 'L'
        
        # Generate presigned URL for MinIO files (valid for 1 hour).
        # Bulk endpoints can disable this for better performance.
        download_url = None
        if include_presigned_url:
            try:
                if minio_client:
                    object_path = extract_minio_object_path(record.minio_path)
                    if object_path:
                        from datetime import timedelta
                        download_url = minio_client.presigned_get_object(
                            BUCKET_NAME, 
                            object_path,
                            expires=timedelta(hours=1)
                        )
            except Exception as e:
                print(f"[WARNING] Failed to generate presigned URL: {e}")
                download_url = None
        
        # Use presigned URL if available, otherwise keep original minio_path
        # Frontend should use download endpoint if presigned URL fails
        storage_path = download_url if download_url else record.minio_path
        
        return {
            "file_name": record.file_name,
            "file_id": f"{base_id}_{suffix}",
            "storage_path": storage_path,
            "minio_path": record.minio_path,
            "azure_path": record.azure_path,  # Include azure_path if available
            "created_at": record.created_at,
            "storage_type": "local",
            "cloud_only": False,
            "machine": extract_machine_from_path(record.minio_path)
        }
    elif record.azure_path:
        # Azure storage only (cloud only) - append 'A'
        suffix = 'A'
        storage_path = record.azure_path
        return {
            "file_name": record.file_name,
            "file_id": f"{base_id}_{suffix}",
            "storage_path": storage_path,
            "azure_path": record.azure_path,
            "created_at": record.created_at,
            "storage_type": "azure",
            "cloud_only": True,  # Flag indicating file exists only in cloud (no local path)
            "machine": extract_machine_from_path(storage_path)
        }
    else:
        return None

def extract_image_type_from_filename(filename: str) -> Optional[str]:
    """
    Extract image type token from filename.
    
    Supported patterns include (examples):
    - A50340B_Z_240925_162405.jpg
    - A89766B_JIN_Z_240925_162405.jpg
    
    The type is identified by finding a single-letter token that is surrounded by
    underscores in the original filename (i.e. one of the underscore-separated
    parts equals A/B/Z/T).
    
    Token mapping:
    - _A_ -> post (after assembly)
    - _B_ -> pre (before assembly)
    - _Z_ -> bad (defective)
    - _T_ -> trim (after trim / before frame)
    
    Args:
        filename: The file name (e.g., "A50340B_Z_240925_162405.jpg")
        
    Returns:
        Type string: 'post', 'pre', 'bad', or None if can't determine
    """
    # Remove extension
    name_without_ext = filename.rsplit('.', 1)[0]
    
    # Split by underscore to get parts
    parts = name_without_ext.split('_')
    
    if len(parts) < 2:
        return None  # Invalid filename format
    
    # Map token to type
    type_mapping = {
        'A': 'post',
        'B': 'pre',
        'Z': 'bad',
        'T': 'trim',
    }
    
    # Find the first single-letter token (A/B/Z/T) among underscore-separated parts.
    # This supports filenames like: A89766B_JIN_Z_240925_162405.jpg
    token = next(
        (p.upper() for p in parts if len(p) == 1 and p.upper() in type_mapping),
        None,
    )
    
    return type_mapping.get(token)

def normalize_image_filter(filter_value: str) -> Optional[str]:
    """
    Normalize filter values for image type filtering.

    Supports both single-letter tokens (a/b/t/z) and words (post/pre/trim/bad).
    Returns the canonical type string or None if the filter is not a type filter.
    """
    v = (filter_value or "").strip().lower()
    mapping = {
        # Words
        "pre": "pre",
        "post": "post",
        "bad": "bad",
        "trim": "trim",
        # Letters (as used in filenames)
        "a": "post",
        "b": "pre",
        "z": "bad",
        "t": "trim",
    }
    return mapping.get(v)

@router.post("/check-images")
def check_image_ids(
    ids: List[str],
    filter: Optional[str] = Query(None, description="Optional filter keyword to search in minio/azure paths"),
    machine: Optional[str] = Query(None, description="Optional machine name filter"),
    offset: int = Query(0, ge=0, description="Pagination offset for returned records"),
    limit: Optional[int] = Query(None, ge=1, description="Pagination limit for returned records"),
    include_all_records: bool = Query(False, description="If true, return all matching records (may be slow)"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Check if given image IDs exist in metadata.elimages table.
    
    - Matches file_name like 'A50347B_A_240925_162409%.jpg'
    - If 'filter' is 'pre', 'post', or 'bad', filters by filename suffix (e.g., _A, _B, _Z)
    - Other filter values use path-based filtering (case-insensitive)
    - If 'machine' is provided, returns only records for the specified machine.
    """
    if not ids:
        raise HTTPException(status_code=400, detail="No IDs provided")

    requested_ids = [img_id.strip() for img_id in ids if img_id and img_id.strip()]
    if not requested_ids:
        raise HTTPException(status_code=400, detail="No valid IDs provided")

    requested_set: Set[str] = set(requested_ids)
    existing_images = []
    seen_row_ids: Set[int] = set()

    # Query in chunks to avoid very large OR trees for 1k+ IDs.
    for ids_chunk in chunked(requested_ids, ID_QUERY_CHUNK_SIZE):
        filters = [ElImage.file_name.like(f"{img_id}%.jpg") for img_id in ids_chunk]
        chunk_rows = db.query(ElImage).filter(or_(*filters)).all()
        for row in chunk_rows:
            if row.id in seen_row_ids:
                continue
            seen_row_ids.add(row.id)
            existing_images.append(row)

    effective_limit = min(limit or DEFAULT_BULK_RECORD_LIMIT, MAX_BULK_RECORD_LIMIT)
    available = []
    available_ids = set()
    matched_excel_ids: Set[str] = set()  # Track which Excel IDs were actually matched
    total_matching_records = 0

    for image in existing_images:
        base_id = image.file_name.rsplit('.', 1)[0] if '.' in image.file_name else image.file_name

        # Extract image type from filename
        image_type = extract_image_type_from_filename(image.file_name)

        # If filter is provided, check image type from filename
        if filter:
            filter_lower = filter.lower()
            
            # For type filters (pre/post/trim/bad OR b/a/t/z), check filename token
            normalized_type_filter = normalize_image_filter(filter_lower)
            if normalized_type_filter:
                if image_type != normalized_type_filter:
                    continue  # Skip record if type doesn't match
            else:
                # Fallback to path-based filtering for other filters
                minio_match = image.minio_path and filter_lower in image.minio_path.lower()
                azure_match = image.azure_path and filter_lower in image.azure_path.lower()
                if not (minio_match or azure_match):
                    continue  # Skip record if filter not found

        # If machine filter is provided, check if the path contains the machine name
        if machine:
            machine_lower = machine.lower()
            minio_match = image.minio_path and machine_lower in image.minio_path.lower()
            azure_match = image.azure_path and machine_lower in image.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if machine not found

        # Fast path for most filenames: first token before "_" is the requested module ID.
        base_prefix = base_id.split("_", 1)[0]
        if base_prefix in requested_set:
            matched_excel_ids.add(base_prefix)
        else:
            # Preserve old permissive matching behavior for non-standard filenames.
            for excel_id in requested_ids:
                if base_id.startswith(excel_id) or excel_id in base_id:
                    matched_excel_ids.add(excel_id)

        # Use build_file_record which returns records with storage path
        file_record = build_file_record(image, include_presigned_url=False)
        if file_record:
            total_matching_records += 1
            if include_all_records or (offset <= (total_matching_records - 1) < (offset + effective_limit)):
                available.append(file_record)
            # Add the base_id (without suffix) to available_ids for comparison with Excel IDs
            available_ids.add(base_id)

    # Compute missing IDs based on which Excel IDs were matched
    missing_ids = [img_id for img_id in requested_ids if img_id not in matched_excel_ids]

    has_more = False if include_all_records else (offset + len(available) < total_matching_records)

    return {
        "requested_count": len(requested_ids),
        "available_count": len(matched_excel_ids),  # Count of matched Excel IDs
        "missing_count": len(missing_ids),
        "filter_applied": filter or None,
        "offset": 0 if include_all_records else offset,
        "limit": total_matching_records if include_all_records else effective_limit,
        "returned_records": len(available),
        "total_records": total_matching_records,
        "has_more": has_more,
        "records_truncated": not include_all_records and has_more,
        "available_ids": list(available_ids),
        "missing_ids": missing_ids,
        "records": available
    }

# Single ID endpoints for frontend single search functionality

@router.get("/get-image/{image_id}")
def get_single_image(
    image_id: str,
    filter: Optional[str] = Query(None, description="Optional filter keyword to search in minio/azure paths"),
    machine: Optional[str] = Query(None, description="Optional machine name filter"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get a single image by ID from metadata.elimages table.
    
    - Matches file_name like 'A50347B_A_240925_162409%.jpg'
    - Returns local paths first, falls back to Azure paths if no local paths exist
    - Returns error if neither local nor Azure paths are found
    - If 'filter' is 'pre', 'post', or 'bad', filters by filename suffix (e.g., _A, _B, _Z)
    - Other filter values use path-based filtering (case-insensitive)
    - If 'machine' is provided, returns only records for the specified machine.
    """
    # Build file_name filter for the ID
    existing_images = db.query(ElImage).filter(ElImage.file_name.like(f"{image_id}%.jpg")).all()

    local_records = []
    azure_records = []
    available_ids = set()

    for image in existing_images:
        base_id = image.file_name.split(".")[0]

        # Extract image type from filename
        image_type = extract_image_type_from_filename(image.file_name)

        # If filter is provided, check image type from filename
        if filter:
            filter_lower = filter.lower()
            
            # For type filters (pre/post/trim/bad OR b/a/t/z), check filename token
            normalized_type_filter = normalize_image_filter(filter_lower)
            if normalized_type_filter:
                if image_type != normalized_type_filter:
                    continue  # Skip record if type doesn't match
            else:
                # Fallback to path-based filtering for other filters
                minio_match = image.minio_path and filter_lower in image.minio_path.lower()
                azure_match = image.azure_path and filter_lower in image.azure_path.lower()
                if not (minio_match or azure_match):
                    continue  # Skip record if filter not found

        # If machine filter is provided, check if the path contains the machine name
        if machine:
            machine_lower = machine.lower()
            minio_match = image.minio_path and machine_lower in image.minio_path.lower()
            azure_match = image.azure_path and machine_lower in image.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if machine not found

        # Build record
        file_record = build_file_record(image)
        if file_record:
            if file_record["storage_type"] == "local":
                local_records.append(file_record)
                available_ids.add(base_id)
            else:  # azure (cloud only)
                azure_records.append(file_record)
                available_ids.add(base_id)  # Include cloud-only records in count
    
    # Determine which records to return - local priority, fallback to azure (cloud only)
    if local_records:
        available = local_records
    elif azure_records:
        available = azure_records  # Return cloud-only records if no local paths found
    else:
        raise HTTPException(
            status_code=404, 
            detail=f"No records found for image ID '{image_id}' in either local or Azure storage"
        )

    return {
        "requested_id": image_id,
        "available_count": len(available_ids),
        "filter_applied": filter or None,
        "available_ids": list(available_ids),
        "records": available
    }

# File serving endpoint for viewing files in browser

@router.get("/view-file/{file_id}")
def view_file(
    file_id: str,
    file_type: str = Query(..., description="File type: image, rfid, or ivc"),
    db: Session = Depends(get_db)
):
    """
    Serve file content for viewing in browser.
    Supports images (JPG), PDFs, and IVC files.
    """
    try:
        # Determine file extension based on type
        extensions = {
            'image': ['jpg', 'jpeg'],
            'rfid': ['pdf'], 
            'ivc': ['ivc']
        }
        
        if file_type not in extensions:
            raise HTTPException(status_code=400, detail="Invalid file type. Use: image, rfid, or ivc")
        
        # Try exact match first, then pattern matching as fallback
        file_record = None
        for ext in extensions[file_type]:
            # First try exact match with the file_id as provided
            exact_filename = f"{file_id}.{ext}"
            file_record = db.query(ElImage).filter(
                ElImage.file_name == exact_filename
            ).first()
            if file_record:
                break
            
            # If exact match fails, try pattern matching as fallback
            patterns = [
                f"{file_id}%.{ext}",
                f"{file_id}_%.{ext}"
            ]
            
            for pattern in patterns:
                file_record = db.query(ElImage).filter(
                    ElImage.file_name.like(pattern)
                ).first()
                if file_record:
                    break
            
            if file_record:
                break
        
        if not file_record:
            # Debug: Let's see what files exist with similar names
            similar_files = db.query(ElImage).filter(
                ElImage.file_name.like(f"{file_id}%")
            ).limit(5).all()
            
            debug_info = {
                "requested_file_id": file_id,
                "file_type": file_type,
                "similar_files": [f.file_name for f in similar_files] if similar_files else []
            }
            
            raise HTTPException(
                status_code=404, 
                detail=f"File not found. Debug info: {debug_info}"
            )
        
        # Use helper function to determine correct file path based on file_id and storage
        file_info = get_file_path_for_fetching(file_record, file_id)
        
        # Debug logging
        print(f"[DEBUG] view_file - file_id: {file_id}")
        print(f"[DEBUG] view_file - file_record.file_name: {file_record.file_name}")
        print(f"[DEBUG] view_file - file_record.minio_path: {file_record.minio_path}")
        print(f"[DEBUG] view_file - file_record.azure_path: {file_record.azure_path}")
        print(f"[DEBUG] view_file - file_info: {file_info}")
        
        if not file_info or not file_info.get('path'):
            raise HTTPException(status_code=404, detail="File path not available (neither local nor Azure path found)")
        
        storage_type = file_info.get('type')
        file_path = file_info.get('path')
        
        # Determine content type
        content_types = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'pdf': 'application/pdf',
            'ivc': 'application/octet-stream'
        }
        
        file_ext = file_record.file_name.split('.')[-1].lower() if file_record.file_name else 'jpg'
        content_type = content_types.get(file_ext, 'application/octet-stream')
        
        # Fetch file from MinIO or Azure
        try:
            if storage_type == 'minio':
                # Use MinIO client to fetch file
                if not minio_client:
                    raise HTTPException(status_code=500, detail="MinIO client not available")
                
                try:
                    # Get object from MinIO
                    response = minio_client.get_object(BUCKET_NAME, file_path)
                    
                    # Create streaming response from MinIO
                    def generate():
                        try:
                            for chunk in response.stream(8192):
                                yield chunk
                        finally:
                            response.close()
                            response.release_conn()
                    
                    return StreamingResponse(
                        generate(),
                        media_type=content_type,
                        headers={
                            "Content-Disposition": f"inline; filename={file_record.file_name}",
                            "Cache-Control": "public, max-age=3600"
                        }
                    )
                except S3Error as e:
                    print(f"[ERROR] MinIO S3Error: {e}")
                    raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")
                except Exception as e:
                    print(f"[ERROR] MinIO error: {e}")
                    raise HTTPException(status_code=500, detail=f"Failed to fetch file from MinIO: {str(e)}")
            
            elif storage_type == 'azure':
                # Use HTTP request for Azure
                response = requests.get(file_path, stream=True, timeout=30)
                response.raise_for_status()
                
                # Create streaming response
                def generate():
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            yield chunk
                
                return StreamingResponse(
                    generate(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"inline; filename={file_record.file_name}",
                        "Cache-Control": "public, max-age=3600"
                    }
                )
            else:
                raise HTTPException(status_code=500, detail=f"Unknown storage type: {storage_type}")
            
        except requests.RequestException as e:
            print(f"[ERROR] Failed to fetch file from {file_path}: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to fetch file from {file_path}: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in view_file: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error serving file: {str(e)}")

@router.get("/download-file/{file_id}")
def download_file(
    file_id: str,
    file_type: str = Query(..., description="File type: image, rfid, or ivc"),
    db: Session = Depends(get_db)
):
    """
    Download file content with attachment disposition.
    Uses authenticated MinIO client for MinIO files.
    """
    # Reuse the same logic as view_file but with attachment disposition
    try:
        extensions = {
            'image': ['jpg', 'jpeg'],
            'rfid': ['pdf'], 
            'ivc': ['ivc']
        }
        
        if file_type not in extensions:
            raise HTTPException(status_code=400, detail="Invalid file type. Use: image, rfid, or ivc")
        
        file_record = None
        for ext in extensions[file_type]:
            exact_filename = f"{file_id}.{ext}"
            file_record = db.query(ElImage).filter(
                ElImage.file_name == exact_filename
            ).first()
            if file_record:
                break
            
            patterns = [f"{file_id}%.{ext}", f"{file_id}_%.{ext}"]
            for pattern in patterns:
                file_record = db.query(ElImage).filter(
                    ElImage.file_name.like(pattern)
                ).first()
                if file_record:
                    break
            if file_record:
                break
        
        if not file_record:
            raise HTTPException(status_code=404, detail=f"File not found: {file_id}")
        
        file_info = get_file_path_for_fetching(file_record, file_id)
        if not file_info or not file_info.get('path'):
            raise HTTPException(status_code=404, detail="File path not available")
        
        storage_type = file_info.get('type')
        file_path = file_info.get('path')
        
        content_types = {
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
            'pdf': 'application/pdf', 'ivc': 'application/octet-stream'
        }
        file_ext = file_record.file_name.split('.')[-1].lower() if file_record.file_name else 'jpg'
        content_type = content_types.get(file_ext, 'application/octet-stream')
        
        if storage_type == 'minio':
            if not minio_client:
                raise HTTPException(status_code=500, detail="MinIO client not available")
            try:
                response = minio_client.get_object(BUCKET_NAME, file_path)
                def generate():
                    try:
                        for chunk in response.stream(8192):
                            yield chunk
                    finally:
                        response.close()
                        response.release_conn()
                return StreamingResponse(
                    generate(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"attachment; filename={file_record.file_name}",
                        "Cache-Control": "public, max-age=3600"
                    }
                )
            except S3Error as e:
                raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")
        elif storage_type == 'azure':
            response = requests.get(file_path, stream=True, timeout=30)
            response.raise_for_status()
            def generate():
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        yield chunk
            return StreamingResponse(
                generate(),
                media_type=content_type,
                headers={
                    "Content-Disposition": f"attachment; filename={file_record.file_name}",
                    "Cache-Control": "public, max-age=3600"
                }
            )
        else:
            raise HTTPException(status_code=500, detail=f"Unknown storage type: {storage_type}")
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in download_file: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error downloading file: {str(e)}")

@router.get("/get-rfid-pdf/{rfid_id}")
def get_single_rfid_pdf(
    rfid_id: str,
    filter: Optional[str] = Query(None, description="Optional filter keyword to search in minio/azure paths"),
    machine: Optional[str] = Query(None, description="Optional machine name filter"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get a single RFID PDF by ID from metadata.elimages table.
    
    - Matches file_name like 'A50347B_A_240925_162409%.pdf'
    - If 'filter' is provided, returns only records where filter appears 
      in either minio_path or azure_path (case-insensitive).
    - If 'machine' is provided, returns only records for the specified machine.
    """
    # Build file_name filter for the ID
    existing_pdfs = db.query(ElImage).filter(ElImage.file_name.like(f"{rfid_id}%.pdf")).all()

    available = []
    available_ids = set()

    for pdf in existing_pdfs:
        base_id = pdf.file_name.rsplit('.', 1)[0] if '.' in pdf.file_name else pdf.file_name

        # If filter is provided, check it in minio_path or azure_path
        if filter:
            filter_lower = filter.lower()
            minio_match = pdf.minio_path and filter_lower in pdf.minio_path.lower()
            azure_match = pdf.azure_path and filter_lower in pdf.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if filter not found

        # If machine filter is provided, check if the path contains the machine name
        if machine:
            machine_lower = machine.lower()
            minio_match = pdf.minio_path and machine_lower in pdf.minio_path.lower()
            azure_match = pdf.azure_path and machine_lower in pdf.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if machine not found

        # Use build_file_record which returns records with storage path
        file_record = build_file_record(pdf, include_presigned_url=False)
        if file_record:
            available.append(file_record)
            # Add the file_id (with suffix) to available_ids
            available_ids.add(file_record["file_id"])

    return {
        "requested_id": rfid_id,
        "available_count": len(available_ids),
        "filter_applied": filter or None,
        "available_ids": list(available_ids),
        "records": available
    }

# File serving endpoint for viewing files in browser

@router.get("/view-file/{file_id}")
def view_file(
    file_id: str,
    file_type: str = Query(..., description="File type: image, rfid, or ivc"),
    db: Session = Depends(get_db)
):
    """
    Serve file content for viewing in browser.
    Supports images (JPG), PDFs, and IVC files.
    """
    try:
        # Determine file extension based on type
        extensions = {
            'image': ['jpg', 'jpeg'],
            'rfid': ['pdf'], 
            'ivc': ['ivc']
        }
        
        if file_type not in extensions:
            raise HTTPException(status_code=400, detail="Invalid file type. Use: image, rfid, or ivc")
        
        # Try exact match first, then pattern matching as fallback
        file_record = None
        for ext in extensions[file_type]:
            # First try exact match with the file_id as provided
            exact_filename = f"{file_id}.{ext}"
            file_record = db.query(ElImage).filter(
                ElImage.file_name == exact_filename
            ).first()
            if file_record:
                break
            
            # If exact match fails, try pattern matching as fallback
            patterns = [
                f"{file_id}%.{ext}",
                f"{file_id}_%.{ext}"
            ]
            
            for pattern in patterns:
                file_record = db.query(ElImage).filter(
                    ElImage.file_name.like(pattern)
                ).first()
                if file_record:
                    break
            
            if file_record:
                break
        
        if not file_record:
            # Debug: Let's see what files exist with similar names
            similar_files = db.query(ElImage).filter(
                ElImage.file_name.like(f"{file_id}%")
            ).limit(5).all()
            
            debug_info = {
                "requested_file_id": file_id,
                "file_type": file_type,
                "similar_files": [f.file_name for f in similar_files] if similar_files else []
            }
            
            raise HTTPException(
                status_code=404, 
                detail=f"File not found. Debug info: {debug_info}"
            )
        
        # Use helper function to determine correct file path based on file_id and storage
        file_info = get_file_path_for_fetching(file_record, file_id)
        
        # Debug logging
        print(f"[DEBUG] view_file - file_id: {file_id}")
        print(f"[DEBUG] view_file - file_record.file_name: {file_record.file_name}")
        print(f"[DEBUG] view_file - file_record.minio_path: {file_record.minio_path}")
        print(f"[DEBUG] view_file - file_record.azure_path: {file_record.azure_path}")
        print(f"[DEBUG] view_file - file_info: {file_info}")
        
        if not file_info or not file_info.get('path'):
            raise HTTPException(status_code=404, detail="File path not available (neither local nor Azure path found)")
        
        storage_type = file_info.get('type')
        file_path = file_info.get('path')
        
        # Determine content type
        content_types = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'pdf': 'application/pdf',
            'ivc': 'application/octet-stream'
        }
        
        file_ext = file_record.file_name.split('.')[-1].lower() if file_record.file_name else 'jpg'
        content_type = content_types.get(file_ext, 'application/octet-stream')
        
        # Fetch file from MinIO or Azure
        try:
            if storage_type == 'minio':
                # Use MinIO client to fetch file
                if not minio_client:
                    raise HTTPException(status_code=500, detail="MinIO client not available")
                
                try:
                    # Get object from MinIO
                    response = minio_client.get_object(BUCKET_NAME, file_path)
                    
                    # Create streaming response from MinIO
                    def generate():
                        try:
                            for chunk in response.stream(8192):
                                yield chunk
                        finally:
                            response.close()
                            response.release_conn()
                    
                    return StreamingResponse(
                        generate(),
                        media_type=content_type,
                        headers={
                            "Content-Disposition": f"inline; filename={file_record.file_name}",
                            "Cache-Control": "public, max-age=3600"
                        }
                    )
                except S3Error as e:
                    print(f"[ERROR] MinIO S3Error: {e}")
                    raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")
                except Exception as e:
                    print(f"[ERROR] MinIO error: {e}")
                    raise HTTPException(status_code=500, detail=f"Failed to fetch file from MinIO: {str(e)}")
            
            elif storage_type == 'azure':
                # Use HTTP request for Azure
                response = requests.get(file_path, stream=True, timeout=30)
                response.raise_for_status()
                
                # Create streaming response
                def generate():
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            yield chunk
                
                return StreamingResponse(
                    generate(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"inline; filename={file_record.file_name}",
                        "Cache-Control": "public, max-age=3600"
                    }
                )
            else:
                raise HTTPException(status_code=500, detail=f"Unknown storage type: {storage_type}")
            
        except requests.RequestException as e:
            print(f"[ERROR] Failed to fetch file from {file_path}: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to fetch file from {file_path}: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in view_file: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error serving file: {str(e)}")

@router.get("/get-ivc-file/{ivc_id}")
def get_single_ivc_file(
    ivc_id: str,
    filter: Optional[str] = Query(None, description="Optional filter keyword to search in minio/azure paths"),
    machine: Optional[str] = Query(None, description="Optional machine name filter"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get a single IVC file by ID from metadata.elimages table.
    
    - Matches file_name like 'A50347B_A_240925_162409%.ivc'
    - If 'filter' is provided, returns only records where filter appears 
      in either minio_path or azure_path (case-insensitive).
    """
    # Build file_name filter for the ID
    existing_ivc_files = db.query(ElImage).filter(ElImage.file_name.like(f"{ivc_id}%.ivc")).all()

    available = []
    available_ids = set()

    for ivc_file in existing_ivc_files:
        base_id = ivc_file.file_name.rsplit('.', 1)[0] if '.' in ivc_file.file_name else ivc_file.file_name

        # If filter is provided, check it in minio_path or azure_path
        if filter:
            filter_lower = filter.lower()
            minio_match = ivc_file.minio_path and filter_lower in ivc_file.minio_path.lower()
            azure_match = ivc_file.azure_path and filter_lower in ivc_file.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if filter not found

        # If machine filter is provided, check if the path contains the machine name
        if machine:
            machine_lower = machine.lower()
            minio_match = ivc_file.minio_path and machine_lower in ivc_file.minio_path.lower()
            azure_match = ivc_file.azure_path and machine_lower in ivc_file.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if machine not found

        # Use build_file_record which returns records with storage path
        file_record = build_file_record(ivc_file)
        if file_record:
            available.append(file_record)
            # Add the file_id (with suffix) to available_ids
            available_ids.add(file_record["file_id"])

    return {
        "requested_id": ivc_id,
        "available_count": len(available_ids),
        "filter_applied": filter or None,
        "available_ids": list(available_ids),
        "records": available
    }

# File serving endpoint for viewing files in browser

@router.get("/view-file/{file_id}")
def view_file(
    file_id: str,
    file_type: str = Query(..., description="File type: image, rfid, or ivc"),
    db: Session = Depends(get_db)
):
    """
    Serve file content for viewing in browser.
    Supports images (JPG), PDFs, and IVC files.
    """
    try:
        # Determine file extension based on type
        extensions = {
            'image': ['jpg', 'jpeg'],
            'rfid': ['pdf'], 
            'ivc': ['ivc']
        }
        
        if file_type not in extensions:
            raise HTTPException(status_code=400, detail="Invalid file type. Use: image, rfid, or ivc")
        
        # Try exact match first, then pattern matching as fallback
        file_record = None
        for ext in extensions[file_type]:
            # First try exact match with the file_id as provided
            exact_filename = f"{file_id}.{ext}"
            file_record = db.query(ElImage).filter(
                ElImage.file_name == exact_filename
            ).first()
            if file_record:
                break
            
            # If exact match fails, try pattern matching as fallback
            patterns = [
                f"{file_id}%.{ext}",
                f"{file_id}_%.{ext}"
            ]
            
            for pattern in patterns:
                file_record = db.query(ElImage).filter(
                    ElImage.file_name.like(pattern)
                ).first()
                if file_record:
                    break
            
            if file_record:
                break
        
        if not file_record:
            # Debug: Let's see what files exist with similar names
            similar_files = db.query(ElImage).filter(
                ElImage.file_name.like(f"{file_id}%")
            ).limit(5).all()
            
            debug_info = {
                "requested_file_id": file_id,
                "file_type": file_type,
                "similar_files": [f.file_name for f in similar_files] if similar_files else []
            }
            
            raise HTTPException(
                status_code=404, 
                detail=f"File not found. Debug info: {debug_info}"
            )
        
        # Use helper function to determine correct file path based on file_id and storage
        file_info = get_file_path_for_fetching(file_record, file_id)
        
        # Debug logging
        print(f"[DEBUG] view_file - file_id: {file_id}")
        print(f"[DEBUG] view_file - file_record.file_name: {file_record.file_name}")
        print(f"[DEBUG] view_file - file_record.minio_path: {file_record.minio_path}")
        print(f"[DEBUG] view_file - file_record.azure_path: {file_record.azure_path}")
        print(f"[DEBUG] view_file - file_info: {file_info}")
        
        if not file_info or not file_info.get('path'):
            raise HTTPException(status_code=404, detail="File path not available (neither local nor Azure path found)")
        
        storage_type = file_info.get('type')
        file_path = file_info.get('path')
        
        # Determine content type
        content_types = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'pdf': 'application/pdf',
            'ivc': 'application/octet-stream'
        }
        
        file_ext = file_record.file_name.split('.')[-1].lower() if file_record.file_name else 'jpg'
        content_type = content_types.get(file_ext, 'application/octet-stream')
        
        # Fetch file from MinIO or Azure
        try:
            if storage_type == 'minio':
                # Use MinIO client to fetch file
                if not minio_client:
                    raise HTTPException(status_code=500, detail="MinIO client not available")
                
                try:
                    # Get object from MinIO
                    response = minio_client.get_object(BUCKET_NAME, file_path)
                    
                    # Create streaming response from MinIO
                    def generate():
                        try:
                            for chunk in response.stream(8192):
                                yield chunk
                        finally:
                            response.close()
                            response.release_conn()
                    
                    return StreamingResponse(
                        generate(),
                        media_type=content_type,
                        headers={
                            "Content-Disposition": f"inline; filename={file_record.file_name}",
                            "Cache-Control": "public, max-age=3600"
                        }
                    )
                except S3Error as e:
                    print(f"[ERROR] MinIO S3Error: {e}")
                    raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")
                except Exception as e:
                    print(f"[ERROR] MinIO error: {e}")
                    raise HTTPException(status_code=500, detail=f"Failed to fetch file from MinIO: {str(e)}")
            
            elif storage_type == 'azure':
                # Use HTTP request for Azure
                response = requests.get(file_path, stream=True, timeout=30)
                response.raise_for_status()
                
                # Create streaming response
                def generate():
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            yield chunk
                
                return StreamingResponse(
                    generate(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"inline; filename={file_record.file_name}",
                        "Cache-Control": "public, max-age=3600"
                    }
                )
            else:
                raise HTTPException(status_code=500, detail=f"Unknown storage type: {storage_type}")
            
        except requests.RequestException as e:
            print(f"[ERROR] Failed to fetch file from {file_path}: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to fetch file from {file_path}: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in view_file: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error serving file: {str(e)}")

@router.post("/check-rfid-pdfs")
def check_rfid_pdf_ids(
    ids: List[str],
    filter: Optional[str] = Query(None, description="Optional filter keyword to search in minio/azure paths"),
    machine: Optional[str] = Query(None, description="Optional machine name filter"),
    offset: int = Query(0, ge=0, description="Pagination offset for returned records"),
    limit: Optional[int] = Query(None, ge=1, description="Pagination limit for returned records"),
    include_all_records: bool = Query(False, description="If true, return all matching records (may be slow)"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Check if given RFID PDF IDs exist in metadata.elimages table.
    
    - Matches file_name like 'A50347B_A_240925_162409%.pdf'
    - If 'filter' is provided, returns only records where filter appears 
      in either minio_path or azure_path (case-insensitive).
    """
    if not ids:
        raise HTTPException(status_code=400, detail="No IDs provided")

    requested_ids = [rfid_id.strip() for rfid_id in ids if rfid_id and rfid_id.strip()]
    if not requested_ids:
        raise HTTPException(status_code=400, detail="No valid IDs provided")

    requested_set: Set[str] = set(requested_ids)
    existing_pdfs = []
    seen_row_ids: Set[int] = set()

    # Query in chunks to avoid very large OR trees for 1k+ IDs.
    for ids_chunk in chunked(requested_ids, ID_QUERY_CHUNK_SIZE):
        filters = [ElImage.file_name.like(f"{rfid_id}%.pdf") for rfid_id in ids_chunk]
        chunk_rows = db.query(ElImage).filter(or_(*filters)).all()
        for row in chunk_rows:
            if row.id in seen_row_ids:
                continue
            seen_row_ids.add(row.id)
            existing_pdfs.append(row)

    effective_limit = min(limit or DEFAULT_BULK_RECORD_LIMIT, MAX_BULK_RECORD_LIMIT)
    available = []
    available_ids = set()
    matched_excel_ids: Set[str] = set()
    total_matching_records = 0

    for pdf in existing_pdfs:
        # If filter is provided, check it in either path
        if filter:
            filter_lower = filter.lower()
            minio_match = pdf.minio_path and filter_lower in pdf.minio_path.lower()
            azure_match = pdf.azure_path and filter_lower in pdf.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if filter not found

        # If machine filter is provided, check if the path contains the machine name
        if machine:
            machine_lower = machine.lower()
            minio_match = pdf.minio_path and machine_lower in pdf.minio_path.lower()
            azure_match = pdf.azure_path and machine_lower in pdf.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if machine not found

        # Use build_file_record which returns records with storage_type
        file_record = build_file_record(pdf, include_presigned_url=False)
        if file_record:
            total_matching_records += 1
            if include_all_records or (offset <= (total_matching_records - 1) < (offset + effective_limit)):
                available.append(file_record)
            # Full stem without storage suffix (_L / _A); matches DB filename minus extension
            stem = file_record["file_id"].rsplit("_", 1)[0] if "_" in file_record["file_id"] else file_record["file_id"]
            available_ids.add(stem)
            stem_prefix = stem.split("_", 1)[0]
            if stem_prefix in requested_set:
                matched_excel_ids.add(stem_prefix)
            else:
                # Preserve old permissive matching behavior for non-standard filenames.
                for excel_id in requested_ids:
                    if stem.startswith(excel_id) or excel_id in stem:
                        matched_excel_ids.add(excel_id)

    # Missing = requested IDs never matched by any file stem (same idea as /check-images)
    missing_ids = [rfid_id for rfid_id in requested_ids if rfid_id not in matched_excel_ids]

    has_more = False if include_all_records else (offset + len(available) < total_matching_records)

    return {
        "requested_count": len(requested_ids),
        "available_count": len(matched_excel_ids),
        "missing_count": len(missing_ids),
        "filter_applied": filter or None,
        "offset": 0 if include_all_records else offset,
        "limit": total_matching_records if include_all_records else effective_limit,
        "returned_records": len(available),
        "total_records": total_matching_records,
        "has_more": has_more,
        "records_truncated": not include_all_records and has_more,
        "available_ids": list(available_ids),
        "missing_ids": missing_ids,
        "records": available
    }

# Single ID endpoints for frontend single search functionality

@router.get("/get-image/{image_id}")
def get_single_image(
    image_id: str,
    filter: Optional[str] = Query(None, description="Optional filter keyword to search in minio/azure paths"),
    machine: Optional[str] = Query(None, description="Optional machine name filter"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get a single image by ID from metadata.elimages table.
    
    - Matches file_name like 'A50347B_A_240925_162409%.jpg'
    - Returns local paths first, falls back to Azure paths if no local paths exist
    - Returns error if neither local nor Azure paths are found
    - If 'filter' is 'pre', 'post', or 'bad', filters by filename suffix (e.g., _A, _B, _Z)
    - Other filter values use path-based filtering (case-insensitive)
    - If 'machine' is provided, returns only records for the specified machine.
    """
    # Build file_name filter for the ID
    existing_images = db.query(ElImage).filter(ElImage.file_name.like(f"{image_id}%.jpg")).all()

    local_records = []
    azure_records = []
    available_ids = set()

    for image in existing_images:
        base_id = image.file_name.split(".")[0]

        # Extract image type from filename
        image_type = extract_image_type_from_filename(image.file_name)

        # If filter is provided, check image type from filename
        if filter:
            filter_lower = filter.lower()
            
            # For type filters (pre/post/trim/bad OR b/a/t/z), check filename token
            normalized_type_filter = normalize_image_filter(filter_lower)
            if normalized_type_filter:
                if image_type != normalized_type_filter:
                    continue  # Skip record if type doesn't match
            else:
                # Fallback to path-based filtering for other filters
                minio_match = image.minio_path and filter_lower in image.minio_path.lower()
                azure_match = image.azure_path and filter_lower in image.azure_path.lower()
                if not (minio_match or azure_match):
                    continue  # Skip record if filter not found

        # If machine filter is provided, check if the path contains the machine name
        if machine:
            machine_lower = machine.lower()
            minio_match = image.minio_path and machine_lower in image.minio_path.lower()
            azure_match = image.azure_path and machine_lower in image.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if machine not found

        # Build record
        file_record = build_file_record(image)
        if file_record:
            if file_record["storage_type"] == "local":
                local_records.append(file_record)
                available_ids.add(base_id)
            else:  # azure (cloud only)
                azure_records.append(file_record)
                available_ids.add(base_id)  # Include cloud-only records in count
    
    # Determine which records to return - local priority, fallback to azure (cloud only)
    if local_records:
        available = local_records
    elif azure_records:
        available = azure_records  # Return cloud-only records if no local paths found
    else:
        raise HTTPException(
            status_code=404, 
            detail=f"No records found for image ID '{image_id}' in either local or Azure storage"
        )

    return {
        "requested_id": image_id,
        "available_count": len(available_ids),
        "filter_applied": filter or None,
        "available_ids": list(available_ids),
        "records": available
    }

# File serving endpoint for viewing files in browser

@router.get("/view-file/{file_id}")
def view_file(
    file_id: str,
    file_type: str = Query(..., description="File type: image, rfid, or ivc"),
    db: Session = Depends(get_db)
):
    """
    Serve file content for viewing in browser.
    Supports images (JPG), PDFs, and IVC files.
    """
    try:
        # Determine file extension based on type
        extensions = {
            'image': ['jpg', 'jpeg'],
            'rfid': ['pdf'], 
            'ivc': ['ivc']
        }
        
        if file_type not in extensions:
            raise HTTPException(status_code=400, detail="Invalid file type. Use: image, rfid, or ivc")
        
        # Try exact match first, then pattern matching as fallback
        file_record = None
        for ext in extensions[file_type]:
            # First try exact match with the file_id as provided
            exact_filename = f"{file_id}.{ext}"
            file_record = db.query(ElImage).filter(
                ElImage.file_name == exact_filename
            ).first()
            if file_record:
                break
            
            # If exact match fails, try pattern matching as fallback
            patterns = [
                f"{file_id}%.{ext}",
                f"{file_id}_%.{ext}"
            ]
            
            for pattern in patterns:
                file_record = db.query(ElImage).filter(
                    ElImage.file_name.like(pattern)
                ).first()
                if file_record:
                    break
            
            if file_record:
                break
        
        if not file_record:
            # Debug: Let's see what files exist with similar names
            similar_files = db.query(ElImage).filter(
                ElImage.file_name.like(f"{file_id}%")
            ).limit(5).all()
            
            debug_info = {
                "requested_file_id": file_id,
                "file_type": file_type,
                "similar_files": [f.file_name for f in similar_files] if similar_files else []
            }
            
            raise HTTPException(
                status_code=404, 
                detail=f"File not found. Debug info: {debug_info}"
            )
        
        # Use helper function to determine correct file path based on file_id and storage
        file_info = get_file_path_for_fetching(file_record, file_id)
        
        # Debug logging
        print(f"[DEBUG] view_file - file_id: {file_id}")
        print(f"[DEBUG] view_file - file_record.file_name: {file_record.file_name}")
        print(f"[DEBUG] view_file - file_record.minio_path: {file_record.minio_path}")
        print(f"[DEBUG] view_file - file_record.azure_path: {file_record.azure_path}")
        print(f"[DEBUG] view_file - file_info: {file_info}")
        
        if not file_info or not file_info.get('path'):
            raise HTTPException(status_code=404, detail="File path not available (neither local nor Azure path found)")
        
        storage_type = file_info.get('type')
        file_path = file_info.get('path')
        
        # Determine content type
        content_types = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'pdf': 'application/pdf',
            'ivc': 'application/octet-stream'
        }
        
        file_ext = file_record.file_name.split('.')[-1].lower() if file_record.file_name else 'jpg'
        content_type = content_types.get(file_ext, 'application/octet-stream')
        
        # Fetch file from MinIO or Azure
        try:
            if storage_type == 'minio':
                # Use MinIO client to fetch file
                if not minio_client:
                    raise HTTPException(status_code=500, detail="MinIO client not available")
                
                try:
                    # Get object from MinIO
                    response = minio_client.get_object(BUCKET_NAME, file_path)
                    
                    # Create streaming response from MinIO
                    def generate():
                        try:
                            for chunk in response.stream(8192):
                                yield chunk
                        finally:
                            response.close()
                            response.release_conn()
                    
                    return StreamingResponse(
                        generate(),
                        media_type=content_type,
                        headers={
                            "Content-Disposition": f"inline; filename={file_record.file_name}",
                            "Cache-Control": "public, max-age=3600"
                        }
                    )
                except S3Error as e:
                    print(f"[ERROR] MinIO S3Error: {e}")
                    raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")
                except Exception as e:
                    print(f"[ERROR] MinIO error: {e}")
                    raise HTTPException(status_code=500, detail=f"Failed to fetch file from MinIO: {str(e)}")
            
            elif storage_type == 'azure':
                # Use HTTP request for Azure
                response = requests.get(file_path, stream=True, timeout=30)
                response.raise_for_status()
                
                # Create streaming response
                def generate():
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            yield chunk
                
                return StreamingResponse(
                    generate(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"inline; filename={file_record.file_name}",
                        "Cache-Control": "public, max-age=3600"
                    }
                )
            else:
                raise HTTPException(status_code=500, detail=f"Unknown storage type: {storage_type}")
            
        except requests.RequestException as e:
            print(f"[ERROR] Failed to fetch file from {file_path}: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to fetch file from {file_path}: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in view_file: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error serving file: {str(e)}")

@router.get("/download-file/{file_id}")
def download_file(
    file_id: str,
    file_type: str = Query(..., description="File type: image, rfid, or ivc"),
    db: Session = Depends(get_db)
):
    """
    Download file content with attachment disposition.
    Uses authenticated MinIO client for MinIO files.
    """
    # Reuse the same logic as view_file but with attachment disposition
    try:
        extensions = {
            'image': ['jpg', 'jpeg'],
            'rfid': ['pdf'], 
            'ivc': ['ivc']
        }
        
        if file_type not in extensions:
            raise HTTPException(status_code=400, detail="Invalid file type. Use: image, rfid, or ivc")
        
        file_record = None
        for ext in extensions[file_type]:
            exact_filename = f"{file_id}.{ext}"
            file_record = db.query(ElImage).filter(
                ElImage.file_name == exact_filename
            ).first()
            if file_record:
                break
            
            patterns = [f"{file_id}%.{ext}", f"{file_id}_%.{ext}"]
            for pattern in patterns:
                file_record = db.query(ElImage).filter(
                    ElImage.file_name.like(pattern)
                ).first()
                if file_record:
                    break
            if file_record:
                break
        
        if not file_record:
            raise HTTPException(status_code=404, detail=f"File not found: {file_id}")
        
        file_info = get_file_path_for_fetching(file_record, file_id)
        if not file_info or not file_info.get('path'):
            raise HTTPException(status_code=404, detail="File path not available")
        
        storage_type = file_info.get('type')
        file_path = file_info.get('path')
        
        content_types = {
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
            'pdf': 'application/pdf', 'ivc': 'application/octet-stream'
        }
        file_ext = file_record.file_name.split('.')[-1].lower() if file_record.file_name else 'jpg'
        content_type = content_types.get(file_ext, 'application/octet-stream')
        
        if storage_type == 'minio':
            if not minio_client:
                raise HTTPException(status_code=500, detail="MinIO client not available")
            try:
                response = minio_client.get_object(BUCKET_NAME, file_path)
                def generate():
                    try:
                        for chunk in response.stream(8192):
                            yield chunk
                    finally:
                        response.close()
                        response.release_conn()
                return StreamingResponse(
                    generate(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"attachment; filename={file_record.file_name}",
                        "Cache-Control": "public, max-age=3600"
                    }
                )
            except S3Error as e:
                raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")
        elif storage_type == 'azure':
            response = requests.get(file_path, stream=True, timeout=30)
            response.raise_for_status()
            def generate():
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        yield chunk
            return StreamingResponse(
                generate(),
                media_type=content_type,
                headers={
                    "Content-Disposition": f"attachment; filename={file_record.file_name}",
                    "Cache-Control": "public, max-age=3600"
                }
            )
        else:
            raise HTTPException(status_code=500, detail=f"Unknown storage type: {storage_type}")
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in download_file: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error downloading file: {str(e)}")

@router.get("/get-rfid-pdf/{rfid_id}")
def get_single_rfid_pdf(
    rfid_id: str,
    filter: Optional[str] = Query(None, description="Optional filter keyword to search in minio/azure paths"),
    machine: Optional[str] = Query(None, description="Optional machine name filter"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get a single RFID PDF by ID from metadata.elimages table.
    
    - Matches file_name like 'A50347B_A_240925_162409%.pdf'
    - If 'filter' is provided, returns only records where filter appears 
      in either minio_path or azure_path (case-insensitive).
    - If 'machine' is provided, returns only records for the specified machine.
    """
    # Build file_name filter for the ID
    existing_pdfs = db.query(ElImage).filter(ElImage.file_name.like(f"{rfid_id}%.pdf")).all()

    available = []
    available_ids = set()

    for pdf in existing_pdfs:
        base_id = pdf.file_name.rsplit('.', 1)[0] if '.' in pdf.file_name else pdf.file_name

        # If filter is provided, check it in minio_path or azure_path
        if filter:
            filter_lower = filter.lower()
            minio_match = pdf.minio_path and filter_lower in pdf.minio_path.lower()
            azure_match = pdf.azure_path and filter_lower in pdf.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if filter not found

        # If machine filter is provided, check if the path contains the machine name
        if machine:
            machine_lower = machine.lower()
            minio_match = pdf.minio_path and machine_lower in pdf.minio_path.lower()
            azure_match = pdf.azure_path and machine_lower in pdf.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if machine not found

        # Use build_file_record which returns records with storage path
        file_record = build_file_record(pdf)
        if file_record:
            available.append(file_record)
            # Add the file_id (with suffix) to available_ids
            available_ids.add(file_record["file_id"])

    return {
        "requested_id": rfid_id,
        "available_count": len(available_ids),
        "filter_applied": filter or None,
        "available_ids": list(available_ids),
        "records": available
    }

# File serving endpoint for viewing files in browser

@router.get("/view-file/{file_id}")
def view_file(
    file_id: str,
    file_type: str = Query(..., description="File type: image, rfid, or ivc"),
    db: Session = Depends(get_db)
):
    """
    Serve file content for viewing in browser.
    Supports images (JPG), PDFs, and IVC files.
    """
    try:
        # Determine file extension based on type
        extensions = {
            'image': ['jpg', 'jpeg'],
            'rfid': ['pdf'], 
            'ivc': ['ivc']
        }
        
        if file_type not in extensions:
            raise HTTPException(status_code=400, detail="Invalid file type. Use: image, rfid, or ivc")
        
        # Try exact match first, then pattern matching as fallback
        file_record = None
        for ext in extensions[file_type]:
            # First try exact match with the file_id as provided
            exact_filename = f"{file_id}.{ext}"
            file_record = db.query(ElImage).filter(
                ElImage.file_name == exact_filename
            ).first()
            if file_record:
                break
            
            # If exact match fails, try pattern matching as fallback
            patterns = [
                f"{file_id}%.{ext}",
                f"{file_id}_%.{ext}"
            ]
            
            for pattern in patterns:
                file_record = db.query(ElImage).filter(
                    ElImage.file_name.like(pattern)
                ).first()
                if file_record:
                    break
            
            if file_record:
                break
        
        if not file_record:
            # Debug: Let's see what files exist with similar names
            similar_files = db.query(ElImage).filter(
                ElImage.file_name.like(f"{file_id}%")
            ).limit(5).all()
            
            debug_info = {
                "requested_file_id": file_id,
                "file_type": file_type,
                "similar_files": [f.file_name for f in similar_files] if similar_files else []
            }
            
            raise HTTPException(
                status_code=404, 
                detail=f"File not found. Debug info: {debug_info}"
            )
        
        # Use helper function to determine correct file path based on file_id and storage
        file_info = get_file_path_for_fetching(file_record, file_id)
        
        # Debug logging
        print(f"[DEBUG] view_file - file_id: {file_id}")
        print(f"[DEBUG] view_file - file_record.file_name: {file_record.file_name}")
        print(f"[DEBUG] view_file - file_record.minio_path: {file_record.minio_path}")
        print(f"[DEBUG] view_file - file_record.azure_path: {file_record.azure_path}")
        print(f"[DEBUG] view_file - file_info: {file_info}")
        
        if not file_info or not file_info.get('path'):
            raise HTTPException(status_code=404, detail="File path not available (neither local nor Azure path found)")
        
        storage_type = file_info.get('type')
        file_path = file_info.get('path')
        
        # Determine content type
        content_types = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'pdf': 'application/pdf',
            'ivc': 'application/octet-stream'
        }
        
        file_ext = file_record.file_name.split('.')[-1].lower() if file_record.file_name else 'jpg'
        content_type = content_types.get(file_ext, 'application/octet-stream')
        
        # Fetch file from MinIO or Azure
        try:
            if storage_type == 'minio':
                # Use MinIO client to fetch file
                if not minio_client:
                    raise HTTPException(status_code=500, detail="MinIO client not available")
                
                try:
                    # Get object from MinIO
                    response = minio_client.get_object(BUCKET_NAME, file_path)
                    
                    # Create streaming response from MinIO
                    def generate():
                        try:
                            for chunk in response.stream(8192):
                                yield chunk
                        finally:
                            response.close()
                            response.release_conn()
                    
                    return StreamingResponse(
                        generate(),
                        media_type=content_type,
                        headers={
                            "Content-Disposition": f"inline; filename={file_record.file_name}",
                            "Cache-Control": "public, max-age=3600"
                        }
                    )
                except S3Error as e:
                    print(f"[ERROR] MinIO S3Error: {e}")
                    raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")
                except Exception as e:
                    print(f"[ERROR] MinIO error: {e}")
                    raise HTTPException(status_code=500, detail=f"Failed to fetch file from MinIO: {str(e)}")
            
            elif storage_type == 'azure':
                # Use HTTP request for Azure
                response = requests.get(file_path, stream=True, timeout=30)
                response.raise_for_status()
                
                # Create streaming response
                def generate():
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            yield chunk
                
                return StreamingResponse(
                    generate(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"inline; filename={file_record.file_name}",
                        "Cache-Control": "public, max-age=3600"
                    }
                )
            else:
                raise HTTPException(status_code=500, detail=f"Unknown storage type: {storage_type}")
            
        except requests.RequestException as e:
            print(f"[ERROR] Failed to fetch file from {file_path}: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to fetch file from {file_path}: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in view_file: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error serving file: {str(e)}")

@router.get("/get-ivc-file/{ivc_id}")
def get_single_ivc_file(
    ivc_id: str,
    filter: Optional[str] = Query(None, description="Optional filter keyword to search in minio/azure paths"),
    machine: Optional[str] = Query(None, description="Optional machine name filter"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get a single IVC file by ID from metadata.elimages table.
    
    - Matches file_name like 'A50347B_A_240925_162409%.ivc'
    - If 'filter' is provided, returns only records where filter appears 
      in either minio_path or azure_path (case-insensitive).
    """
    # Build file_name filter for the ID
    existing_ivc_files = db.query(ElImage).filter(ElImage.file_name.like(f"{ivc_id}%.ivc")).all()

    available = []
    available_ids = set()

    for ivc_file in existing_ivc_files:
        base_id = ivc_file.file_name.rsplit('.', 1)[0] if '.' in ivc_file.file_name else ivc_file.file_name

        # If filter is provided, check it in minio_path or azure_path
        if filter:
            filter_lower = filter.lower()
            minio_match = ivc_file.minio_path and filter_lower in ivc_file.minio_path.lower()
            azure_match = ivc_file.azure_path and filter_lower in ivc_file.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if filter not found

        # If machine filter is provided, check if the path contains the machine name
        if machine:
            machine_lower = machine.lower()
            minio_match = ivc_file.minio_path and machine_lower in ivc_file.minio_path.lower()
            azure_match = ivc_file.azure_path and machine_lower in ivc_file.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if machine not found

        # Use build_file_record which returns records with storage path
        file_record = build_file_record(ivc_file)
        if file_record:
            available.append(file_record)
            # Add the file_id (with suffix) to available_ids
            available_ids.add(file_record["file_id"])

    return {
        "requested_id": ivc_id,
        "available_count": len(available_ids),
        "filter_applied": filter or None,
        "available_ids": list(available_ids),
        "records": available
    }

# File serving endpoint for viewing files in browser

@router.get("/view-file/{file_id}")
def view_file(
    file_id: str,
    file_type: str = Query(..., description="File type: image, rfid, or ivc"),
    db: Session = Depends(get_db)
):
    """
    Serve file content for viewing in browser.
    Supports images (JPG), PDFs, and IVC files.
    """
    try:
        # Determine file extension based on type
        extensions = {
            'image': ['jpg', 'jpeg'],
            'rfid': ['pdf'], 
            'ivc': ['ivc']
        }
        
        if file_type not in extensions:
            raise HTTPException(status_code=400, detail="Invalid file type. Use: image, rfid, or ivc")
        
        # Try exact match first, then pattern matching as fallback
        file_record = None
        for ext in extensions[file_type]:
            # First try exact match with the file_id as provided
            exact_filename = f"{file_id}.{ext}"
            file_record = db.query(ElImage).filter(
                ElImage.file_name == exact_filename
            ).first()
            if file_record:
                break
            
            # If exact match fails, try pattern matching as fallback
            patterns = [
                f"{file_id}%.{ext}",
                f"{file_id}_%.{ext}"
            ]
            
            for pattern in patterns:
                file_record = db.query(ElImage).filter(
                    ElImage.file_name.like(pattern)
                ).first()
                if file_record:
                    break
            
            if file_record:
                break
        
        if not file_record:
            # Debug: Let's see what files exist with similar names
            similar_files = db.query(ElImage).filter(
                ElImage.file_name.like(f"{file_id}%")
            ).limit(5).all()
            
            debug_info = {
                "requested_file_id": file_id,
                "file_type": file_type,
                "similar_files": [f.file_name for f in similar_files] if similar_files else []
            }
            
            raise HTTPException(
                status_code=404, 
                detail=f"File not found. Debug info: {debug_info}"
            )
        
        # Use helper function to determine correct file path based on file_id and storage
        file_info = get_file_path_for_fetching(file_record, file_id)
        
        # Debug logging
        print(f"[DEBUG] view_file - file_id: {file_id}")
        print(f"[DEBUG] view_file - file_record.file_name: {file_record.file_name}")
        print(f"[DEBUG] view_file - file_record.minio_path: {file_record.minio_path}")
        print(f"[DEBUG] view_file - file_record.azure_path: {file_record.azure_path}")
        print(f"[DEBUG] view_file - file_info: {file_info}")
        
        if not file_info or not file_info.get('path'):
            raise HTTPException(status_code=404, detail="File path not available (neither local nor Azure path found)")
        
        storage_type = file_info.get('type')
        file_path = file_info.get('path')
        
        # Determine content type
        content_types = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'pdf': 'application/pdf',
            'ivc': 'application/octet-stream'
        }
        
        file_ext = file_record.file_name.split('.')[-1].lower() if file_record.file_name else 'jpg'
        content_type = content_types.get(file_ext, 'application/octet-stream')
        
        # Fetch file from MinIO or Azure
        try:
            if storage_type == 'minio':
                # Use MinIO client to fetch file
                if not minio_client:
                    raise HTTPException(status_code=500, detail="MinIO client not available")
                
                try:
                    # Get object from MinIO
                    response = minio_client.get_object(BUCKET_NAME, file_path)
                    
                    # Create streaming response from MinIO
                    def generate():
                        try:
                            for chunk in response.stream(8192):
                                yield chunk
                        finally:
                            response.close()
                            response.release_conn()
                    
                    return StreamingResponse(
                        generate(),
                        media_type=content_type,
                        headers={
                            "Content-Disposition": f"inline; filename={file_record.file_name}",
                            "Cache-Control": "public, max-age=3600"
                        }
                    )
                except S3Error as e:
                    print(f"[ERROR] MinIO S3Error: {e}")
                    raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")
                except Exception as e:
                    print(f"[ERROR] MinIO error: {e}")
                    raise HTTPException(status_code=500, detail=f"Failed to fetch file from MinIO: {str(e)}")
            
            elif storage_type == 'azure':
                # Use HTTP request for Azure
                response = requests.get(file_path, stream=True, timeout=30)
                response.raise_for_status()
                
                # Create streaming response
                def generate():
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            yield chunk
                
                return StreamingResponse(
                    generate(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"inline; filename={file_record.file_name}",
                        "Cache-Control": "public, max-age=3600"
                    }
                )
            else:
                raise HTTPException(status_code=500, detail=f"Unknown storage type: {storage_type}")
            
        except requests.RequestException as e:
            print(f"[ERROR] Failed to fetch file from {file_path}: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to fetch file from {file_path}: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in view_file: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error serving file: {str(e)}")

@router.post("/check-ivc-files")
def check_ivc_file_ids(
    ids: List[str],
    filter: Optional[str] = Query(None, description="Optional filter keyword to search in minio/azure paths"),
    machine: Optional[str] = Query(None, description="Optional machine name filter"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Check if given IVC file IDs exist in metadata.elimages table.
    
    - Matches file_name like 'A50347B_A_240925_162409%.ivc'
    - If 'filter' is provided, returns only records where filter appears 
      in either minio_path or azure_path (case-insensitive).
    """
    if not ids:
        raise HTTPException(status_code=400, detail="No IDs provided")

    # Build file_name filters for all IDs
    filters = [ElImage.file_name.like(f"{ivc_id}%.ivc") for ivc_id in ids]
    existing_ivc_files = db.query(ElImage).filter(or_(*filters)).all()

    available = []
    available_ids = set()
    matched_excel_ids = set()

    for ivc_file in existing_ivc_files:
        base_id = ivc_file.file_name.split(".")[0]

        # If filter is provided, check it in either path
        if filter:
            filter_lower = filter.lower()
            minio_match = ivc_file.minio_path and filter_lower in ivc_file.minio_path.lower()
            azure_match = ivc_file.azure_path and filter_lower in ivc_file.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if filter not found

        # If machine filter is provided, check if the path contains the machine name
        if machine:
            machine_lower = machine.lower()
            minio_match = ivc_file.minio_path and machine_lower in ivc_file.minio_path.lower()
            azure_match = ivc_file.azure_path and machine_lower in ivc_file.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if machine not found

        # Build standardized record (adds file_id, storage_type, machine)
        file_record = build_file_record(ivc_file)
        if file_record:
            available.append(file_record)
            available_ids.add(base_id)
            for excel_id in ids:
                if base_id.startswith(excel_id) or excel_id in base_id:
                    matched_excel_ids.add(excel_id)

    missing_ids = [ivc_id for ivc_id in ids if ivc_id not in matched_excel_ids]

    return {
        "requested_count": len(ids),
        "available_count": len(matched_excel_ids),
        "missing_count": len(missing_ids),
        "filter_applied": filter or None,
        "available_ids": list(available_ids),
        "missing_ids": missing_ids,
        "records": available
    }

# Single ID endpoints for frontend single search functionality

@router.get("/get-image/{image_id}")
def get_single_image(
    image_id: str,
    filter: Optional[str] = Query(None, description="Optional filter keyword to search in minio/azure paths"),
    machine: Optional[str] = Query(None, description="Optional machine name filter"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get a single image by ID from metadata.elimages table.
    
    - Matches file_name like 'A50347B_A_240925_162409%.jpg'
    - Returns local paths first, falls back to Azure paths if no local paths exist
    - Returns error if neither local nor Azure paths are found
    - If 'filter' is 'pre', 'post', or 'bad', filters by filename suffix (e.g., _A, _B, _Z)
    - Other filter values use path-based filtering (case-insensitive)
    - If 'machine' is provided, returns only records for the specified machine.
    """
    # Build file_name filter for the ID
    existing_images = db.query(ElImage).filter(ElImage.file_name.like(f"{image_id}%.jpg")).all()

    local_records = []
    azure_records = []
    available_ids = set()

    for image in existing_images:
        base_id = image.file_name.split(".")[0]

        # Extract image type from filename
        image_type = extract_image_type_from_filename(image.file_name)

        # If filter is provided, check image type from filename
        if filter:
            filter_lower = filter.lower()
            
            # For type filters (pre/post/trim/bad OR b/a/t/z), check filename token
            normalized_type_filter = normalize_image_filter(filter_lower)
            if normalized_type_filter:
                if image_type != normalized_type_filter:
                    continue  # Skip record if type doesn't match
            else:
                # Fallback to path-based filtering for other filters
                minio_match = image.minio_path and filter_lower in image.minio_path.lower()
                azure_match = image.azure_path and filter_lower in image.azure_path.lower()
                if not (minio_match or azure_match):
                    continue  # Skip record if filter not found

        # If machine filter is provided, check if the path contains the machine name
        if machine:
            machine_lower = machine.lower()
            minio_match = image.minio_path and machine_lower in image.minio_path.lower()
            azure_match = image.azure_path and machine_lower in image.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if machine not found

        # Build record
        file_record = build_file_record(image)
        if file_record:
            if file_record["storage_type"] == "local":
                local_records.append(file_record)
                available_ids.add(base_id)
            else:  # azure (cloud only)
                azure_records.append(file_record)
                available_ids.add(base_id)  # Include cloud-only records in count
    
    # Determine which records to return - local priority, fallback to azure (cloud only)
    if local_records:
        available = local_records
    elif azure_records:
        available = azure_records  # Return cloud-only records if no local paths found
    else:
        raise HTTPException(
            status_code=404, 
            detail=f"No records found for image ID '{image_id}' in either local or Azure storage"
        )

    return {
        "requested_id": image_id,
        "available_count": len(available_ids),
        "filter_applied": filter or None,
        "available_ids": list(available_ids),
        "records": available
    }

# File serving endpoint for viewing files in browser

@router.get("/view-file/{file_id}")
def view_file(
    file_id: str,
    file_type: str = Query(..., description="File type: image, rfid, or ivc"),
    db: Session = Depends(get_db)
):
    """
    Serve file content for viewing in browser.
    Supports images (JPG), PDFs, and IVC files.
    """
    try:
        # Determine file extension based on type
        extensions = {
            'image': ['jpg', 'jpeg'],
            'rfid': ['pdf'], 
            'ivc': ['ivc']
        }
        
        if file_type not in extensions:
            raise HTTPException(status_code=400, detail="Invalid file type. Use: image, rfid, or ivc")
        
        # Try exact match first, then pattern matching as fallback
        file_record = None
        for ext in extensions[file_type]:
            # First try exact match with the file_id as provided
            exact_filename = f"{file_id}.{ext}"
            file_record = db.query(ElImage).filter(
                ElImage.file_name == exact_filename
            ).first()
            if file_record:
                break
            
            # If exact match fails, try pattern matching as fallback
            patterns = [
                f"{file_id}%.{ext}",
                f"{file_id}_%.{ext}"
            ]
            
            for pattern in patterns:
                file_record = db.query(ElImage).filter(
                    ElImage.file_name.like(pattern)
                ).first()
                if file_record:
                    break
            
            if file_record:
                break
        
        if not file_record:
            # Debug: Let's see what files exist with similar names
            similar_files = db.query(ElImage).filter(
                ElImage.file_name.like(f"{file_id}%")
            ).limit(5).all()
            
            debug_info = {
                "requested_file_id": file_id,
                "file_type": file_type,
                "similar_files": [f.file_name for f in similar_files] if similar_files else []
            }
            
            raise HTTPException(
                status_code=404, 
                detail=f"File not found. Debug info: {debug_info}"
            )
        
        # Use helper function to determine correct file path based on file_id and storage
        file_info = get_file_path_for_fetching(file_record, file_id)
        
        # Debug logging
        print(f"[DEBUG] view_file - file_id: {file_id}")
        print(f"[DEBUG] view_file - file_record.file_name: {file_record.file_name}")
        print(f"[DEBUG] view_file - file_record.minio_path: {file_record.minio_path}")
        print(f"[DEBUG] view_file - file_record.azure_path: {file_record.azure_path}")
        print(f"[DEBUG] view_file - file_info: {file_info}")
        
        if not file_info or not file_info.get('path'):
            raise HTTPException(status_code=404, detail="File path not available (neither local nor Azure path found)")
        
        storage_type = file_info.get('type')
        file_path = file_info.get('path')
        
        # Determine content type
        content_types = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'pdf': 'application/pdf',
            'ivc': 'application/octet-stream'
        }
        
        file_ext = file_record.file_name.split('.')[-1].lower() if file_record.file_name else 'jpg'
        content_type = content_types.get(file_ext, 'application/octet-stream')
        
        # Fetch file from MinIO or Azure
        try:
            if storage_type == 'minio':
                # Use MinIO client to fetch file
                if not minio_client:
                    raise HTTPException(status_code=500, detail="MinIO client not available")
                
                try:
                    # Get object from MinIO
                    response = minio_client.get_object(BUCKET_NAME, file_path)
                    
                    # Create streaming response from MinIO
                    def generate():
                        try:
                            for chunk in response.stream(8192):
                                yield chunk
                        finally:
                            response.close()
                            response.release_conn()
                    
                    return StreamingResponse(
                        generate(),
                        media_type=content_type,
                        headers={
                            "Content-Disposition": f"inline; filename={file_record.file_name}",
                            "Cache-Control": "public, max-age=3600"
                        }
                    )
                except S3Error as e:
                    print(f"[ERROR] MinIO S3Error: {e}")
                    raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")
                except Exception as e:
                    print(f"[ERROR] MinIO error: {e}")
                    raise HTTPException(status_code=500, detail=f"Failed to fetch file from MinIO: {str(e)}")
            
            elif storage_type == 'azure':
                # Use HTTP request for Azure
                response = requests.get(file_path, stream=True, timeout=30)
                response.raise_for_status()
                
                # Create streaming response
                def generate():
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            yield chunk
                
                return StreamingResponse(
                    generate(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"inline; filename={file_record.file_name}",
                        "Cache-Control": "public, max-age=3600"
                    }
                )
            else:
                raise HTTPException(status_code=500, detail=f"Unknown storage type: {storage_type}")
            
        except requests.RequestException as e:
            print(f"[ERROR] Failed to fetch file from {file_path}: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to fetch file from {file_path}: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in view_file: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error serving file: {str(e)}")

@router.get("/download-file/{file_id}")
def download_file(
    file_id: str,
    file_type: str = Query(..., description="File type: image, rfid, or ivc"),
    db: Session = Depends(get_db)
):
    """
    Download file content with attachment disposition.
    Uses authenticated MinIO client for MinIO files.
    """
    # Reuse the same logic as view_file but with attachment disposition
    try:
        extensions = {
            'image': ['jpg', 'jpeg'],
            'rfid': ['pdf'], 
            'ivc': ['ivc']
        }
        
        if file_type not in extensions:
            raise HTTPException(status_code=400, detail="Invalid file type. Use: image, rfid, or ivc")
        
        file_record = None
        for ext in extensions[file_type]:
            exact_filename = f"{file_id}.{ext}"
            file_record = db.query(ElImage).filter(
                ElImage.file_name == exact_filename
            ).first()
            if file_record:
                break
            
            patterns = [f"{file_id}%.{ext}", f"{file_id}_%.{ext}"]
            for pattern in patterns:
                file_record = db.query(ElImage).filter(
                    ElImage.file_name.like(pattern)
                ).first()
                if file_record:
                    break
            if file_record:
                break
        
        if not file_record:
            raise HTTPException(status_code=404, detail=f"File not found: {file_id}")
        
        file_info = get_file_path_for_fetching(file_record, file_id)
        if not file_info or not file_info.get('path'):
            raise HTTPException(status_code=404, detail="File path not available")
        
        storage_type = file_info.get('type')
        file_path = file_info.get('path')
        
        content_types = {
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
            'pdf': 'application/pdf', 'ivc': 'application/octet-stream'
        }
        file_ext = file_record.file_name.split('.')[-1].lower() if file_record.file_name else 'jpg'
        content_type = content_types.get(file_ext, 'application/octet-stream')
        
        if storage_type == 'minio':
            if not minio_client:
                raise HTTPException(status_code=500, detail="MinIO client not available")
            try:
                response = minio_client.get_object(BUCKET_NAME, file_path)
                def generate():
                    try:
                        for chunk in response.stream(8192):
                            yield chunk
                    finally:
                        response.close()
                        response.release_conn()
                return StreamingResponse(
                    generate(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"attachment; filename={file_record.file_name}",
                        "Cache-Control": "public, max-age=3600"
                    }
                )
            except S3Error as e:
                raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")
        elif storage_type == 'azure':
            response = requests.get(file_path, stream=True, timeout=30)
            response.raise_for_status()
            def generate():
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        yield chunk
            return StreamingResponse(
                generate(),
                media_type=content_type,
                headers={
                    "Content-Disposition": f"attachment; filename={file_record.file_name}",
                    "Cache-Control": "public, max-age=3600"
                }
            )
        else:
            raise HTTPException(status_code=500, detail=f"Unknown storage type: {storage_type}")
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in download_file: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error downloading file: {str(e)}")

@router.get("/get-rfid-pdf/{rfid_id}")
def get_single_rfid_pdf(
    rfid_id: str,
    filter: Optional[str] = Query(None, description="Optional filter keyword to search in minio/azure paths"),
    machine: Optional[str] = Query(None, description="Optional machine name filter"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get a single RFID PDF by ID from metadata.elimages table.
    
    - Matches file_name like 'A50347B_A_240925_162409%.pdf'
    - If 'filter' is provided, returns only records where filter appears 
      in either minio_path or azure_path (case-insensitive).
    - If 'machine' is provided, returns only records for the specified machine.
    """
    # Build file_name filter for the ID
    existing_pdfs = db.query(ElImage).filter(ElImage.file_name.like(f"{rfid_id}%.pdf")).all()

    available = []
    available_ids = set()

    for pdf in existing_pdfs:
        base_id = pdf.file_name.rsplit('.', 1)[0] if '.' in pdf.file_name else pdf.file_name

        # If filter is provided, check it in minio_path or azure_path
        if filter:
            filter_lower = filter.lower()
            minio_match = pdf.minio_path and filter_lower in pdf.minio_path.lower()
            azure_match = pdf.azure_path and filter_lower in pdf.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if filter not found

        # If machine filter is provided, check if the path contains the machine name
        if machine:
            machine_lower = machine.lower()
            minio_match = pdf.minio_path and machine_lower in pdf.minio_path.lower()
            azure_match = pdf.azure_path and machine_lower in pdf.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if machine not found

        # Use build_file_record which returns records with storage path
        file_record = build_file_record(pdf)
        if file_record:
            available.append(file_record)
            # Add the file_id (with suffix) to available_ids
            available_ids.add(file_record["file_id"])

    return {
        "requested_id": rfid_id,
        "available_count": len(available_ids),
        "filter_applied": filter or None,
        "available_ids": list(available_ids),
        "records": available
    }

# File serving endpoint for viewing files in browser

@router.get("/view-file/{file_id}")
def view_file(
    file_id: str,
    file_type: str = Query(..., description="File type: image, rfid, or ivc"),
    db: Session = Depends(get_db)
):
    """
    Serve file content for viewing in browser.
    Supports images (JPG), PDFs, and IVC files.
    """
    try:
        # Determine file extension based on type
        extensions = {
            'image': ['jpg', 'jpeg'],
            'rfid': ['pdf'], 
            'ivc': ['ivc']
        }
        
        if file_type not in extensions:
            raise HTTPException(status_code=400, detail="Invalid file type. Use: image, rfid, or ivc")
        
        # Try exact match first, then pattern matching as fallback
        file_record = None
        for ext in extensions[file_type]:
            # First try exact match with the file_id as provided
            exact_filename = f"{file_id}.{ext}"
            file_record = db.query(ElImage).filter(
                ElImage.file_name == exact_filename
            ).first()
            if file_record:
                break
            
            # If exact match fails, try pattern matching as fallback
            patterns = [
                f"{file_id}%.{ext}",
                f"{file_id}_%.{ext}"
            ]
            
            for pattern in patterns:
                file_record = db.query(ElImage).filter(
                    ElImage.file_name.like(pattern)
                ).first()
                if file_record:
                    break
            
            if file_record:
                break
        
        if not file_record:
            # Debug: Let's see what files exist with similar names
            similar_files = db.query(ElImage).filter(
                ElImage.file_name.like(f"{file_id}%")
            ).limit(5).all()
            
            debug_info = {
                "requested_file_id": file_id,
                "file_type": file_type,
                "similar_files": [f.file_name for f in similar_files] if similar_files else []
            }
            
            raise HTTPException(
                status_code=404, 
                detail=f"File not found. Debug info: {debug_info}"
            )
        
        # Use helper function to determine correct file path based on file_id and storage
        file_info = get_file_path_for_fetching(file_record, file_id)
        
        # Debug logging
        print(f"[DEBUG] view_file - file_id: {file_id}")
        print(f"[DEBUG] view_file - file_record.file_name: {file_record.file_name}")
        print(f"[DEBUG] view_file - file_record.minio_path: {file_record.minio_path}")
        print(f"[DEBUG] view_file - file_record.azure_path: {file_record.azure_path}")
        print(f"[DEBUG] view_file - file_info: {file_info}")
        
        if not file_info or not file_info.get('path'):
            raise HTTPException(status_code=404, detail="File path not available (neither local nor Azure path found)")
        
        storage_type = file_info.get('type')
        file_path = file_info.get('path')
        
        # Determine content type
        content_types = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'pdf': 'application/pdf',
            'ivc': 'application/octet-stream'
        }
        
        file_ext = file_record.file_name.split('.')[-1].lower() if file_record.file_name else 'jpg'
        content_type = content_types.get(file_ext, 'application/octet-stream')
        
        # Fetch file from MinIO or Azure
        try:
            if storage_type == 'minio':
                # Use MinIO client to fetch file
                if not minio_client:
                    raise HTTPException(status_code=500, detail="MinIO client not available")
                
                try:
                    # Get object from MinIO
                    response = minio_client.get_object(BUCKET_NAME, file_path)
                    
                    # Create streaming response from MinIO
                    def generate():
                        try:
                            for chunk in response.stream(8192):
                                yield chunk
                        finally:
                            response.close()
                            response.release_conn()
                    
                    return StreamingResponse(
                        generate(),
                        media_type=content_type,
                        headers={
                            "Content-Disposition": f"inline; filename={file_record.file_name}",
                            "Cache-Control": "public, max-age=3600"
                        }
                    )
                except S3Error as e:
                    print(f"[ERROR] MinIO S3Error: {e}")
                    raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")
                except Exception as e:
                    print(f"[ERROR] MinIO error: {e}")
                    raise HTTPException(status_code=500, detail=f"Failed to fetch file from MinIO: {str(e)}")
            
            elif storage_type == 'azure':
                # Use HTTP request for Azure
                response = requests.get(file_path, stream=True, timeout=30)
                response.raise_for_status()
                
                # Create streaming response
                def generate():
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            yield chunk
                
                return StreamingResponse(
                    generate(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"inline; filename={file_record.file_name}",
                        "Cache-Control": "public, max-age=3600"
                    }
                )
            else:
                raise HTTPException(status_code=500, detail=f"Unknown storage type: {storage_type}")
            
        except requests.RequestException as e:
            print(f"[ERROR] Failed to fetch file from {file_path}: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to fetch file from {file_path}: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in view_file: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error serving file: {str(e)}")

@router.get("/get-ivc-file/{ivc_id}")
def get_single_ivc_file(
    ivc_id: str,
    filter: Optional[str] = Query(None, description="Optional filter keyword to search in minio/azure paths"),
    machine: Optional[str] = Query(None, description="Optional machine name filter"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get a single IVC file by ID from metadata.elimages table.
    
    - Matches file_name like 'A50347B_A_240925_162409%.ivc'
    - If 'filter' is provided, returns only records where filter appears 
      in either minio_path or azure_path (case-insensitive).
    """
    # Build file_name filter for the ID
    existing_ivc_files = db.query(ElImage).filter(ElImage.file_name.like(f"{ivc_id}%.ivc")).all()

    available = []
    available_ids = set()

    for ivc_file in existing_ivc_files:
        base_id = ivc_file.file_name.rsplit('.', 1)[0] if '.' in ivc_file.file_name else ivc_file.file_name

        # If filter is provided, check it in minio_path or azure_path
        if filter:
            filter_lower = filter.lower()
            minio_match = ivc_file.minio_path and filter_lower in ivc_file.minio_path.lower()
            azure_match = ivc_file.azure_path and filter_lower in ivc_file.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if filter not found

        # If machine filter is provided, check if the path contains the machine name
        if machine:
            machine_lower = machine.lower()
            minio_match = ivc_file.minio_path and machine_lower in ivc_file.minio_path.lower()
            azure_match = ivc_file.azure_path and machine_lower in ivc_file.azure_path.lower()
            if not (minio_match or azure_match):
                continue  # Skip record if machine not found

        # Use build_file_record which returns records with storage path
        file_record = build_file_record(ivc_file)
        if file_record:
            available.append(file_record)
            # Add the file_id (with suffix) to available_ids
            available_ids.add(file_record["file_id"])

    return {
        "requested_id": ivc_id,
        "available_count": len(available_ids),
        "filter_applied": filter or None,
        "available_ids": list(available_ids),
        "records": available
    }

# File serving endpoint for viewing files in browser

@router.get("/view-file/{file_id}")
def view_file(
    file_id: str,
    file_type: str = Query(..., description="File type: image, rfid, or ivc"),
    db: Session = Depends(get_db)
):
    """
    Serve file content for viewing in browser.
    Supports images (JPG), PDFs, and IVC files.
    """
    try:
        # Determine file extension based on type
        extensions = {
            'image': ['jpg', 'jpeg'],
            'rfid': ['pdf'], 
            'ivc': ['ivc']
        }
        
        if file_type not in extensions:
            raise HTTPException(status_code=400, detail="Invalid file type. Use: image, rfid, or ivc")
        
        # Try exact match first, then pattern matching as fallback
        file_record = None
        for ext in extensions[file_type]:
            # First try exact match with the file_id as provided
            exact_filename = f"{file_id}.{ext}"
            file_record = db.query(ElImage).filter(
                ElImage.file_name == exact_filename
            ).first()
            if file_record:
                break
            
            # If exact match fails, try pattern matching as fallback
            patterns = [
                f"{file_id}%.{ext}",
                f"{file_id}_%.{ext}"
            ]
            
            for pattern in patterns:
                file_record = db.query(ElImage).filter(
                    ElImage.file_name.like(pattern)
                ).first()
                if file_record:
                    break
            
            if file_record:
                break
        
        if not file_record:
            # Debug: Let's see what files exist with similar names
            similar_files = db.query(ElImage).filter(
                ElImage.file_name.like(f"{file_id}%")
            ).limit(5).all()
            
            debug_info = {
                "requested_file_id": file_id,
                "file_type": file_type,
                "similar_files": [f.file_name for f in similar_files] if similar_files else []
            }
            
            raise HTTPException(
                status_code=404, 
                detail=f"File not found. Debug info: {debug_info}"
            )
        
        # Use helper function to determine correct file path based on file_id and storage
        file_info = get_file_path_for_fetching(file_record, file_id)
        
        # Debug logging
        print(f"[DEBUG] view_file - file_id: {file_id}")
        print(f"[DEBUG] view_file - file_record.file_name: {file_record.file_name}")
        print(f"[DEBUG] view_file - file_record.minio_path: {file_record.minio_path}")
        print(f"[DEBUG] view_file - file_record.azure_path: {file_record.azure_path}")
        print(f"[DEBUG] view_file - file_info: {file_info}")
        
        if not file_info or not file_info.get('path'):
            raise HTTPException(status_code=404, detail="File path not available (neither local nor Azure path found)")
        
        storage_type = file_info.get('type')
        file_path = file_info.get('path')
        
        # Determine content type
        content_types = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'pdf': 'application/pdf',
            'ivc': 'application/octet-stream'
        }
        
        file_ext = file_record.file_name.split('.')[-1].lower() if file_record.file_name else 'jpg'
        content_type = content_types.get(file_ext, 'application/octet-stream')
        
        # Fetch file from MinIO or Azure
        try:
            if storage_type == 'minio':
                # Use MinIO client to fetch file
                if not minio_client:
                    raise HTTPException(status_code=500, detail="MinIO client not available")
                
                try:
                    # Get object from MinIO
                    response = minio_client.get_object(BUCKET_NAME, file_path)
                    
                    # Create streaming response from MinIO
                    def generate():
                        try:
                            for chunk in response.stream(8192):
                                yield chunk
                        finally:
                            response.close()
                            response.release_conn()
                    
                    return StreamingResponse(
                        generate(),
                        media_type=content_type,
                        headers={
                            "Content-Disposition": f"inline; filename={file_record.file_name}",
                            "Cache-Control": "public, max-age=3600"
                        }
                    )
                except S3Error as e:
                    print(f"[ERROR] MinIO S3Error: {e}")
                    raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")
                except Exception as e:
                    print(f"[ERROR] MinIO error: {e}")
                    raise HTTPException(status_code=500, detail=f"Failed to fetch file from MinIO: {str(e)}")
            
            elif storage_type == 'azure':
                # Use HTTP request for Azure
                response = requests.get(file_path, stream=True, timeout=30)
                response.raise_for_status()
                
                # Create streaming response
                def generate():
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            yield chunk
                
                return StreamingResponse(
                    generate(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"inline; filename={file_record.file_name}",
                        "Cache-Control": "public, max-age=3600"
                    }
                )
            else:
                raise HTTPException(status_code=500, detail=f"Unknown storage type: {storage_type}")
            
        except requests.RequestException as e:
            print(f"[ERROR] Failed to fetch file from {file_path}: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to fetch file from {file_path}: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in view_file: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error serving file: {str(e)}")