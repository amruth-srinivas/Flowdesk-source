import { motion } from 'framer-motion';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { Toast } from 'primereact/toast';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createProjectDocumentFolderRequest,
  deleteProjectDocumentFileRequest,
  deleteProjectDocumentFolderRequest,
  downloadProjectDocumentFile,
  getProjectDocumentBlobRequest,
  listProjectDocumentFilesRequest,
  listProjectDocumentFoldersRequest,
  uploadProjectDocumentFileRequest,
  type ProjectDocumentFileRecord,
  type ProjectDocumentFolderRecord,
  type ProjectRecord,
} from '../../lib/api';

type BreadcrumbItem = { id: string | null; name: string };

type ViewerState = {
  objectUrl: string;
  filename: string;
  mimeType: string;
  projectId: string;
  fileId: string;
};

function isPdfMime(m: string, filename?: string): boolean {
  const x = m.toLowerCase();
  if (x.includes('pdf') || x === 'application/x-pdf') {
    return true;
  }
  return Boolean(filename?.toLowerCase().endsWith('.pdf'));
}

function isImageMime(m: string, filename?: string): boolean {
  if (m.toLowerCase().startsWith('image/')) {
    return true;
  }
  const f = filename?.toLowerCase() ?? '';
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f);
}

function isTextMime(m: string): boolean {
  const x = m.toLowerCase();
  return x.startsWith('text/') || x.includes('json') || x.includes('xml');
}

/** PrimeIcons class for common document types */
function fileIconClass(filename: string): string {
  const f = filename.toLowerCase();
  if (f.endsWith('.pdf')) {
    return 'pi pi-file-pdf kb-documents-type-icon kb-documents-type-icon--pdf';
  }
  if (f.endsWith('.docx') || f.endsWith('.doc')) {
    return 'pi pi-file-word kb-documents-type-icon kb-documents-type-icon--word';
  }
  if (f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.csv')) {
    return 'pi pi-file-excel kb-documents-type-icon kb-documents-type-icon--excel';
  }
  if (f.endsWith('.pptx') || f.endsWith('.ppt')) {
    return 'pi pi-file kb-documents-type-icon kb-documents-type-icon--ppt';
  }
  if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f)) {
    return 'pi pi-image kb-documents-type-icon kb-documents-type-icon--image';
  }
  if (/\.(zip|rar|7z|tar|gz)$/i.test(f)) {
    return 'pi pi-folder-open kb-documents-type-icon kb-documents-type-icon--archive';
  }
  return 'pi pi-file kb-documents-type-icon';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type KbDocumentsWorkspaceProps = {
  viewKey: string;
  projects: ProjectRecord[];
};

