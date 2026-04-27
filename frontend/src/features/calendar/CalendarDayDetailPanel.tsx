import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { ProgressBar } from 'primereact/progressbar';
import { Tag } from 'primereact/tag';
import { Toast } from 'primereact/toast';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  deleteEventAttachmentRequest,
  downloadEventAttachmentFile,
  getEventAttachmentBlobRequest,
  uploadEventAttachmentRequest,
  type CalendarEventRecord,
} from '../../lib/api';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
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

type ViewerState = {
  objectUrl: string;
  filename: string;
  mimeType: string;
  eventId: string;
  attachmentId: string;
};

function statusSeverity(s: string): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
  switch (s) {
    case 'completed':
      return 'success';
    case 'in_progress':
      return 'info';
    case 'on_hold':
      return 'warning';
    case 'cancelled':
      return 'danger';
    default:
      return 'secondary';
  }
}

type CalendarDayDetailPanelProps = {
  selectedDate: Date | null;
  dayEvents: CalendarEventRecord[];
  isLoading: boolean;
  canCreateEvents: boolean;
  canManageEvents: boolean;
  focusedEventId: string | null;
  milestoneBusy: string | null;
  onClose: () => void;
  onToggleMilestone: (eventId: string, milestoneId: string, completed: boolean) => Promise<void>;
  /** Shown on empty day when user can add events (e.g. team lead / admin). */
  onAddActivity?: () => void;
  /** Refresh calendar data after attachment upload/delete. */
  onAttachmentsChanged?: () => void;
};

