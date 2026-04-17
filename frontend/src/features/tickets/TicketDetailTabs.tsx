import { Button } from 'primereact/button';
import { Checkbox } from 'primereact/checkbox';
import { InputTextarea } from 'primereact/inputtextarea';
import { TabPanel, TabView } from 'primereact/tabview';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  downloadTicketAttachmentFile,
  getTicketAttachmentsRequest,
  getTicketCommentsRequest,
  getTicketHistoryRequest,
  getTicketResolutionRequest,
  postTicketCommentRequest,
  putTicketResolutionRequest,
  uploadTicketAttachmentRequest,
  type ResolutionRecord,
  type ResolutionUpsertPayload,
  type TicketCommentRecord,
  type TicketHistoryRecord,
  type TicketRecord,
} from '../../lib/api';

function humanize(s: string): string {
  return s.replace(/_/g, ' ');
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

type TicketDetailTabsProps = {
  viewKey: string;
  ticket: TicketRecord;
  canPostInternalNotes: boolean;
  onThreadChanged: () => void;
};

export function TicketDetailTabs({ viewKey, ticket, canPostInternalNotes, onThreadChanged }: TicketDetailTabsProps) {
  const [tabIndex, setTabIndex] = useState(0);
  const [comments, setComments] = useState<TicketCommentRecord[]>([]);
  const [history, setHistory] = useState<TicketHistoryRecord[]>([]);
  const [attachments, setAttachments] = useState<Awaited<ReturnType<typeof getTicketAttachmentsRequest>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [newComment, setNewComment] = useState('');
  const [internalNote, setInternalNote] = useState(false);
  const [posting, setPosting] = useState(false);

  const [resolutionSummary, setResolutionSummary] = useState('');
  const [resolutionRootCause, setResolutionRootCause] = useState('');
  const [resolutionSteps, setResolutionSteps] = useState('');
  const [resolutionInfo, setResolutionInfo] = useState<ResolutionRecord | null>(null);
  const [resolutionSaving, setResolutionSaving] = useState(false);
  const [resolutionLoaded, setResolutionLoaded] = useState(false);

  const [uploadBusy, setUploadBusy] = useState(false);

  const reloadThread = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [c, h, a, r] = await Promise.all([
        getTicketCommentsRequest(ticket.id),
        getTicketHistoryRequest(ticket.id),
        getTicketAttachmentsRequest(ticket.id),
        getTicketResolutionRequest(ticket.id),
      ]);
      setComments(c);
      setHistory(h);
      setAttachments(a);
      if (r) {
        setResolutionInfo(r);
        setResolutionSummary(r.summary);
        setResolutionRootCause(r.root_cause ?? '');
        setResolutionSteps(r.steps_taken ?? '');
      } else {
        setResolutionInfo(null);
        setResolutionSummary('');
        setResolutionRootCause('');
        setResolutionSteps('');
      }
      setResolutionLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load ticket details');
    } finally {
      setLoading(false);
    }
  }, [ticket.id]);

  useEffect(() => {
    setTabIndex(0);
    setNewComment('');
    setInternalNote(false);
    setResolutionLoaded(false);
    void reloadThread();
  }, [ticket.id, reloadThread]);

  async function handlePostComment() {
    const body = newComment.trim();
    if (!body) {
      return;
    }
    setPosting(true);
    try {
      await postTicketCommentRequest(ticket.id, {
        body,
        is_internal: canPostInternalNotes && internalNote,
      });
      setNewComment('');
      setInternalNote(false);
      await reloadThread();
      onThreadChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post comment');
    } finally {
      setPosting(false);
    }
  }

  async function handleSaveResolution() {
    if (!resolutionSummary.trim()) {
      setError('Resolution summary is required.');
      return;
    }
    setResolutionSaving(true);
    setError('');
    try {
      const payload: ResolutionUpsertPayload = {
        summary: resolutionSummary.trim(),
        root_cause: resolutionRootCause.trim() || null,
        steps_taken: resolutionSteps.trim() || null,
        kb_article_id: null,
      };
      await putTicketResolutionRequest(ticket.id, payload);
      await reloadThread();
      onThreadChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save resolution');
    } finally {
      setResolutionSaving(false);
    }
  }

  async function handleUploadFile(file: File | null) {
    if (!file) {
      return;
    }
    setUploadBusy(true);
    setError('');
    try {
      await uploadTicketAttachmentRequest(ticket.id, file);
      await reloadThread();
      onThreadChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleDownload(attId: string, filename: string) {
    try {
      await downloadTicketAttachmentFile(ticket.id, attId, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  }

  type TimelineItem = {
    id: string;
    at: string;
    title: string;
    subtitle?: string;
    actor?: string;
    kind: 'comment' | 'history' | 'attachment' | 'resolution' | 'created';
    meta?: { attachmentId?: string; attachmentName?: string };
  };

  const timelineItems = useMemo(() => {
    const items: TimelineItem[] = [
      {
        id: `created-${ticket.id}`,
        at: ticket.created_at,
        title: 'Ticket created',
        subtitle: ticket.title,
        actor: ticket.created_by_name ?? 'Requester',
        kind: 'created',
      },
      ...comments.map((c) => ({
        id: `comment-${c.id}`,
        at: c.created_at,
        title: c.is_internal ? 'Internal note added' : 'Comment added',
        subtitle: c.body,
        actor: c.author_name,
        kind: 'comment' as const,
      })),
      ...history.map((h) => ({
        id: `history-${h.id}`,
        at: h.created_at,
        title: `${humanize(h.field_name)} changed`,
        subtitle: `${h.old_value ?? '—'} -> ${h.new_value ?? '—'}`,
        actor: h.changer_name,
        kind: 'history' as const,
      })),
      ...attachments.map((a) => ({
        id: `attachment-${a.id}`,
        at: a.created_at,
        title: 'Attachment uploaded',
        subtitle: `${a.filename} (${(a.file_size_bytes / 1024).toFixed(1)} KB)`,
        actor: a.uploader_name,
        kind: 'attachment' as const,
        meta: { attachmentId: a.id, attachmentName: a.filename },
      })),
    ];
    if (resolutionInfo) {
      items.push({
        id: `resolution-${resolutionInfo.id}`,
        at: resolutionInfo.updated_at || resolutionInfo.created_at,
        title: 'Resolution updated',
        subtitle: resolutionInfo.summary,
        actor: resolutionInfo.resolver_name,
        kind: 'resolution',
      });
    }
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [ticket, comments, history, attachments, resolutionInfo]);

  return (
    <div className="ticket-detail-tabs">
      {error ? <p className="error-text ticket-detail-tabs-error">{error}</p> : null}

      <TabView
        activeIndex={tabIndex}
        onTabChange={(e) => setTabIndex(e.index)}
        className="ticket-detail-tabview"
      >
        <TabPanel header="Conversation">
          <div className="ticket-conv-thread">
            {loading ? (
              <p className="ticket-detail-muted">Loading…</p>
            ) : (
              <>
                <div className="ticket-conv-bubble ticket-conv-bubble--orig">
                  <div className="ticket-conv-bubble-head">
                    <span className="ticket-conv-author">{ticket.created_by_name ?? 'Requester'}</span>
                    <span className="ticket-conv-time">{formatWhen(ticket.created_at)}</span>
                  </div>
                  <p className="ticket-conv-body">{ticket.description?.trim() || '—'}</p>
                </div>
                {comments.map((c) => (
                  <div
                    key={c.id}
                    className={`ticket-conv-bubble ${c.is_internal ? 'ticket-conv-bubble--internal' : ''}`}
                  >
                    <div className="ticket-conv-bubble-head">
                      <span className="ticket-conv-author">{c.author_name}</span>
                      {c.is_internal ? <span className="ticket-conv-internal">Internal</span> : null}
                      <span className="ticket-conv-time">{formatWhen(c.created_at)}</span>
                    </div>
                    <p className="ticket-conv-body">{c.body}</p>
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="ticket-conv-reply">
            <textarea
              id={`ticket-reply-${viewKey}`}
              className="ticket-conv-reply-input"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write a reply…"
              rows={3}
              maxLength={8000}
            />
            {canPostInternalNotes ? (
              <label className="ticket-conv-internal-check">
                <Checkbox
                  inputId={`ticket-internal-${viewKey}`}
                  checked={internalNote}
                  onChange={(e) => setInternalNote(Boolean(e.checked))}
                />
                <span>Internal note</span>
              </label>
            ) : null}
            <Button
              type="button"
              label={posting ? 'Sending…' : 'Post'}
              icon="pi pi-send"
              disabled={posting || !newComment.trim()}
              onClick={() => void handlePostComment()}
            />
          </div>
        </TabPanel>

        <TabPanel header="Resolution">
          {loading && !resolutionLoaded ? (
            <p className="ticket-detail-muted">Loading…</p>
          ) : (
            <div className="ticket-resolution-form">
              <label className="ticket-form-label" htmlFor={`res-sum-${viewKey}`}>
                Summary
              </label>
              <InputTextarea
                id={`res-sum-${viewKey}`}
                value={resolutionSummary}
                onChange={(e) => setResolutionSummary(e.target.value)}
                rows={3}
                className="full-width ticket-form-textarea"
              />
              <label className="ticket-form-label" htmlFor={`res-root-${viewKey}`}>
                Root cause
              </label>
              <InputTextarea
                id={`res-root-${viewKey}`}
                value={resolutionRootCause}
                onChange={(e) => setResolutionRootCause(e.target.value)}
                rows={3}
                className="full-width ticket-form-textarea"
              />
              <label className="ticket-form-label" htmlFor={`res-steps-${viewKey}`}>
                Steps taken
              </label>
              <InputTextarea
                id={`res-steps-${viewKey}`}
                value={resolutionSteps}
                onChange={(e) => setResolutionSteps(e.target.value)}
                rows={4}
                className="full-width ticket-form-textarea"
              />
              <div className="ticket-detail-actions ticket-resolution-actions">
                <Button
                  type="button"
                  label={resolutionSaving ? 'Saving…' : 'Save resolution'}
                  icon="pi pi-check"
                  disabled={resolutionSaving}
                  onClick={() => void handleSaveResolution()}
                />
              </div>
            </div>
          )}
        </TabPanel>

        <TabPanel header="Attachments">
          {loading ? (
            <p className="ticket-detail-muted">Loading…</p>
          ) : (
            <div className="ticket-attachments">
              <div className="ticket-attachments-upload">
                <input
                  type="file"
                  id={`ticket-file-${viewKey}`}
                  className="ticket-file-input"
                  disabled={uploadBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    void handleUploadFile(f ?? null);
                    e.target.value = '';
                  }}
                />
                <label htmlFor={`ticket-file-${viewKey}`} className="ticket-file-label">
                  {uploadBusy ? 'Uploading…' : 'Choose file (max 15MB)'}
                </label>
              </div>
              <ul className="ticket-attachments-list">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="ticket-attachment-link"
                      onClick={() => void handleDownload(a.id, a.filename)}
                    >
                      {a.filename}
                    </button>
                    <span className="ticket-attachment-meta">
                      {a.uploader_name} · {(a.file_size_bytes / 1024).toFixed(1)} KB
                    </span>
                  </li>
                ))}
              </ul>
              {attachments.length === 0 ? <p className="ticket-detail-muted">No attachments yet.</p> : null}
            </div>
          )}
        </TabPanel>

        <TabPanel header="History">
          {loading ? (
            <p className="ticket-detail-muted">Loading…</p>
          ) : (
            <div className="ticket-history-timeline">
              {timelineItems.map((item) => (
                <article key={item.id} className={`ticket-timeline-item ticket-timeline-item--${item.kind}`}>
                  <div className="ticket-timeline-dot" />
                  <div className="ticket-timeline-content">
                    <header className="ticket-timeline-head">
                      <strong>{item.title}</strong>
                      <span>{formatWhen(item.at)}</span>
                    </header>
                    {item.actor ? <p className="ticket-timeline-actor">{item.actor}</p> : null}
                    {item.subtitle ? <p className="ticket-timeline-subtitle">{item.subtitle}</p> : null}
                    {item.kind === 'attachment' && item.meta?.attachmentId && item.meta?.attachmentName ? (
                      <Button
                        type="button"
                        label="Download attachment"
                        text
                        size="small"
                        icon="pi pi-download"
                        onClick={() => void handleDownload(item.meta!.attachmentId!, item.meta!.attachmentName!)}
                      />
                    ) : null}
                  </div>
                </article>
              ))}
              {timelineItems.length === 0 ? <p className="ticket-detail-muted">No timeline events yet.</p> : null}
            </div>
          )}
        </TabPanel>
      </TabView>
    </div>
  );
}