export function KbDocumentsWorkspace({ viewKey, projects }: KbDocumentsWorkspaceProps) {
  const toastRef = useRef<Toast>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const [projectId, setProjectId] = useState<string | null>(projects[0]?.id ?? null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ id: null, name: 'Root' }]);

  const [folders, setFolders] = useState<ProjectDocumentFolderRecord[]>([]);
  const [files, setFiles] = useState<ProjectDocumentFileRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [savingFolder, setSavingFolder] = useState(false);

  const [busyDelete, setBusyDelete] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const viewerBlobUrlRef = useRef<string | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  const projectOptions = useMemo(
    () => projects.map((p) => ({ label: p.name, value: p.id })),
    [projects],
  );

  const loadContents = useCallback(async () => {
    if (!projectId) {
      setFolders([]);
      setFiles([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [fList, docList] = await Promise.all([
        listProjectDocumentFoldersRequest(projectId, currentFolderId ?? undefined),
        listProjectDocumentFilesRequest(projectId, currentFolderId ?? undefined),
      ]);
      setFolders(fList);
      setFiles(docList);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load documents');
      setFolders([]);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, currentFolderId]);

  useEffect(() => {
    void loadContents();
  }, [loadContents]);

  useEffect(() => {
    if (projects.length && !projectId) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId]);

  function revokeViewerBlobUrl() {
    if (viewerBlobUrlRef.current) {
      URL.revokeObjectURL(viewerBlobUrlRef.current);
      viewerBlobUrlRef.current = null;
    }
  }

  function closeAttachmentViewer() {
    revokeViewerBlobUrl();
    setViewer(null);
  }

  useEffect(() => {
    return () => revokeViewerBlobUrl();
  }, []);

  function resetNavigation() {
    setCurrentFolderId(null);
    setBreadcrumb([{ id: null, name: 'Root' }]);
  }

  function enterFolder(folder: ProjectDocumentFolderRecord) {
    setCurrentFolderId(folder.id);
    setBreadcrumb((prev) => [...prev, { id: folder.id, name: folder.name }]);
  }

  function goToBreadcrumb(index: number) {
    const next = breadcrumb.slice(0, index + 1);
    setBreadcrumb(next);
    setCurrentFolderId(next[next.length - 1].id);
  }

  async function handleCreateFolder() {
    if (!projectId || !newFolderName.trim()) {
      return;
    }
    const label = newFolderName.trim();
    setSavingFolder(true);
    try {
      await createProjectDocumentFolderRequest(projectId, {
        name: label,
        parent_id: currentFolderId,
      });
      setNewFolderOpen(false);
      setNewFolderName('');
      await loadContents();
      toastRef.current?.show({
        severity: 'success',
        summary: 'Folder created',
        detail: `"${label}" was added.`,
        life: 3500,
      });
    } catch (e) {
      toastRef.current?.show({
        severity: 'error',
        summary: 'Could not create folder',
        detail: e instanceof Error ? e.message : 'Request failed',
        life: 5000,
      });
    } finally {
      setSavingFolder(false);
    }
  }

  async function handleDeleteFolder(folder: ProjectDocumentFolderRecord) {
    if (!projectId) {
      return;
    }
    const key = `fd-${folder.id}`;
    setBusyDelete(key);
    try {
      await deleteProjectDocumentFolderRequest(projectId, folder.id);
      await loadContents();
      toastRef.current?.show({ severity: 'success', summary: 'Folder removed', life: 3000 });
    } catch (e) {
      toastRef.current?.show({
        severity: 'error',
        summary: 'Could not delete folder',
        detail: e instanceof Error ? e.message : 'Remove files and subfolders first.',
        life: 5000,
      });
    } finally {
      setBusyDelete(null);
    }
  }

  async function handleDeleteFile(file: ProjectDocumentFileRecord) {
    if (!projectId) {
      return;
    }
    const key = `fl-${file.id}`;
    setBusyDelete(key);
    try {
      await deleteProjectDocumentFileRequest(projectId, file.id);
      await loadContents();
      toastRef.current?.show({ severity: 'success', summary: 'File removed', life: 3000 });
    } catch (e) {
      toastRef.current?.show({
        severity: 'error',
        summary: 'Could not delete file',
        detail: e instanceof Error ? e.message : 'Request failed',
        life: 5000,
      });
    } finally {
      setBusyDelete(null);
    }
  }

  async function handleUploadChange(ev: ChangeEvent<HTMLInputElement>) {
    const fileList = ev.target.files;
    // Copy File[] before clearing the input — some browsers empty FileList when value is reset.
    const selected = fileList?.length ? Array.from(fileList) : [];
    ev.target.value = '';
    if (!selected.length || !projectId) {
      return;
    }
    setUploading(true);
    const errors: string[] = [];
    let ok = 0;
    try {
      for (const f of selected) {
        try {
          await uploadProjectDocumentFileRequest(projectId, f, currentFolderId);
          ok += 1;
        } catch (e) {
          errors.push(`${f.name}: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      await loadContents();
      if (ok > 0 && errors.length === 0) {
        const names =
          selected.length <= 4
            ? selected.map((f) => f.name).join(', ')
            : `${selected
                .slice(0, 3)
                .map((f) => f.name)
                .join(', ')} and ${selected.length - 3} more`;
        toastRef.current?.show({
          severity: 'success',
          summary: ok === 1 ? 'File uploaded' : `${ok} files uploaded`,
          detail: names,
          life: 4500,
        });
      } else if (ok > 0 && errors.length > 0) {
        toastRef.current?.show({
          severity: 'warn',
          summary: `Uploaded ${ok} of ${selected.length} file(s)`,
          detail: errors.slice(0, 3).join(' · ') + (errors.length > 3 ? '…' : ''),
          life: 8000,
        });
      } else {
        toastRef.current?.show({
          severity: 'error',
          summary: 'Upload failed',
          detail: errors.slice(0, 4).join(' · ') || 'Could not upload',
          life: 8000,
        });
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleDownloadFile(file: ProjectDocumentFileRecord) {
    if (!projectId) {
      return;
    }
    try {
      await downloadProjectDocumentFile(projectId, file.id, file.filename);
    } catch (e) {
      toastRef.current?.show({
        severity: 'error',
        summary: 'Download failed',
        detail: e instanceof Error ? e.message : 'Could not download file',
        life: 4000,
      });
    }
  }

  async function handlePreviewFile(file: ProjectDocumentFileRecord) {
    if (!projectId) {
      return;
    }
    const key = `pv-${file.id}`;
    setPreviewBusy(key);
    try {
      revokeViewerBlobUrl();
      const blob = await getProjectDocumentBlobRequest(projectId, file.id);
      const mimeType = (blob.type || file.mime_type || '').trim() || 'application/octet-stream';
      const url = URL.createObjectURL(blob);
      viewerBlobUrlRef.current = url;
      setViewer({
        objectUrl: url,
        filename: file.filename,
        mimeType,
        projectId,
        fileId: file.id,
      });
    } catch (e) {
      toastRef.current?.show({
        severity: 'error',
        summary: 'Could not open preview',
        detail: e instanceof Error ? e.message : 'Request failed',
        life: 5000,
      });
    } finally {
      setPreviewBusy(null);
    }
  }

  async function handleDeleteAllFiles() {
    if (!projectId || files.length === 0) {
      return;
    }
    setDeletingAll(true);
    const ids = files.map((f) => f.id);
    let ok = 0;
    const errors: string[] = [];
    try {
      for (const f of files) {
        try {
          await deleteProjectDocumentFileRequest(projectId, f.id);
          ok += 1;
        } catch (e) {
          errors.push(`${f.filename}: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      await loadContents();
      setDeleteAllOpen(false);
      if (ok === ids.length) {
        toastRef.current?.show({
          severity: 'success',
          summary: 'All files deleted',
          detail: `${ok} file(s) removed from this folder.`,
          life: 4000,
        });
      } else {
        toastRef.current?.show({
          severity: 'warn',
          summary: `Removed ${ok} of ${ids.length} file(s)`,
          detail: errors.slice(0, 4).join(' · ') || undefined,
          life: 8000,
        });
      }
    } finally {
      setDeletingAll(false);
    }
  }

  const combinedRows = useMemo(() => {
    const folderRows = folders.map((f) => ({
      kind: 'folder' as const,
      rowKey: `folder-${f.id}`,
      id: f.id,
      name: f.name,
      raw: f,
    }));
    const fileRows = files.map((f) => ({
      kind: 'file' as const,
      rowKey: `file-${f.id}`,
      id: f.id,
      name: f.filename,
      raw: f,
    }));
    return [...folderRows, ...fileRows];
  }, [folders, files]);

  return (
    <motion.article
      key={viewKey}
      className="page-card kb-documents-workspace"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Toast ref={toastRef} position="top-center" />
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="kb-documents-file-input"
        aria-hidden
        tabIndex={-1}
        onChange={handleUploadChange}
      />

      <header className="kb-documents-head">
        <div className="kb-documents-head-inner">
          <span className="kb-documents-kicker">Knowledge base</span>
        </div>
      </header>

      {projects.length === 0 ? (
        <p className="kb-documents-empty">No projects available. Projects must be assigned to you to store documents.</p>
      ) : (
        <>
          <div className="kb-documents-toolbar-card">
            <div className="kb-documents-toolbar">
              <div className="kb-documents-project">
                <label className="kb-documents-label" htmlFor="kb-doc-project">
                  Project
                </label>
                <Dropdown
                  inputId="kb-doc-project"
                  value={projectId}
                  options={projectOptions}
                  onChange={(e) => {
                    setProjectId(e.value as string);
                    resetNavigation();
                  }}
                  placeholder="Select project"
                  className="kb-documents-project-dd"
                  filter
                />
              </div>
              <div className="kb-documents-actions">
                <Button
                  type="button"
                  label="New folder"
                  icon="pi pi-folder-plus"
                  outlined
                  className="kb-documents-btn-secondary"
                  disabled={!projectId}
                  onClick={() => {
                    setNewFolderName('');
                    setNewFolderOpen(true);
                  }}
                />
                <Button
                  type="button"
                  label={uploading ? 'Uploading…' : 'Upload files'}
                  icon="pi pi-upload"
                  className="kb-documents-btn-primary"
                  disabled={!projectId || uploading}
                  loading={uploading}
                  onClick={() => uploadInputRef.current?.click()}
                />
                <Button
                  type="button"
                  label="Delete all"
                  icon="pi pi-trash"
                  severity="danger"
                  outlined
                  className="kb-documents-btn-danger"
                  disabled={!projectId || files.length === 0 || deletingAll || uploading}
                  loading={deletingAll}
                  onClick={() => setDeleteAllOpen(true)}
                />
              </div>
            </div>
          </div>

          {projectId ? (
            <>
              <nav className="kb-documents-breadcrumb" aria-label="Folder path">
                <span className="kb-documents-bc-label">
                  <i className="pi pi-folder-open" aria-hidden />
                  Location
                </span>
                <div className="kb-documents-bc-trail">
                  {breadcrumb.map((crumb, i) => (
                    <span key={`${crumb.id ?? 'root'}-${i}`} className="kb-documents-bc-item">
                      {i > 0 ? <i className="pi pi-angle-right kb-documents-bc-chevron" aria-hidden /> : null}
                      <button
                        type="button"
                        className={`kb-documents-bc-link${i === breadcrumb.length - 1 ? ' kb-documents-bc-link--current' : ''}`}
                        onClick={() => goToBreadcrumb(i)}
                      >
                        {i === 0 ? (
                          <>
                            <i className="pi pi-home kb-documents-bc-home" aria-hidden />
                            {crumb.name}
                          </>
                        ) : (
                          crumb.name
                        )}
                      </button>
                    </span>
                  ))}
                </div>
              </nav>

              {error ? <p className="kb-documents-error">{error}</p> : null}

              <div className="kb-documents-table-shell">
                <DataTable
                  value={combinedRows}
                  loading={loading}
                  dataKey="rowKey"
                  className="user-table kb-documents-table"
                  stripedRows
                  showGridlines={false}
                  emptyMessage="This folder is empty. Create a subfolder or upload a file."
                >
                  <Column
                    header="Name"
                    headerClassName="kb-documents-col-name"
                    bodyClassName="kb-documents-col-name"
                    body={(row: (typeof combinedRows)[0]) => (
                      <div className="kb-documents-name-cell">
                        {row.kind === 'folder' ? (
                          <button
                            type="button"
                            className="kb-documents-folder-link"
                            onClick={() => enterFolder(row.raw as ProjectDocumentFolderRecord)}
                          >
                            <span className="kb-documents-folder-icon-wrap" aria-hidden>
                              <i className="pi pi-folder" />
                            </span>
                            <span className="kb-documents-name-text">{row.name}</span>
                          </button>
                        ) : (
                          <>
                            <span className="kb-documents-file-icon-wrap" aria-hidden>
                              <i className={fileIconClass(row.name)} />
                            </span>
                            <span className="kb-documents-name-text">{row.name}</span>
                          </>
                        )}
                      </div>
                    )}
                  />
                  <Column
                    header="Details"
                    headerClassName="kb-documents-col-details"
                    bodyClassName="kb-documents-col-details"
                    body={(row: (typeof combinedRows)[0]) => {
                      if (row.kind === 'folder') {
                        return <span className="kb-documents-meta-tag">Folder</span>;
                      }
                      const file = row.raw as ProjectDocumentFileRecord;
                      return (
                        <div className="kb-documents-details-cell">
                          <span className="kb-documents-meta-size">{formatFileSize(file.file_size_bytes)}</span>
                          <span className="kb-documents-meta-by">{file.uploader_name}</span>
                        </div>
                      );
                    }}
                  />
                  <Column
                    header="Actions"
                    headerClassName="kb-documents-col-actions"
                    bodyClassName="kb-documents-col-actions"
                    style={{ minWidth: '220px', width: '260px' }}
                    body={(row: (typeof combinedRows)[0]) => (
                      <div className="kb-documents-actions-cell">
                        {row.kind === 'folder' ? (
                          <Button
                            type="button"
                            icon="pi pi-trash"
                            rounded
                            text
                            severity="danger"
                            className="kb-documents-action-btn kb-documents-action-btn--danger"
                            aria-label={`Delete folder ${row.name}`}
                            disabled={busyDelete === `fd-${row.id}`}
                            loading={busyDelete === `fd-${row.id}`}
                            onClick={() => void handleDeleteFolder(row.raw as ProjectDocumentFolderRecord)}
                          />
                        ) : (
                          <div className="kb-documents-file-actions">
                            <Button
                              type="button"
                              icon="pi pi-eye"
                              rounded
                              text
                              className="kb-documents-action-btn"
                              aria-label={`Preview ${row.name}`}
                              disabled={previewBusy === `pv-${row.id}`}
                              loading={previewBusy === `pv-${row.id}`}
                              onClick={() => void handlePreviewFile(row.raw as ProjectDocumentFileRecord)}
                            />
                            <Button
                              type="button"
                              icon="pi pi-download"
                              rounded
                              text
                              className="kb-documents-action-btn"
                              aria-label={`Download ${row.name}`}
                              onClick={() => void handleDownloadFile(row.raw as ProjectDocumentFileRecord)}
                            />
                            <Button
                              type="button"
                              icon="pi pi-trash"
                              rounded
                              text
                              severity="danger"
                              className="kb-documents-action-btn kb-documents-action-btn--danger"
                              aria-label={`Delete ${row.name}`}
                              disabled={busyDelete === `fl-${row.id}`}
                              loading={busyDelete === `fl-${row.id}`}
                              onClick={() => void handleDeleteFile(row.raw as ProjectDocumentFileRecord)}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  />
                </DataTable>
              </div>
            </>
          ) : null}
        </>
      )}

      <Dialog
        header="New folder"
        visible={newFolderOpen}
        onHide={() => !savingFolder && setNewFolderOpen(false)}
        className="project-dialog"
        style={{ width: 'min(92vw, 400px)' }}
        modal
        dismissableMask
        draggable={false}
        footer={
          <div className="kb-documents-dialog-footer">
            <Button type="button" label="Cancel" text onClick={() => setNewFolderOpen(false)} disabled={savingFolder} />
            <Button
              type="button"
              label="Create"
              icon="pi pi-check"
              loading={savingFolder}
              onClick={() => void handleCreateFolder()}
              disabled={!newFolderName.trim()}
            />
          </div>
        }
      >
        <div className="kb-documents-new-folder-field">
          <label htmlFor="kb-new-folder-name">Folder name</label>
          <InputText
            id="kb-new-folder-name"
            className="full-width"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="e.g. Design specs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void handleCreateFolder();
              }
            }}
          />
        </div>
      </Dialog>

      <Dialog
        header="Delete all files in this folder?"
        visible={deleteAllOpen}
        onHide={() => !deletingAll && setDeleteAllOpen(false)}
        className="project-dialog"
        style={{ width: 'min(92vw, 440px)' }}
        modal
        dismissableMask
        draggable={false}
        footer={
          <div className="kb-documents-dialog-footer">
            <Button type="button" label="Cancel" text onClick={() => setDeleteAllOpen(false)} disabled={deletingAll} />
            <Button
              type="button"
              label="Delete all"
              icon="pi pi-trash"
              severity="danger"
              loading={deletingAll}
              onClick={() => void handleDeleteAllFiles()}
            />
          </div>
        }
      >
        <p className="kb-documents-delete-all-msg">
          This will permanently remove <strong>{files.length}</strong> file{files.length === 1 ? '' : 's'} in the current
          folder. Folders are not deleted. This cannot be undone.
        </p>
      </Dialog>

      <Dialog
        header={viewer?.filename ?? 'Preview'}
        visible={viewer !== null}
        onHide={closeAttachmentViewer}
        className="calendar-attachment-viewer-dialog"
        style={{ width: 'min(96vw, 960px)' }}
        contentStyle={{ padding: 0, overflow: 'hidden' }}
        modal
        dismissableMask
        draggable={false}
        appendTo={typeof document !== 'undefined' ? document.body : undefined}
        footer={
          viewer ? (
            <div className="calendar-attachment-viewer-footer">
              <Button
                type="button"
                label="Download"
                icon="pi pi-download"
                outlined
                onClick={() =>
                  void downloadProjectDocumentFile(viewer.projectId, viewer.fileId, viewer.filename)
                }
              />
              <Button type="button" label="Close" icon="pi pi-times" onClick={closeAttachmentViewer} />
            </div>
          ) : null
        }
      >
        {viewer ? (
          <div className="calendar-attachment-viewer-shell">
            {isPdfMime(viewer.mimeType, viewer.filename) ? (
              <iframe title={viewer.filename} src={viewer.objectUrl} className="calendar-attachment-viewer-frame" />
            ) : isImageMime(viewer.mimeType, viewer.filename) ? (
              <img src={viewer.objectUrl} alt="" className="calendar-attachment-viewer-img" />
            ) : isTextMime(viewer.mimeType) ? (
              <iframe title={viewer.filename} src={viewer.objectUrl} className="calendar-attachment-viewer-frame" />
            ) : (
              <div className="calendar-attachment-viewer-fallback">
                <p>
                  {viewer.filename.toLowerCase().endsWith('.docx') || viewer.mimeType.includes('wordprocessing')
                    ? 'Word documents (.docx) cannot be previewed in the browser. Download the file to open it in Word or another app.'
                    : 'Inline preview is not available for this file type.'}
                </p>
                <Button
                  type="button"
                  label="Download"
                  icon="pi pi-download"
                  onClick={() =>
                    void downloadProjectDocumentFile(viewer.projectId, viewer.fileId, viewer.filename)
                  }
                />
              </div>
            )}
          </div>
        ) : null}
      </Dialog>
    </motion.article>
  );
}