export function CalendarDayDetailPanel({
  selectedDate,
  dayEvents,
  isLoading,
  canCreateEvents,
  canManageEvents,
  focusedEventId,
  milestoneBusy,
  onClose,
  onToggleMilestone,
  onAddActivity,
  onAttachmentsChanged,
}: CalendarDayDetailPanelProps) {
  const focusRef = useRef<HTMLDivElement | null>(null);
  const reportFileInputRef = useRef<HTMLInputElement | null>(null);
  const toastRef = useRef<Toast>(null);
  const [uploadTargetEventId, setUploadTargetEventId] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState<string | null>(null);
  const [viewBusy, setViewBusy] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const viewerBlobUrlRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (!focusedEventId || !focusRef.current) {
      return;
    }
    const el = focusRef.current.querySelector(`[data-event-id="${focusedEventId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedEventId, selectedDate, dayEvents]);

  function openReportPicker(eventId: string) {
    setReportError(null);
    setUploadTargetEventId(eventId);
    reportFileInputRef.current?.click();
  }

  async function handleReportFileChange(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    const eventId = uploadTargetEventId;
    ev.target.value = '';
    if (!file || !eventId) {
      setUploadTargetEventId(null);
      return;
    }
    const busyKey = `up-${eventId}`;
    setAttachmentBusy(busyKey);
    setReportError(null);
    try {
      await uploadEventAttachmentRequest(eventId, file);
      onAttachmentsChanged?.();
      toastRef.current?.show({
        severity: 'success',
        summary: 'Report attached',
        detail: `${file.name} was added to this activity.`,
        life: 4500,
      });
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'Could not upload file');
    } finally {
      setAttachmentBusy(null);
      setUploadTargetEventId(null);
    }
  }

  async function handleDeleteReport(eventId: string, attachmentId: string) {
    const busyKey = `del-${eventId}-${attachmentId}`;
    setAttachmentBusy(busyKey);
    setReportError(null);
    try {
      await deleteEventAttachmentRequest(eventId, attachmentId);
      onAttachmentsChanged?.();
      toastRef.current?.show({
        severity: 'success',
        summary: 'Report removed',
        detail: 'The attachment was deleted from this activity.',
        life: 4000,
      });
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'Could not remove file');
    } finally {
      setAttachmentBusy(null);
    }
  }

  async function handleViewReport(
    eventId: string,
    attachmentId: string,
    serverMime: string,
    filename: string,
  ) {
    const key = `view-${eventId}-${attachmentId}`;
    setViewBusy(key);
    setReportError(null);
    try {
      revokeViewerBlobUrl();
      const blob = await getEventAttachmentBlobRequest(eventId, attachmentId);
      const mimeType = (blob.type || serverMime || '').trim() || 'application/octet-stream';
      const url = URL.createObjectURL(blob);
      viewerBlobUrlRef.current = url;
      setViewer({
        objectUrl: url,
        filename,
        mimeType,
        eventId,
        attachmentId,
      });
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'Could not open file');
    } finally {
      setViewBusy(null);
    }
  }

  return (
    <div className="calendar-detail-panel-inner" ref={focusRef}>
      <Toast ref={toastRef} position="top-center" />
      <Dialog
        header={viewer?.filename ?? 'Report'}
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
                  void downloadEventAttachmentFile(viewer.eventId, viewer.attachmentId, viewer.filename)
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
              <iframe
                title={viewer.filename}
                src={viewer.objectUrl}
                className="calendar-attachment-viewer-frame"
              />
            ) : isImageMime(viewer.mimeType, viewer.filename) ? (
              <img src={viewer.objectUrl} alt="" className="calendar-attachment-viewer-img" />
            ) : isTextMime(viewer.mimeType) ? (
              <iframe title={viewer.filename} src={viewer.objectUrl} className="calendar-attachment-viewer-frame" />
            ) : (
              <div className="calendar-attachment-viewer-fallback">
                <p>Inline preview is not available for this file type.</p>
                <Button
                  type="button"
                  label="Download"
                  icon="pi pi-download"
                  onClick={() =>
                    void downloadEventAttachmentFile(viewer.eventId, viewer.attachmentId, viewer.filename)
                  }
                />
              </div>
            )}
          </div>
        ) : null}
      </Dialog>
      <input
        ref={reportFileInputRef}
        type="file"
        className="calendar-event-report-file-input"
        aria-hidden
        tabIndex={-1}
        onChange={handleReportFileChange}
      />

      <div className="calendar-detail-panel-head">
        <div>
          <h2 className="calendar-detail-panel-title">Day details</h2>
          {selectedDate ? (
            <p className="calendar-detail-panel-date">
              {selectedDate.toLocaleString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          ) : (
            <p className="calendar-detail-panel-hint">Choose a date on the calendar</p>
          )}
        </div>
        {selectedDate ? (
          <Button type="button" icon="pi pi-times" rounded text aria-label="Clear selection" onClick={onClose} />
        ) : null}
      </div>

      <div className="calendar-detail-panel-body">
        {isLoading ? <p className="calendar-detail-empty">Loading events…</p> : null}
        {reportError ? <p className="calendar-event-report-error">{reportError}</p> : null}
        {!isLoading && selectedDate && dayEvents.length > 0 ? (
          <div className="calendar-event-list calendar-event-list--panel">
            {dayEvents.map((ev) => {
              const attachments = ev.attachments ?? [];
              const uploadBusy = attachmentBusy === `up-${ev.id}`;
              return (
                <div key={ev.id} className="calendar-event-card" data-event-id={ev.id}>
                  <div className="calendar-event-card-top">
                    <div>
                      <span className="calendar-event-time">
                        {formatTime(ev.start_at)}
                        {ev.end_at ? ` – ${formatTime(ev.end_at)}` : ''}
                      </span>
                      <h4 className="calendar-event-title">{ev.title}</h4>
                      {ev.project_name ? (
                        <span className="calendar-event-project">
                          <i className="pi pi-folder" aria-hidden />
                          {ev.project_name}
                        </span>
                      ) : null}
                    </div>
                    <div className="calendar-event-tags">
                      <Tag value={ev.event_type.replace(/_/g, ' ')} severity="info" />
                      <Tag value={ev.status.replace(/_/g, ' ')} severity={statusSeverity(ev.status)} />
                    </div>
                  </div>
                  {ev.description ? <p className="calendar-event-desc">{ev.description}</p> : null}
                  {ev.progress_percent !== null && ev.progress_percent !== undefined ? (
                    <div className="calendar-event-progress">
                      <span className="calendar-event-progress-label">Tracking</span>
                      <ProgressBar value={ev.progress_percent} showValue />
                    </div>
                  ) : null}
                  {ev.milestones.length > 0 ? (
                    <ul className="calendar-event-milestones">
                      {ev.milestones.map((m) => {
                        const done = Boolean(m.completed_at);
                        const busy = milestoneBusy === `${ev.id}-${m.id}`;
                        return (
                          <li key={m.id} className={done ? 'calendar-ms-done' : ''}>
                            <label className="calendar-ms-row">
                              {canManageEvents ? (
                                <input
                                  type="checkbox"
                                  checked={done}
                                  disabled={busy}
                                  onChange={async (e) => {
                                    const checked = e.target.checked;
                                    const attCount = (ev.attachments ?? []).length;
                                    try {
                                      await onToggleMilestone(ev.id, m.id, checked);
                                      const detail =
                                        checked && attCount > 0
                                          ? 'Milestone saved — your report is attached.'
                                          : checked
                                            ? 'Milestone saved. You can attach a report below when ready.'
                                            : 'You can mark this milestone complete again when ready.';
                                      toastRef.current?.show({
                                        severity: 'success',
                                        summary: checked ? 'Milestone updated' : 'Milestone reopened',
                                        detail,
                                        life: 4500,
                                      });
                                    } catch (err) {
                                      toastRef.current?.show({
                                        severity: 'error',
                                        summary: 'Could not update milestone',
                                        detail: err instanceof Error ? err.message : 'Request failed',
                                        life: 5000,
                                      });
                                    }
                                  }}
                                />
                              ) : (
                                <span className="calendar-ms-dot" aria-hidden />
                              )}
                              <span className="calendar-ms-title">{m.title}</span>
                              {m.target_date ? (
                                <span className="calendar-ms-date">
                                  {new Date(m.target_date + 'T12:00:00').toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </span>
                              ) : null}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}

                  <div className="calendar-event-reports">
                    <div className="calendar-event-reports-head">
                      <span className="calendar-event-reports-title">
                        <i className="pi pi-paperclip" aria-hidden />
                        Reports
                      </span>
                      {canManageEvents ? (
                        <Button
                          type="button"
                          label="Attach report"
                          icon="pi pi-upload"
                          size="small"
                          className="calendar-event-attach-btn"
                          disabled={uploadBusy}
                          loading={uploadBusy}
                          onClick={() => openReportPicker(ev.id)}
                        />
                      ) : null}
                    </div>
                    {attachments.length === 0 ? (
                      <p className="calendar-event-reports-empty">No reports attached yet.</p>
                    ) : (
                      <ul className="calendar-event-reports-list">
                        {attachments.map((a) => {
                          const delBusy = attachmentBusy === `del-${ev.id}-${a.id}`;
                          const viewKey = `view-${ev.id}-${a.id}`;
                          const viewing = viewBusy === viewKey;
                          return (
                            <li key={a.id} className="calendar-event-report-row">
                              <div className="calendar-event-report-file">
                                <i className="pi pi-file" aria-hidden />
                                <div className="calendar-event-report-text">
                                  <span className="calendar-event-report-name">{a.filename}</span>
                                  <span className="calendar-event-report-meta">
                                    {formatFileSize(a.file_size_bytes)} · {a.uploader_name}
                                  </span>
                                </div>
                              </div>
                              <div className="calendar-event-report-actions">
                                <Button
                                  type="button"
                                  label="View"
                                  icon="pi pi-eye"
                                  size="small"
                                  className="calendar-event-report-view-btn"
                                  disabled={viewing}
                                  loading={viewing}
                                  aria-label={`View ${a.filename}`}
                                  onClick={() => void handleViewReport(ev.id, a.id, a.mime_type, a.filename)}
                                />
                                <Button
                                  type="button"
                                  label="Download"
                                  icon="pi pi-download"
                                  size="small"
                                  outlined
                                  className="calendar-event-report-dl-btn"
                                  aria-label={`Download ${a.filename}`}
                                  onClick={() =>
                                    void downloadEventAttachmentFile(ev.id, a.id, a.filename).catch((err) =>
                                      setReportError(err instanceof Error ? err.message : 'Download failed'),
                                    )
                                  }
                                />
                                {canManageEvents ? (
                                  <Button
                                    type="button"
                                    icon="pi pi-trash"
                                    rounded
                                    text
                                    severity="danger"
                                    className="calendar-event-report-delete"
                                    disabled={delBusy}
                                    loading={delBusy}
                                    aria-label={`Remove ${a.filename}`}
                                    onClick={() => void handleDeleteReport(ev.id, a.id)}
                                  />
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {!isLoading && selectedDate && dayEvents.length === 0 ? (
          <div className="calendar-detail-panel-empty">
            <i className="pi pi-calendar-plus" aria-hidden />
            <p>No activities scheduled for this day.</p>
            {canCreateEvents && onAddActivity ? (
              <Button
                type="button"
                label="Add activity"
                icon="pi pi-plus"
                className="calendar-day-add-activity-btn"
                onClick={onAddActivity}
              />
            ) : null}
          </div>
        ) : null}
        {!isLoading && !selectedDate ? (
          <div className="calendar-detail-panel-empty">
            <i className="pi pi-arrow-left" aria-hidden />
            <p>Click a day to see activities, milestones, and tracking.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
