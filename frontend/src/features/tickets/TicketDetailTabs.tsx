import { Button } from 'primereact/button';
import { Checkbox } from 'primereact/checkbox';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { Editor } from 'primereact/editor';
import { TabPanel, TabView } from 'primereact/tabview';
import { AnimatePresence, motion } from 'framer-motion';
import EmojiPicker, { Emoji, EmojiStyle, Theme, type EmojiClickData } from 'emoji-picker-react';
import { Pencil, Smile, SmilePlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getTicketAttachmentBlobRequest,
  downloadTicketAttachmentFile,
  getTicketAttachmentsRequest,
  getTicketCommentsRequest,
  getTicketCyclesRequest,
  getTicketHistoryRequest,
  getTicketRootReactionsRequest,
  getTicketResolutionRequest,
  patchTicketCommentRequest,
  postTicketCommentRequest,
  toggleTicketCommentReactionRequest,
  toggleTicketRootReactionRequest,
  putTicketResolutionRequest,
  uploadTicketAttachmentRequest,
  type ResolutionRecord,
  type ResolutionUpsertPayload,
  type TicketCycleRecord,
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

function plainTextFromHtml(html: string): string {
  return html
    .replace(/<span[^>]*data-emoji-image="true"[^>]*>(.*?)<\/span>/gi, ' $1 ')
    .replace(/<img[^>]*data-emoji-image="true"[^>]*alt="([^"]*)"[^>]*>/gi, ' $1 ')
    .replace(/<img[^>]*data-emoji-image="true"[^>]*alt="([^"]*)"[^>]*>/gi, ' $1 ')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, ' $1 ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toDisplayHtml(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return '—';
  }
  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    return trimmed;
  }
  return escapeHtml(content).replaceAll('\n', '<br/>');
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) {
    return 'U';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function cycleStatusLabel(status: string, versionNo?: number): string {
  const normalized = status.toLowerCase().trim();
  if (normalized === 'open') {
    return versionNo && versionNo > 1 ? 'Reopened' : 'Open';
  }
  return humanize(normalized);
}

const resolutionEditorHeaderTemplate = (
  <>
    <span className="ql-formats">
      <select className="ql-size" defaultValue="" title="Font size">
        <option value="">Normal</option>
        <option value="large">Large</option>
        <option value="huge">Huge</option>
      </select>
      <select className="ql-color" defaultValue="" title="Text color">
        <option value="" />
        <option value="#000000" />
        <option value="#e60000" />
        <option value="#ff9900" />
        <option value="#ffff00" />
        <option value="#008a00" />
        <option value="#0066cc" />
        <option value="#9933ff" />
      </select>
      <select className="ql-background" defaultValue="" title="Highlight color">
        <option value="" />
        <option value="#ffffff" />
        <option value="#fff2cc" />
        <option value="#fde68a" />
        <option value="#d1fae5" />
        <option value="#dbeafe" />
        <option value="#fce7f3" />
      </select>
    </span>
    <span className="ql-formats">
      <button className="ql-bold" aria-label="Bold" />
      <button className="ql-italic" aria-label="Italic" />
      <button className="ql-underline" aria-label="Underline" />
    </span>
    <span className="ql-formats">
      <button className="ql-list" value="ordered" aria-label="Numbered list" />
      <button className="ql-list" value="bullet" aria-label="Bullet list" />
      <button className="ql-link" aria-label="Insert link" />
      <button className="ql-clean" aria-label="Clear formatting" />
    </span>
  </>
);

const QUICK_REACTIONS = [
  { emoji: '👍', unified: '1f44d' },
  { emoji: '❤️', unified: '2764-fe0f' },
  { emoji: '😂', unified: '1f602' },
  { emoji: '😮', unified: '1f62e' },
  { emoji: '👏', unified: '1f44f' },
];

function emojiToUnified(emoji: string): string {
  return Array.from(emoji)
    .map((char) => char.codePointAt(0)?.toString(16))
    .filter((value): value is string => Boolean(value))
    .join('-');
}

type TicketDetailTabsProps = {
  viewKey: string;
  ticket: TicketRecord;
  currentUserId?: string;
  canPostInternalNotes: boolean;
  onThreadChanged: () => void;
  showApprovalAction?: boolean;
  approvalRequested?: boolean;
  onRequestApproval?: () => void;
};

export function TicketDetailTabs({
  viewKey,
  ticket,
  currentUserId,
  canPostInternalNotes,
  onThreadChanged,
  showApprovalAction = false,
  approvalRequested = false,
  onRequestApproval,
}: TicketDetailTabsProps) {
  const ticketClosed = ticket.status === 'closed';

  const [tabIndex, setTabIndex] = useState(0);
  const [cycles, setCycles] = useState<TicketCycleRecord[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(ticket.current_cycle_id ?? null);
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState<Record<string, string>>({});
  const [mediaPreview, setMediaPreview] = useState<{ kind: 'image' | 'video'; url: string; name: string; attachmentId: string } | null>(null);
  const [reactionsByItem, setReactionsByItem] = useState<
    Record<string, Array<{ emoji: string; count: number; reacted_by_me: boolean; reacted_by_names?: string[] }>>
  >({});
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [expandedReactionId, setExpandedReactionId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentHtml, setEditingCommentHtml] = useState('');
  const [savingCommentEdit, setSavingCommentEdit] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const composerEditorRef = useRef<Editor | null>(null);
  const editEditorRef = useRef<Editor | null>(null);

  const selectedCycle = useMemo(
    () => cycles.find((cycle) => cycle.id === selectedCycleId) ?? null,
    [cycles, selectedCycleId],
  );

  const cycleOptions = useMemo(
    () =>
      cycles.map((cycle) => ({
        label: `V${cycle.version_no} • ${cycleStatusLabel(cycle.status, cycle.version_no)}`,
        value: cycle.id,
        version: cycle.version_no,
        statusLabel: cycleStatusLabel(cycle.status, cycle.version_no),
        statusKey: String(cycle.status ?? '').toLowerCase().replace(/\s+/g, '_'),
      })),
    [cycles],
  );

  const reloadThread = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [cycleRows, c, h, a, r] = await Promise.all([
        getTicketCyclesRequest(ticket.id),
        getTicketCommentsRequest(ticket.id, selectedCycleId ?? undefined),
        getTicketHistoryRequest(ticket.id),
        getTicketAttachmentsRequest(ticket.id, selectedCycleId ?? undefined),
        getTicketResolutionRequest(ticket.id, selectedCycleId ?? undefined),
      ]);
      setCycles(cycleRows);
      if (!selectedCycleId && cycleRows.length) {
        const defaultCycle = ticket.current_cycle_id ?? cycleRows[0].id;
        setSelectedCycleId(defaultCycle);
      }
      setComments(c);
      setReactionsByItem(() =>
        Object.fromEntries([
          [`orig-${ticket.id}`, [] as Array<{ emoji: string; count: number; reacted_by_me: boolean; reacted_by_names?: string[] }>],
          ...c.map((comment) => [`comment-${comment.id}`, comment.reactions ?? []]),
        ]),
      );
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
      try {
        const rootReactions = await getTicketRootReactionsRequest(ticket.id);
        setReactionsByItem((current) => ({ ...current, [`orig-${ticket.id}`]: rootReactions }));
      } catch {
        // Root reactions are optional for older servers; keep normal thread loading intact.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load ticket details');
    } finally {
      setLoading(false);
    }
  }, [ticket.id, ticket.current_cycle_id, selectedCycleId]);

  useEffect(() => {
    setTabIndex(0);
    setNewComment('');
    setInternalNote(false);
    setResolutionLoaded(false);
    setSelectedCycleId(ticket.current_cycle_id ?? null);
    void reloadThread();
  }, [ticket.id, ticket.current_cycle_id, reloadThread]);

  useEffect(() => {
    if (!selectedCycleId) {
      return;
    }
    void reloadThread();
  }, [selectedCycleId, reloadThread]);

  useEffect(() => {
    return () => {
      Object.values(attachmentPreviewUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachmentPreviewUrls]);

  useEffect(() => {
    setEditingCommentId(null);
    setEditingCommentHtml('');
    setSavingCommentEdit(false);
    setIsEmojiPickerOpen(false);
  }, [ticket.id, selectedCycleId]);

  const conversationEditorHeaderTemplate = useMemo(
    () => (
      <>
        <span className="ql-formats">
          <button className="ql-bold" aria-label="Bold" />
          <button className="ql-italic" aria-label="Italic" />
          <button className="ql-underline" aria-label="Underline" />
          <button
            type="button"
            className="ticket-editor-emoji-btn ql-emoji"
            aria-label="Insert emoji"
            title="Emoji"
            onClick={(event) => {
              event.preventDefault();
              setIsEmojiPickerOpen((current) => !current);
            }}
          >
            <Smile size={17} strokeWidth={2.35} />
          </button>
        </span>
        <span className="ql-formats">
          <button className="ql-list" value="ordered" aria-label="Numbered list" />
          <button className="ql-list" value="bullet" aria-label="Bullet list" />
          <button className="ql-link" aria-label="Insert link" />
          <button className="ql-clean" aria-label="Clear formatting" />
        </span>
      </>
    ),
    [],
  );

  useEffect(() => {
    const media = attachments.filter(
      (a) =>
        Boolean(a.comment_id) &&
        (a.mime_type.startsWith('image/') || a.mime_type.startsWith('video/')) &&
        !attachmentPreviewUrls[a.id],
    );
    if (!media.length) {
      return;
    }
    let cancelled = false;
    (async () => {
      const entries: Array<[string, string]> = [];
      for (const a of media) {
        try {
          const blob = await getTicketAttachmentBlobRequest(ticket.id, a.id);
          entries.push([a.id, URL.createObjectURL(blob)]);
        } catch {
          // Preview is optional; keep fallback download pill.
        }
      }
      if (cancelled || !entries.length) {
        return;
      }
      setAttachmentPreviewUrls((current) => {
        const next = { ...current };
        for (const [id, url] of entries) {
          next[id] = url;
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [attachments, attachmentPreviewUrls, ticket.id]);

  async function handlePostComment() {
    if (ticketClosed) {
      return;
    }
    const body = newComment;
    const plain = plainTextFromHtml(body);
    if (!plain && pendingFiles.length === 0) {
      return;
    }
    setPosting(true);
    setUploadBusy(true);
    try {
      const created = await postTicketCommentRequest(ticket.id, {
        body: plain ? body : 'Shared attachment',
        is_internal: canPostInternalNotes && internalNote,
      }, { cycle_id: selectedCycleId ?? undefined });
      for (const file of pendingFiles) {
        await uploadTicketAttachmentRequest(ticket.id, file, created.id, { cycle_id: selectedCycleId ?? undefined });
      }
      setNewComment('');
      setInternalNote(false);
      setPendingFiles([]);
      setIsEmojiPickerOpen(false);
      await reloadThread();
      onThreadChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post comment');
    } finally {
      setUploadBusy(false);
      setPosting(false);
    }
  }

  async function handleSaveResolution() {
    if (ticketClosed) {
      return;
    }
    if (!plainTextFromHtml(resolutionSummary).trim()) {
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
      await putTicketResolutionRequest(ticket.id, payload, { cycle_id: selectedCycleId ?? undefined });
      await reloadThread();
      onThreadChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save resolution');
    } finally {
      setResolutionSaving(false);
    }
  }

  async function handleUploadFile(file: File | null) {
    if (!file || ticketClosed) {
      return;
    }
    setUploadBusy(true);
    setError('');
    try {
      await uploadTicketAttachmentRequest(ticket.id, file, undefined, { cycle_id: selectedCycleId ?? undefined });
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

  function openMediaPreview(kind: 'image' | 'video', url: string, name: string, attachmentId: string) {
    setMediaPreview({ kind, url, name, attachmentId });
  }

  async function toggleReaction(itemId: string, commentId: string | null, emoji: string) {
    try {
      const reactions = commentId
        ? await toggleTicketCommentReactionRequest(
            ticket.id,
            commentId,
            emoji,
            { cycle_id: selectedCycleId ?? undefined },
          )
        : await toggleTicketRootReactionRequest(ticket.id, emoji);
      setReactionsByItem((current) => ({ ...current, [itemId]: reactions }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update reaction');
    }
  }

  function handleReactionEmojiSelect(itemId: string, commentId: string | null, emojiData: EmojiClickData) {
    void toggleReaction(itemId, commentId, emojiData.emoji);
    setExpandedReactionId(null);
  }

  async function handleSaveCommentEdit() {
    if (!editingCommentId) return;
    const plain = plainTextFromHtml(editingCommentHtml);
    if (!plain) {
      setError('Comment cannot be empty.');
      return;
    }
    setSavingCommentEdit(true);
    setError('');
    try {
      await patchTicketCommentRequest(
        ticket.id,
        editingCommentId,
        { body: editingCommentHtml },
        { cycle_id: selectedCycleId ?? undefined },
      );
      setEditingCommentId(null);
      setEditingCommentHtml('');
      await reloadThread();
      onThreadChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not edit comment');
    } finally {
      setSavingCommentEdit(false);
    }
  }

  function handleEmojiSelect(emojiData: EmojiClickData) {
    const emojiImageUrl = emojiData.getImageUrl(EmojiStyle.APPLE).replaceAll('"', '&quot;');
    const emojiText = escapeHtml(emojiData.emoji);
    const emojiImageHtml = `<img src="${emojiImageUrl}" alt="${emojiText}" class="ticket-inline-emoji" data-emoji-image="true" />&nbsp;`;
    const targetEditor = editingCommentId ? editEditorRef.current : composerEditorRef.current;
    const targetSetter = editingCommentId ? setEditingCommentHtml : setNewComment;
    const quill = targetEditor?.getQuill?.();

    if (quill) {
      const range = quill.getSelection(true);
      const insertAt = range ? range.index : quill.getLength();
      quill.clipboard.dangerouslyPasteHTML(insertAt, emojiImageHtml, 'user');
      quill.setSelection(insertAt + 2, 0, 'silent');
      targetSetter((quill.root.innerHTML ?? '').slice(0, 12000));
      return;
    }

    targetSetter((current) => `${current}${emojiImageHtml}`);
  }

  type TimelineItem = {
    id: string;
    at: string;
    title: string;
    subtitle?: string;
    actor?: string;
    actorAvatarUrl?: string | null;
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
        actorAvatarUrl: ticket.created_by_avatar_url,
        kind: 'created',
      },
      ...comments.map((c) => ({
        id: `comment-${c.id}`,
        at: c.created_at,
        title: c.is_internal ? 'Internal note added' : 'Comment added',
        subtitle: plainTextFromHtml(c.body),
        actor: c.author_name,
        actorAvatarUrl: c.author_avatar_url,
        kind: 'comment' as const,
      })),
      ...history.map((h) => ({
        id: `history-${h.id}`,
        at: h.created_at,
        title: `${humanize(h.field_name)} changed`,
        subtitle: `${h.old_value ?? '—'} -> ${h.new_value ?? '—'}${h.change_note?.trim() ? `\nComment: ${h.change_note.trim()}` : ''}`,
        actor: h.changer_name,
        actorAvatarUrl: h.changer_avatar_url,
        kind: 'history' as const,
      })),
      ...attachments.map((a) => ({
        id: `attachment-${a.id}`,
        at: a.created_at,
        title: 'Attachment uploaded',
        subtitle: `${a.filename} (${(a.file_size_bytes / 1024).toFixed(1)} KB)`,
        actor: a.uploader_name,
        actorAvatarUrl: a.uploader_avatar_url,
        kind: 'attachment' as const,
        meta: { attachmentId: a.id, attachmentName: a.filename },
      })),
    ];
    if (resolutionInfo) {
      items.push({
        id: `resolution-${resolutionInfo.id}`,
        at: resolutionInfo.updated_at || resolutionInfo.created_at,
        title: 'Resolution updated',
        subtitle: plainTextFromHtml(resolutionInfo.summary),
        actor: resolutionInfo.resolver_name,
        actorAvatarUrl: resolutionInfo.resolver_avatar_url,
        kind: 'resolution',
      });
    }
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [ticket, comments, history, attachments, resolutionInfo]);

  const conversationItems = useMemo(
    () =>
      [
        {
          id: `orig-${ticket.id}`,
          commentId: null as string | null,
          userId: ticket.created_by,
          author: ticket.created_by_name ?? 'Requester',
          authorAvatarUrl: ticket.created_by_avatar_url,
          at: ticket.created_at,
          body: ticket.description?.trim() || '—',
          kind: 'request' as const,
          internal: false,
        },
        ...comments.map((c) => ({
          id: `comment-${c.id}`,
          commentId: c.id,
          userId: c.author_id,
          author: c.author_name,
          authorAvatarUrl: c.author_avatar_url,
          at: c.created_at,
          body: c.body,
          kind: c.is_internal ? ('internal' as const) : ('reply' as const),
          internal: c.is_internal,
        })),
      ]
        .map((item) => ({
          ...item,
          mine: Boolean(currentUserId && item.userId === currentUserId),
        }))
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    [ticket.id, ticket.created_by, ticket.created_at, ticket.created_by_name, ticket.description, comments, currentUserId],
  );

  const commentAttachments = useMemo(() => {
    const grouped: Record<string, typeof attachments> = {};
    for (const a of attachments) {
      if (!a.comment_id) {
        continue;
      }
      if (!grouped[a.comment_id]) {
        grouped[a.comment_id] = [];
      }
      grouped[a.comment_id].push(a);
    }
    return grouped;
  }, [attachments]);

  return (
    <div className="ticket-detail-tabs">
      {error ? <p className="error-text ticket-detail-tabs-error">{error}</p> : null}
      <div className="ticket-cycle-toolbar">
        <span className="ticket-cycle-label">Ticket version</span>
        <Dropdown
          value={selectedCycleId}
          options={cycleOptions}
          optionLabel="label"
          optionValue="value"
          onChange={(e) => setSelectedCycleId((e.value as string) ?? null)}
          className="ticket-cycle-dropdown"
          disabled={!cycles.length}
          valueTemplate={(option) => {
            if (!option) return <span className="ticket-cycle-placeholder">Select version</span>;
            return (
              <span className="ticket-cycle-badge">
                <span className="ticket-cycle-badge-version">V{option.version}</span>
                <span className={`ticket-cycle-badge-status ticket-cycle-badge-status--${option.statusKey}`}>
                  {option.statusLabel}
                </span>
              </span>
            );
          }}
          itemTemplate={(option) => (
            <span className="ticket-cycle-badge">
              <span className="ticket-cycle-badge-version">V{option.version}</span>
              <span className={`ticket-cycle-badge-status ticket-cycle-badge-status--${option.statusKey}`}>
                {option.statusLabel}
              </span>
            </span>
          )}
        />
      </div>
      {selectedCycle?.reopen_reason ? (
        <p className="ticket-cycle-note">
          Reopened in V{selectedCycle.version_no}
          {selectedCycle.reopened_by_name ? ` by ${selectedCycle.reopened_by_name}` : ''}: {selectedCycle.reopen_reason}
        </p>
      ) : null}
      {showApprovalAction ? (
        <div className="ticket-detail-approval-bar">
          <span className="ticket-detail-approval-hint">
            Ticket is resolved. Request lead approval to close it.
          </span>
          <Button
            type="button"
            label={approvalRequested ? 'Approval requested' : 'Get approval from lead'}
            icon="pi pi-send"
            className="ticket-detail-approval-btn"
            disabled={approvalRequested || ticketClosed}
            onClick={() => onRequestApproval?.()}
          />
        </div>
      ) : null}

      <TabView
        activeIndex={tabIndex}
        onTabChange={(e) => setTabIndex(e.index)}
        className="ticket-detail-tabview"
      >
        <TabPanel header="Conversation">
          <div className="ticket-conv-thread ticket-conv-thread--chat">
            {loading ? <p className="ticket-detail-muted">Loading…</p> : null}
            {!loading ? (
              <AnimatePresence initial={false}>
                {conversationItems.map((item, index) => (
                  <motion.article
                    key={item.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(index * 0.02, 0.2) }}
                    className={`ticket-chat-row ${item.mine ? 'ticket-chat-row--mine' : 'ticket-chat-row--theirs'} ticket-chat-row--${item.kind}`}
                    onMouseEnter={() => setHoveredMessageId(item.id)}
                    onMouseLeave={() => {
                      setHoveredMessageId((current) => (current === item.id ? null : current));
                      setExpandedReactionId((current) => (current === item.id ? null : current));
                    }}
                  >
                    <div className={`ticket-chat-avatar ${item.mine ? 'ticket-chat-avatar--mine' : 'ticket-chat-avatar--theirs'} ticket-chat-avatar--${item.kind}`}>
                      {item.authorAvatarUrl ? (
                        <img src={item.authorAvatarUrl} alt={item.author} className="ticket-chat-avatar-img" />
                      ) : (
                        <span>{initials(item.author)}</span>
                      )}
                    </div>
                    <div className={`ticket-chat-bubble ${item.mine ? 'ticket-chat-bubble--mine' : 'ticket-chat-bubble--theirs'} ticket-chat-bubble--${item.kind}`}>
                      {(hoveredMessageId === item.id || expandedReactionId === item.id) ? (
                        <div className="ticket-reaction-toolbar">
                          {QUICK_REACTIONS.map((reaction) => (
                            <button
                              key={reaction.emoji}
                              type="button"
                              className={`ticket-reaction-quick-btn ${(reactionsByItem[item.id] ?? []).some((r) => r.emoji === reaction.emoji && r.reacted_by_me) ? 'is-active' : ''}`}
                              onClick={() => void toggleReaction(item.id, item.commentId, reaction.emoji)}
                              aria-label={`React with ${reaction.emoji}`}
                              title={reaction.emoji}
                            >
                              <Emoji unified={reaction.unified} emojiStyle={EmojiStyle.APPLE} size={16} />
                            </button>
                          ))}
                          <button
                            type="button"
                            className="ticket-reaction-more-btn ticket-reaction-add-btn"
                            onClick={() => setExpandedReactionId((current) => (current === item.id ? null : item.id))}
                            aria-label="Add reaction"
                            title="Add reaction"
                          >
                            <SmilePlus size={15} strokeWidth={1.9} />
                          </button>
                          {item.mine && !ticketClosed ? <span className="ticket-reaction-toolbar-divider" aria-hidden /> : null}
                          {item.mine && !ticketClosed ? (
                            <button
                              type="button"
                              className="ticket-reaction-more-btn ticket-reaction-edit-btn"
                              onClick={() => {
                                if (!item.commentId) {
                                  return;
                                }
                                setEditingCommentId(item.commentId);
                                setEditingCommentHtml(item.body);
                                setExpandedReactionId(null);
                              }}
                              aria-label="Edit message"
                              title={item.commentId ? 'Edit' : 'Only reply messages can be edited'}
                              disabled={!item.commentId}
                            >
                              <Pencil size={14} strokeWidth={2} />
                            </button>
                          ) : null}
                          {expandedReactionId === item.id ? (
                            <div className="ticket-reaction-more-pop">
                              <EmojiPicker
                                open
                                onEmojiClick={(emojiData) => handleReactionEmojiSelect(item.id, item.commentId, emojiData)}
                                lazyLoadEmojis
                                skinTonesDisabled={false}
                                searchDisabled={false}
                                width={326}
                                height={350}
                                theme={Theme.LIGHT}
                                emojiStyle={EmojiStyle.APPLE}
                                previewConfig={{ showPreview: false }}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <header className="ticket-chat-head">
                        <span className="ticket-chat-author">{item.author}</span>
                        <span className="ticket-chat-time">{formatWhen(item.at)}</span>
                      </header>
                      {item.commentId && editingCommentId === item.commentId ? (
                        <div className="ticket-chat-edit-wrap">
                          <Editor
                            ref={editEditorRef}
                            value={editingCommentHtml}
                            onTextChange={(e) => setEditingCommentHtml((e.htmlValue ?? '').slice(0, 12000))}
                            className="ticket-conv-editor ticket-chat-edit-editor"
                            headerTemplate={conversationEditorHeaderTemplate}
                            readOnly={savingCommentEdit}
                          />
                          <div className="ticket-chat-edit-actions">
                            <Button
                              type="button"
                              text
                              label="Cancel"
                              disabled={savingCommentEdit}
                              onClick={() => {
                                setEditingCommentId(null);
                                setEditingCommentHtml('');
                              }}
                            />
                            <Button
                              type="button"
                              label={savingCommentEdit ? 'Saving…' : 'Save'}
                              disabled={savingCommentEdit || !plainTextFromHtml(editingCommentHtml)}
                              onClick={() => void handleSaveCommentEdit()}
                            />
                          </div>
                        </div>
                      ) : (
                        <p className="ticket-chat-body" dangerouslySetInnerHTML={{ __html: toDisplayHtml(item.body) }} />
                      )}
                      {(commentAttachments[item.id.replace('comment-', '')] ?? []).length ? (
                        <div className="ticket-chat-media-grid">
                          {(commentAttachments[item.id.replace('comment-', '')] ?? []).map((a) => {
                            const preview = attachmentPreviewUrls[a.id];
                            const isImage = a.mime_type.startsWith('image/');
                            const isVideo = a.mime_type.startsWith('video/');
                            if (preview && isImage) {
                              return (
                                <button
                                  key={a.id}
                                  type="button"
                                  className="ticket-chat-media-card"
                                  onClick={() => openMediaPreview('image', preview, a.filename, a.id)}
                                  title={a.filename}
                                >
                                  <img src={preview} alt={a.filename} />
                                </button>
                              );
                            }
                            if (preview && isVideo) {
                              return (
                                <button
                                  key={a.id}
                                  type="button"
                                  className="ticket-chat-media-card ticket-chat-media-card--video"
                                  onClick={() => openMediaPreview('video', preview, a.filename, a.id)}
                                  title={a.filename}
                                >
                                  <video src={preview} controls preload="metadata" />
                                </button>
                              );
                            }
                            return (
                              <button
                                key={a.id}
                                type="button"
                                className="ticket-conv-media-pill"
                                onClick={() => void handleDownload(a.id, a.filename)}
                                title={a.filename}
                              >
                                <i className="pi pi-file" />
                                <span>{a.filename}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {item.internal ? <span className="ticket-chat-tag">Internal note</span> : null}
                      {(reactionsByItem[item.id] ?? []).length ? (
                        <div className="ticket-reaction-row">
                          {(reactionsByItem[item.id] ?? []).map((reaction) => (
                            <button
                              key={`${item.id}-${reaction.emoji}`}
                              type="button"
                              className={`ticket-reaction-pill ${reaction.reacted_by_me ? 'is-active' : ''}`}
                              onClick={() => void toggleReaction(item.id, item.commentId, reaction.emoji)}
                              aria-label="Message reaction"
                            >
                              <span className="ticket-reaction-pill-emoji">
                                <Emoji
                                  unified={emojiToUnified(reaction.emoji)}
                                  emojiStyle={EmojiStyle.APPLE}
                                  size={16}
                                />
                              </span>
                              <small>{reaction.count}</small>
                              {(reaction.reacted_by_names ?? []).length ? (
                                <span className="ticket-reaction-tooltip">
                                  Reacted by: {(reaction.reacted_by_names ?? []).join(', ')}
                                </span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </motion.article>
                ))}
              </AnimatePresence>
            ) : null}
          </div>
          <motion.div
            className={`ticket-conv-reply ticket-conv-reply--chat${ticketClosed ? ' ticket-conv-reply--closed' : ''}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {ticketClosed ? (
              <p className="ticket-detail-muted ticket-closed-banner">
                This ticket is closed. Reopen it from the sidebar to post replies or attach files.
              </p>
            ) : null}
            <div className="ticket-conv-controls">
              <input
                type="file"
                id={`ticket-quick-upload-${viewKey}`}
                className="ticket-file-input"
                accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                multiple
                disabled={uploadBusy || posting || ticketClosed}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) {
                    setPendingFiles((current) => [...current, ...files]);
                  }
                  e.target.value = '';
                }}
              />
              <label
                htmlFor={`ticket-quick-upload-${viewKey}`}
                className={`ticket-conv-attach-btn${ticketClosed ? ' ticket-conv-attach-btn--disabled' : ''}`}
                aria-disabled={ticketClosed}
              >
                <i className="pi pi-paperclip" />
                <span>{uploadBusy ? 'Uploading…' : 'Attach media/file'}</span>
              </label>
              {canPostInternalNotes ? (
                <label className={`ticket-conv-internal-check${ticketClosed ? ' ticket-conv-internal-check--disabled' : ''}`}>
                  <Checkbox
                    inputId={`ticket-internal-${viewKey}`}
                    checked={internalNote}
                    onChange={(e) => setInternalNote(Boolean(e.checked))}
                    disabled={ticketClosed}
                  />
                  <span>Internal note</span>
                </label>
              ) : null}
            </div>
            {pendingFiles.length ? (
              <div className="ticket-conv-media-strip">
                {pendingFiles.map((f, idx) => (
                  <div key={`${f.name}-${idx}`} className="ticket-conv-media-pill">
                    <i className={f.type.startsWith('image/') ? 'pi pi-image' : f.type.startsWith('video/') ? 'pi pi-video' : 'pi pi-file'} />
                    <span>{f.name}</span>
                    <button
                      type="button"
                      className="ticket-conv-media-remove"
                      disabled={ticketClosed}
                      onClick={() => setPendingFiles((current) => current.filter((_, i) => i !== idx))}
                      aria-label="Remove attachment"
                    >
                      <i className="pi pi-times" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <Editor
              ref={composerEditorRef}
              id={`ticket-reply-${viewKey}`}
              value={newComment}
              onTextChange={(e) => setNewComment((e.htmlValue ?? '').slice(0, 12000))}
              className="ticket-conv-editor"
              headerTemplate={conversationEditorHeaderTemplate}
              placeholder={ticketClosed ? 'Conversation is read-only while the ticket is closed.' : 'Write a reply…'}
              readOnly={ticketClosed}
            />
            {isEmojiPickerOpen ? (
              <div className="ticket-emoji-picker-wrap">
                <EmojiPicker
                  onEmojiClick={handleEmojiSelect}
                  lazyLoadEmojis
                  skinTonesDisabled={false}
                  searchDisabled={false}
                  width="100%"
                  height={340}
                  theme={Theme.LIGHT}
                  emojiStyle={EmojiStyle.APPLE}
                  previewConfig={{ showPreview: false }}
                />
              </div>
            ) : null}
            <Button
              type="button"
              label={posting ? 'Sending…' : 'Post'}
              icon="pi pi-send"
              disabled={
                ticketClosed || posting || (!plainTextFromHtml(newComment) && pendingFiles.length === 0)
              }
              onClick={() => void handlePostComment()}
            />
          </motion.div>
        </TabPanel>

        <TabPanel header="Resolution">
          {loading && !resolutionLoaded ? (
            <p className="ticket-detail-muted">Loading…</p>
          ) : (
            <div className="ticket-resolution-form">
              {ticketClosed ? (
                <p className="ticket-detail-muted ticket-closed-banner">
                  This ticket is closed. Resolution fields are read-only and cannot be saved.
                </p>
              ) : null}
              <label className="ticket-form-label" htmlFor={`res-sum-${viewKey}`}>
                Summary
              </label>
              <Editor
                id={`res-sum-${viewKey}`}
                value={resolutionSummary}
                onTextChange={(e) => setResolutionSummary(e.htmlValue ?? '')}
                className="ticket-rich-editor"
                headerTemplate={resolutionEditorHeaderTemplate}
                readOnly={ticketClosed}
              />
              <label className="ticket-form-label" htmlFor={`res-root-${viewKey}`}>
                Root cause
              </label>
              <Editor
                id={`res-root-${viewKey}`}
                value={resolutionRootCause}
                onTextChange={(e) => setResolutionRootCause(e.htmlValue ?? '')}
                className="ticket-rich-editor"
                headerTemplate={resolutionEditorHeaderTemplate}
                readOnly={ticketClosed}
              />
              <label className="ticket-form-label" htmlFor={`res-steps-${viewKey}`}>
                Steps taken
              </label>
              <Editor
                id={`res-steps-${viewKey}`}
                value={resolutionSteps}
                onTextChange={(e) => setResolutionSteps(e.htmlValue ?? '')}
                className="ticket-rich-editor"
                headerTemplate={resolutionEditorHeaderTemplate}
                readOnly={ticketClosed}
              />
              <div className="ticket-detail-actions ticket-resolution-actions">
                <Button
                  type="button"
                  label={resolutionSaving ? 'Saving…' : 'Save resolution'}
                  icon="pi pi-check"
                  disabled={resolutionSaving || ticketClosed}
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
              {ticketClosed ? (
                <p className="ticket-detail-muted ticket-closed-banner">
                  Uploads are disabled while the ticket is closed. You can still download existing files below.
                </p>
              ) : null}
              <div className="ticket-attachments-upload">
                <input
                  type="file"
                  id={`ticket-file-${viewKey}`}
                  className="ticket-file-input"
                  disabled={uploadBusy || ticketClosed}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    void handleUploadFile(f ?? null);
                    e.target.value = '';
                  }}
                />
                <label
                  htmlFor={`ticket-file-${viewKey}`}
                  className={`ticket-file-label${ticketClosed ? ' ticket-file-label--disabled' : ''}`}
                  aria-disabled={ticketClosed}
                >
                  <i className="pi pi-upload" aria-hidden="true" />
                  {ticketClosed ? 'Uploads disabled (ticket closed)' : uploadBusy ? 'Uploading…' : 'Choose file (max 15MB)'}
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
                      <i className="pi pi-paperclip" aria-hidden="true" />
                      {a.filename}
                    </button>
                    <span className="ticket-attachment-meta">
                      {a.uploader_name} · {(a.file_size_bytes / 1024).toFixed(1)} KB
                    </span>
                  </li>
                ))}
              </ul>
              {attachments.length === 0 ? (
                <p className="ticket-detail-muted ticket-attachments-empty">
                  No attachments yet. Upload a file to keep supporting documents with this ticket.
                </p>
              ) : null}
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
                  <div className="ticket-timeline-dot">
                    {item.actorAvatarUrl ? (
                      <img src={item.actorAvatarUrl} alt={item.actor ?? 'User'} className="ticket-timeline-avatar-img" />
                    ) : (
                      <span>{initials(item.actor ?? 'U')}</span>
                    )}
                  </div>
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
      <Dialog
        header={mediaPreview?.name ?? 'Media preview'}
        visible={Boolean(mediaPreview)}
        onHide={() => setMediaPreview(null)}
        className="ticket-media-preview-dialog"
        headerClassName="ticket-media-preview-header"
        modal
        draggable={false}
        resizable={false}
        icons={
          mediaPreview ? (
            <Button
              type="button"
              label="Download"
              icon="pi pi-download"
              size="small"
              text
              onClick={() => {
                void handleDownload(mediaPreview.attachmentId, mediaPreview.name);
              }}
            />
          ) : undefined
        }
      >
        {mediaPreview?.kind === 'image' ? (
          <img className="ticket-media-preview-image" src={mediaPreview.url} alt={mediaPreview.name} />
        ) : mediaPreview?.kind === 'video' ? (
          <video className="ticket-media-preview-video" src={mediaPreview.url} controls autoPlay />
        ) : null}
      </Dialog>
    </div>
  );
}
