import {
  Bell,
  BellOff,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Forward,
  Image,
  Link2,
  Languages,
  Mail,
  Mic,
  Pin,
  PinOff,
  MoreHorizontal,
  Pencil,
  Paperclip,
  Search,
  SendHorizontal,
  Smile,
  SmilePlus,
  Trash2,
  Undo2,
  CheckCircle2,
  Check,
  UserPlus,
  X,
} from 'lucide-react';
import EmojiPicker, { EmojiStyle, Theme, type EmojiClickData } from 'emoji-picker-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  actOnChatRequestRequest,
  chatAttachmentFileUrl,
  clearChatConversationRequest,
  createChatRequestRequest,
  getChatRequestsRequest,
  deleteChatConversationRequest,
  deleteChatMessageRequest,
  editChatMessageRequest,
  forwardChatMessageRequest,
  getChatConversationsRequest,
  getConversationMessagesRequest,
  patchChatConversationPreferencesRequest,
  markChatConversationReadRequest,
  searchChatUsersRequest,
  sendConversationMessageRequest,
  toggleChatReactionRequest,
  type ChatConversationRecord,
  type ChatMessageRecord,
  type ChatRequestRecord,
  type ChatSearchUserRecord,
} from '../../lib/api';

type Props = {
  currentUserId?: string | null;
};

const IOS_EMOJI_ASSET_BASE = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64';
const HOVER_QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢'];

function getAppleEmojiAssetUrl(unified: string) {
  return `${IOS_EMOJI_ASSET_BASE}/${unified.toLowerCase()}.png`;
}

function emojiToUnified(emoji: string) {
  return Array.from(emoji)
    .map((char) => char.codePointAt(0))
    .filter((codePoint): codePoint is number => codePoint !== undefined && codePoint !== 0xfe0f)
    .map((codePoint) => codePoint.toString(16))
    .join('-');
}

function splitGraphemes(value: string) {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(value), (entry) => entry.segment);
  }
  return Array.from(value);
}

function isEmojiGrapheme(value: string) {
  if (!value.trim()) {
    return false;
  }
  return /\p{Extended_Pictographic}/u.test(value) || /[\u{1F1E6}-\u{1F1FF}]/u.test(value);
}

function isImageMime(mimeType?: string | null) {
  return typeof mimeType === 'string' && mimeType.startsWith('image/');
}

function formatMessageDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'long',
  });
}

function formatMessageTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderWithIosEmoji(value: string) {
  return splitGraphemes(value).map((part, index) => {
    if (part === '\n') {
      return <br key={`br-${index}`} />;
    }
    if (!isEmojiGrapheme(part)) {
      return <Fragment key={`txt-${index}`}>{part}</Fragment>;
    }
    const unified = emojiToUnified(part);
    if (!unified) {
      return <Fragment key={`txt-${index}`}>{part}</Fragment>;
    }
    return (
      <img
        key={`emoji-${index}-${unified}`}
        className="chat-ios-emoji"
        src={getAppleEmojiAssetUrl(unified)}
        alt={part}
        draggable={false}
      />
    );
  });
}

function readComposerText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }
  if (!(node instanceof HTMLElement)) {
    return '';
  }
  if (node.tagName === 'IMG' && node.dataset.emoji) {
    return node.dataset.emoji;
  }
  if (node.tagName === 'BR') {
    return '\n';
  }
  return Array.from(node.childNodes).map(readComposerText).join('');
}

function placeCaretAtEnd(target: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function Avatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string | null;
}) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className="chat-avatar chat-avatar--image" />;
  }
  return (
    <span className="chat-avatar">
      {(name || 'U')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('')}
    </span>
  );
}

export function ChatWorkspace({ currentUserId }: Props) {
  type ConversationViewMode = 'chat' | 'files' | 'photos';
  const [chatSearch, setChatSearch] = useState('');
  const [searchedUsers, setSearchedUsers] = useState<ChatSearchUserRecord[]>([]);
  const [approvedChatUserIds, setApprovedChatUserIds] = useState<Set<string>>(new Set());
  const [conversations, setConversations] = useState<ChatConversationRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [chatViewClosed, setChatViewClosed] = useState(false);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [composerText, setComposerText] = useState('');
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [actionMenuMessageId, setActionMenuMessageId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [conversationViewMode, setConversationViewMode] = useState<ConversationViewMode>('chat');
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessageRecord | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [forwardSourceMessageId, setForwardSourceMessageId] = useState<string | null>(null);
  const [forwardQuery, setForwardQuery] = useState('');
  const [forwardSelectedIds, setForwardSelectedIds] = useState<string[]>([]);
  const [forwardBusy, setForwardBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLDivElement | null>(null);
  const pollInFlightRef = useRef(false);
  const chatRequestsNotifyRef = useRef<HTMLDivElement | null>(null);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const emojiTriggerRef = useRef<HTMLButtonElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<BlobPart[]>([]);
  const voiceRecordStartedAtRef = useRef(0);
  const discardVoiceRecordingRef = useRef(false);
  const micPointerDownRef = useRef(false);
  const voiceConversationIdRef = useRef<string | null>(null);
  const voiceReplyToIdRef = useRef<string | null>(null);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceRecordSeconds, setVoiceRecordSeconds] = useState(0);
  const [chatRequests, setChatRequests] = useState<ChatRequestRecord[]>([]);
  const [chatRequestsPanelOpen, setChatRequestsPanelOpen] = useState(false);
  const [chatRequestBusyId, setChatRequestBusyId] = useState<string | null>(null);
  const [messageAttachmentUrls, setMessageAttachmentUrls] = useState<Record<string, string>>({});
  const [imageViewer, setImageViewer] = useState<{ items: { id: string; name: string }[]; index: number } | null>(null);
  const [imageViewerZoom, setImageViewerZoom] = useState(1);

  const activeConversation = useMemo(
    () => conversations.find((row) => row.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );
  const filteredConversations = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();
    if (!query) {
      return conversations;
    }
    return conversations.filter((convo) =>
      [convo.other_user_name, convo.other_user_employee_id, convo.other_user_designation ?? '', convo.last_message?.body ?? '']
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [chatSearch, conversations]);
  const conversationByUserId = useMemo(
    () => new Map(conversations.map((convo) => [convo.other_user_id, convo])),
    [conversations],
  );
  const forwardTargetConversations = useMemo(() => {
    if (!activeConversationId) {
      return conversations;
    }
    const others = conversations.filter((c) => c.id !== activeConversationId);
    const q = forwardQuery.trim().toLowerCase();
    if (!q) {
      return others;
    }
    return others.filter((convo) =>
      [convo.other_user_name, convo.other_user_employee_id, convo.other_user_designation ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [conversations, activeConversationId, forwardQuery]);
  const pendingInboundChatRequests = useMemo(() => {
    if (!currentUserId) {
      return [];
    }
    return chatRequests.filter((row) => row.status === 'pending' && row.recipient_id === currentUserId);
  }, [chatRequests, currentUserId]);
  const pendingOutboundChatRequests = useMemo(() => {
    if (!currentUserId) {
      return [];
    }
    return chatRequests.filter((row) => row.status === 'pending' && row.requester_id === currentUserId);
  }, [chatRequests, currentUserId]);
  const chatRequestActionCount = pendingInboundChatRequests.length;
  const selectedFilePreviews = useMemo(
    () => selectedFiles.map((file, index) => ({
      index,
      file,
      isImage: isImageMime(file.type),
      previewUrl: isImageMime(file.type) ? URL.createObjectURL(file) : null,
    })),
    [selectedFiles],
  );
  const visibleMessages = useMemo(() => {
    if (conversationViewMode === 'files') {
      return messages.filter((message) => message.attachments.some((att) => !att.mime_type.startsWith('image/')));
    }
    if (conversationViewMode === 'photos') {
      return messages.filter((message) => message.attachments.some((att) => att.mime_type.startsWith('image/')));
    }
    if (!messageSearchQuery.trim()) {
      return messages;
    }
    const query = messageSearchQuery.trim().toLowerCase();
    return messages.filter((message) =>
      (message.body ?? '').toLowerCase().includes(query)
      || message.attachments.some((att) => att.filename.toLowerCase().includes(query)),
    );
  }, [messages, conversationViewMode, messageSearchQuery]);

  useEffect(() => {
    return () => {
      selectedFilePreviews.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, [selectedFilePreviews]);

  useEffect(() => {
    const attachmentIds = new Set<string>();
    for (const message of messages) {
      for (const att of message.attachments) {
        attachmentIds.add(att.id);
      }
    }

    const token = localStorage.getItem('accessToken');
    const created: Array<{ id: string; url: string }> = [];
    let cancelled = false;

    void (async () => {
      for (const id of attachmentIds) {
        if (cancelled) {
          break;
        }
        if (messageAttachmentUrls[id]) {
          continue;
        }
        try {
          const response = await fetch(chatAttachmentFileUrl(id), {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (!response.ok) {
            continue;
          }
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          created.push({ id, url: objectUrl });
          setMessageAttachmentUrls((prev) => {
            if (prev[id]) {
              URL.revokeObjectURL(objectUrl);
              return prev;
            }
            return { ...prev, [id]: objectUrl };
          });
        } catch {
          // keep fallback link UI if preview cannot load
        }
      }
    })();

    setMessageAttachmentUrls((prev) => {
      const next: Record<string, string> = {};
      for (const [id, url] of Object.entries(prev)) {
        if (attachmentIds.has(id)) {
          next[id] = url;
        } else {
          URL.revokeObjectURL(url);
        }
      }
      return next;
    });

    return () => {
      cancelled = true;
      created.forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, [messages, messageAttachmentUrls]);

  useEffect(() => {
    void refreshAll();
    const timer = window.setInterval(() => {
      if (pollInFlightRef.current) {
        return;
      }
      pollInFlightRef.current = true;
      void (async () => {
        try {
          await refreshConversations();
          await refreshChatRequests();
          if (activeConversationId) {
            await loadMessages(activeConversationId);
          }
        } finally {
          pollInFlightRef.current = false;
        }
      })();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [activeConversationId]);

  useEffect(() => {
    if (!forwardSourceMessageId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !forwardBusy) {
        setForwardSourceMessageId(null);
        setForwardQuery('');
        setForwardSelectedIds([]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [forwardSourceMessageId, forwardBusy]);

  useEffect(() => {
    const query = chatSearch.trim();
    if (!query) {
      setSearchedUsers([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchChatUsersRequest(query)
        .then(setSearchedUsers)
        .catch(() => setSearchedUsers([]));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [chatSearch]);

  async function refreshChatRequests() {
    try {
      const rows = await getChatRequestsRequest();
      setChatRequests(rows);
      const approved = rows
        .filter((row) => row.status === 'approved')
        .map((row) =>
          row.requester_id === currentUserId ? row.recipient_id : row.requester_id,
        );
      setApprovedChatUserIds(new Set(approved));
    } catch {
      setChatRequests([]);
      setApprovedChatUserIds(new Set());
    }
  }

  useEffect(() => {
    void refreshChatRequests();
  }, [currentUserId]);

  useEffect(() => {
    if (!chatRequestsPanelOpen) {
      return;
    }
    const onDocMouseDown = (event: MouseEvent) => {
      const el = chatRequestsNotifyRef.current;
      if (el && !el.contains(event.target as Node)) {
        setChatRequestsPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [chatRequestsPanelOpen]);

  useEffect(() => {
    if (!headerMenuOpen) {
      return;
    }
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const menuRoot = headerMenuRef.current;
      if (menuRoot && !menuRoot.contains(target)) {
        setHeaderMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [headerMenuOpen]);

  useEffect(() => {
    if (!isEmojiPickerOpen) {
      return;
    }
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const trigger = emojiTriggerRef.current;
      const picker = emojiPickerRef.current;
      if ((trigger && trigger.contains(target)) || (picker && picker.contains(target))) {
        return;
      }
      setIsEmojiPickerOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [isEmojiPickerOpen]);

  async function refreshAll() {
    await refreshConversations();
    await refreshChatRequests();
  }

  async function refreshConversations() {
    try {
      const rows = await getChatConversationsRequest();
      setConversations(rows);
      if (!activeConversationId && rows.length > 0 && !chatViewClosed) {
        setActiveConversationId(rows[0].id);
        void loadMessages(rows[0].id);
      }
      return rows;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load conversations');
      return [];
    }
  }

  async function loadMessages(conversationId: string) {
    try {
      const rows = await getConversationMessagesRequest(conversationId);
      setMessages(rows);
      await markChatConversationReadRequest(conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load messages');
    }
  }

  async function handleSendRequest(userId: string) {
    try {
      await createChatRequestRequest(userId);
      await refreshChatRequests();
      const rows = await refreshConversations();
      const convo = rows.find((row) => row.other_user_id === userId);
      if (convo) {
        setChatViewClosed(false);
        setActiveConversationId(convo.id);
        await loadMessages(convo.id);
      }
      setSearchedUsers([]);
      setChatSearch('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send chat request');
    }
  }

  async function handleActOnChatRequest(requestId: string, action: 'approve' | 'reject' | 'cancel') {
    setChatRequestBusyId(requestId);
    try {
      await actOnChatRequestRequest(requestId, action);
      await refreshChatRequests();
      await refreshConversations();
      setChatRequestsPanelOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update chat request');
    } finally {
      setChatRequestBusyId(null);
    }
  }

  async function handleSendMessage() {
    if (!activeConversationId || (!composerText.trim() && selectedFiles.length === 0 && !replyingTo)) {
      return;
    }
    setIsSending(true);
    try {
      const sent = await sendConversationMessageRequest({
        conversationId: activeConversationId,
        body: composerText.trim(),
        replyToMessageId: replyingTo?.id,
        attachments: selectedFiles,
      });
      setMessages((current) => [...current, sent]);
      setComposerText('');
      if (composerInputRef.current) {
        composerInputRef.current.innerHTML = '';
      }
      setSelectedFiles([]);
      setReplyingTo(null);
      setIsEmojiPickerOpen(false);
      void refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send message');
    } finally {
      setIsSending(false);
    }
  }

  function pickVoiceMimeType(): string | undefined {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return candidates.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
  }

  function formatVoiceDuration(totalSeconds: number) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }

  function stopVoiceRecording() {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state === 'recording') {
      rec.stop();
    }
    setVoiceRecording(false);
  }

  async function finalizeVoiceRecording(mimeType: string) {
    mediaRecorderRef.current = null;
    const stream = voiceStreamRef.current;
    voiceStreamRef.current = null;
    stream?.getTracks().forEach((t) => t.stop());

    if (discardVoiceRecordingRef.current) {
      discardVoiceRecordingRef.current = false;
      voiceChunksRef.current = [];
      voiceConversationIdRef.current = null;
      voiceReplyToIdRef.current = null;
      return;
    }

    const chunks = voiceChunksRef.current;
    voiceChunksRef.current = [];
    const durationMs = Date.now() - voiceRecordStartedAtRef.current;
    const blobType =
      chunks.length > 0 && chunks[0] instanceof Blob ? (chunks[0] as Blob).type : mimeType || 'audio/webm';
    const blob = new Blob(chunks, { type: blobType });
    const conversationId = voiceConversationIdRef.current;
    voiceConversationIdRef.current = null;
    const replyToMessageId = voiceReplyToIdRef.current;
    voiceReplyToIdRef.current = null;

    if (durationMs < 550 || blob.size < 80 || !conversationId) {
      return;
    }

    const ext = blobType.includes('webm') ? 'webm' : blobType.includes('mp4') || blobType.includes('mpeg') ? 'm4a' : 'webm';
    const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blobType });

    setIsSending(true);
    try {
      const sent = await sendConversationMessageRequest({
        conversationId,
        body: 'Voice message',
        replyToMessageId: replyToMessageId ?? undefined,
        attachments: [file],
      });
      setMessages((current) => [...current, sent]);
      setReplyingTo(null);
      void refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send voice message');
    } finally {
      setIsSending(false);
    }
  }

  async function startVoiceRecording() {
    if (!activeConversationId || isSending || mediaRecorderRef.current) {
      return;
    }
    if (typeof window === 'undefined' || !('MediaRecorder' in window)) {
      setError('Voice messages are not supported in this browser.');
      return;
    }

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      setError('Microphone access is unavailable in this browser context.');
      return;
    }

    discardVoiceRecordingRef.current = false;
    voiceConversationIdRef.current = activeConversationId;
    voiceReplyToIdRef.current = replyingTo?.id ?? null;
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true });
      if (!micPointerDownRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        voiceConversationIdRef.current = null;
        voiceReplyToIdRef.current = null;
        return;
      }
      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];
      const mimeType = pickVoiceMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = rec;
      rec.addEventListener('dataavailable', (event) => {
        if (event.data?.size) {
          voiceChunksRef.current.push(event.data);
        }
      });
      rec.addEventListener('stop', () => {
        void finalizeVoiceRecording(rec.mimeType);
      });
      if (!micPointerDownRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        voiceStreamRef.current = null;
        mediaRecorderRef.current = null;
        voiceConversationIdRef.current = null;
        voiceReplyToIdRef.current = null;
        return;
      }
      voiceRecordStartedAtRef.current = Date.now();
      rec.start(100);
      setVoiceRecording(true);
      setVoiceRecordSeconds(0);
    } catch (err) {
      voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
      voiceStreamRef.current = null;
      mediaRecorderRef.current = null;
      voiceConversationIdRef.current = null;
      voiceReplyToIdRef.current = null;
      setVoiceRecording(false);
      setError(err instanceof Error ? err.message : 'Microphone access is required for voice messages.');
    }
  }

  useEffect(() => {
    if (!voiceRecording) {
      return;
    }
    const id = window.setInterval(() => {
      setVoiceRecordSeconds(Math.floor((Date.now() - voiceRecordStartedAtRef.current) / 1000));
    }, 280);
    return () => window.clearInterval(id);
  }, [voiceRecording]);

  useEffect(
    () => () => {
      discardVoiceRecordingRef.current = true;
      micPointerDownRef.current = false;
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      mediaRecorderRef.current = null;
      voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
      voiceStreamRef.current = null;
    },
    [],
  );

  async function handleEditMessage(message: ChatMessageRecord) {
    const nextBody = window.prompt('Edit message', message.body ?? '');
    if (nextBody === null || !nextBody.trim()) {
      return;
    }
    setEditingMessageId(message.id);
    try {
      const updated = await editChatMessageRequest(message.id, nextBody.trim());
      setMessages((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      void refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to edit message');
    } finally {
      setEditingMessageId(null);
    }
  }

  async function handleDeleteMessage(messageId: string) {
    if (!window.confirm('Delete this message?')) {
      return;
    }
    try {
      const updated = await deleteChatMessageRequest(messageId);
      setMessages((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      void refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete message');
    }
  }

  async function handleReact(messageId: string, emoji: string) {
    try {
      const reactions = await toggleChatReactionRequest(messageId, emoji);
      setMessages((current) => current.map((row) => (row.id === messageId ? { ...row, reactions } : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to react');
    }
  }

  function toggleForwardTarget(conversationId: string) {
    if (forwardBusy) {
      return;
    }
    setForwardSelectedIds((prev) =>
      prev.includes(conversationId) ? prev.filter((id) => id !== conversationId) : [...prev, conversationId],
    );
  }

  async function submitForwardToSelected() {
    if (!forwardSourceMessageId || forwardBusy || forwardSelectedIds.length === 0) {
      return;
    }
    const messageId = forwardSourceMessageId;
    const targets = [...forwardSelectedIds];
    setForwardBusy(true);
    setError('');
    try {
      const results = await Promise.allSettled(targets.map((cid) => forwardChatMessageRequest(messageId, cid)));
      const activeId = activeConversationId;
      const toAppend: ChatMessageRecord[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.conversation_id === activeId) {
          toAppend.push(r.value);
        }
      }
      if (toAppend.length > 0) {
        setMessages((current) => [...current, ...toAppend]);
      }
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        const ok = results.length - failed;
        setError(
          ok === 0
            ? 'Unable to forward message.'
            : `Forwarded to ${ok} chat${ok === 1 ? '' : 's'}. ${failed} could not be sent.`,
        );
      }
      void refreshConversations();
      setForwardSourceMessageId(null);
      setForwardQuery('');
      setForwardSelectedIds([]);
    } finally {
      setForwardBusy(false);
    }
  }

  function closeForwardPicker() {
    if (forwardBusy) {
      return;
    }
    setForwardSourceMessageId(null);
    setForwardQuery('');
    setForwardSelectedIds([]);
  }

  async function handleCopyMessageLink(messageId: string) {
    try {
      const link = `${window.location.origin}/chat/message/${messageId}`;
      await navigator.clipboard.writeText(link);
    } catch {
      // keep silent when clipboard access is unavailable
    }
  }

  function handleComposerEmojiSelect(emojiData: EmojiClickData) {
    const composerEl = composerInputRef.current;
    if (!composerEl) {
      return;
    }

    composerEl.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !composerEl.contains(selection.anchorNode)) {
      placeCaretAtEnd(composerEl);
    }

    const activeSelection = window.getSelection();
    if (!activeSelection || activeSelection.rangeCount === 0) {
      return;
    }

    const range = activeSelection.getRangeAt(0);
    const emojiNode = document.createElement('img');
    emojiNode.className = 'chat-ios-emoji';
    emojiNode.src = getAppleEmojiAssetUrl(emojiData.unified);
    emojiNode.alt = emojiData.emoji;
    emojiNode.setAttribute('draggable', 'false');
    emojiNode.dataset.emoji = emojiData.emoji;

    range.deleteContents();
    range.insertNode(emojiNode);
    range.setStartAfter(emojiNode);
    range.setEndAfter(emojiNode);
    activeSelection.removeAllRanges();
    activeSelection.addRange(range);

    setComposerText(readComposerText(composerEl));
  }

  function handleReactionEmojiSelect(emojiData: EmojiClickData, messageId: string) {
    void handleReact(messageId, emojiData.emoji);
    setReactionPickerMessageId(null);
  }

  async function toggleConversationPin() {
    if (!activeConversationId || !activeConversation) {
      setHeaderMenuOpen(false);
      return;
    }
    const next = !activeConversation.is_pinned;
    setHeaderMenuOpen(false);
    try {
      await patchChatConversationPreferencesRequest(activeConversationId, { is_pinned: next });
      await refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update pin');
    }
  }

  async function toggleConversationMute() {
    if (!activeConversationId || !activeConversation) {
      setHeaderMenuOpen(false);
      return;
    }
    const next = !activeConversation.is_muted;
    setHeaderMenuOpen(false);
    try {
      await patchChatConversationPreferencesRequest(activeConversationId, { is_muted: next });
      await refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update mute');
    }
  }

  async function handleDeleteConversationFromList() {
    if (!activeConversationId) {
      return;
    }
    const deletingId = activeConversationId;
    try {
      await deleteChatConversationRequest(deletingId);
      const rows = await refreshConversations();
      const nextActiveId = rows.find((convo) => convo.id !== deletingId)?.id ?? null;
      setActiveConversationId(nextActiveId);
      setMessages([]);
      if (nextActiveId) {
        await loadMessages(nextActiveId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete conversation');
    }
    setHeaderMenuOpen(false);
  }

  async function handleClearChat() {
    if (!activeConversationId) {
      return;
    }
    if (!window.confirm('Clear all messages in this chat?')) {
      return;
    }
    try {
      await clearChatConversationRequest(activeConversationId);
      setMessages([]);
      await refreshConversations();
      setHeaderMenuOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to clear chat');
    }
  }

  function handleCloseChatView() {
    setChatViewClosed(true);
    setActiveConversationId(null);
    setMessages([]);
    setMessageSearchOpen(false);
    setMessageSearchQuery('');
    setHeaderMenuOpen(false);
    setReplyingTo(null);
    setIsEmojiPickerOpen(false);
    setReactionPickerMessageId(null);
    setActionMenuMessageId(null);
  }

  function openImageViewer(items: { id: string; name: string }[], index: number) {
    if (items.length === 0) {
      return;
    }
    setImageViewerZoom(1);
    setImageViewer({ items, index });
  }

  function moveImageViewer(step: number) {
    setImageViewer((current) => {
      if (!current || current.items.length === 0) {
        return current;
      }
      const nextIndex = (current.index + step + current.items.length) % current.items.length;
      setImageViewerZoom(1);
      return { ...current, index: nextIndex };
    });
  }

  return (
    <section className="chat-page">
      <div className="chat-top-search-wrap">
        <div className="chat-top-search-row">
          <div className="chat-top-search-inner">
            <div className="chat-top-search">
              <Search size={16} />
              <input
                value={chatSearch}
                onChange={(event) => setChatSearch(event.target.value)}
                placeholder="Search chats, people, messages"
              />
            </div>
            {chatSearch.trim() ? (
          <div className="chat-top-search-results">
            <div className="chat-top-search-meta">People</div>
            {searchedUsers.length === 0 ? <div className="chat-top-search-empty">No users found.</div> : null}
            {searchedUsers.map((user) => {
              const existingConvo = conversationByUserId.get(user.id);
              const isApproved = approvedChatUserIds.has(user.id);
              return (
                <div key={user.id} className="chat-top-search-user-row">
                  <div className="chat-user-identity">
                    <Avatar name={user.name} avatarUrl={user.avatar_url} />
                    <div>
                      <p>{user.name}</p>
                      <span>{user.employee_id}</span>
                    </div>
                  </div>
                  {existingConvo || isApproved ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (existingConvo) {
                          setActiveConversationId(existingConvo.id);
                          void loadMessages(existingConvo.id);
                          setChatSearch('');
                          return;
                        }
                        void handleSendRequest(user.id);
                      }}
                    >
                      Open
                    </button>
                  ) : (
                    <button type="button" onClick={() => void handleSendRequest(user.id)}>
                      Request
                    </button>
                  )}
                </div>
              );
            })}
          </div>
            ) : null}
          </div>
          <div className="chat-requests-notify-wrap" ref={chatRequestsNotifyRef}>
            <button
              type="button"
              className="chat-requests-notify-btn"
              title="Chat requests & approvals"
              aria-label={`Chat requests and approvals${chatRequestActionCount ? `, ${chatRequestActionCount} need your response` : ''}`}
              aria-expanded={chatRequestsPanelOpen}
              onClick={() => setChatRequestsPanelOpen((open) => !open)}
            >
              <UserPlus size={18} strokeWidth={2} aria-hidden />
              {chatRequestActionCount > 0 ? (
                <span className="chat-requests-notify-badge">{chatRequestActionCount > 99 ? '99+' : chatRequestActionCount}</span>
              ) : null}
            </button>
            {chatRequestsPanelOpen ? (
              <div className="chat-requests-panel" role="dialog" aria-label="Chat requests">
                <div className="chat-requests-panel-head">
                  <h3>Requests & approvals</h3>
                  <p>People who want to chat with you, and requests you have sent.</p>
                </div>
                {pendingInboundChatRequests.length > 0 ? (
                  <div className="chat-requests-section">
                    <div className="chat-requests-section-label">Needs your response</div>
                    <ul className="chat-requests-list">
                      {pendingInboundChatRequests.map((req) => (
                        <li key={req.id} className="chat-requests-card">
                          <Avatar name={req.requester_name} avatarUrl={req.requester_avatar_url} />
                          <div className="chat-requests-card-body">
                            <strong>{req.requester_name}</strong>
                            <span className="chat-requests-card-meta">
                              {req.requester_employee_id ?? '—'}
                              {' · '}wants to start a chat
                            </span>
                            <div className="chat-requests-card-actions">
                              <button
                                type="button"
                                className="chat-requests-btn chat-requests-btn--approve"
                                disabled={chatRequestBusyId === req.id}
                                onClick={() => void handleActOnChatRequest(req.id, 'approve')}
                              >
                                {chatRequestBusyId === req.id ? '…' : 'Approve'}
                              </button>
                              <button
                                type="button"
                                className="chat-requests-btn chat-requests-btn--reject"
                                disabled={chatRequestBusyId === req.id}
                                onClick={() => void handleActOnChatRequest(req.id, 'reject')}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {pendingOutboundChatRequests.length > 0 ? (
                  <div className="chat-requests-section">
                    <div className="chat-requests-section-label">Waiting for their response</div>
                    <ul className="chat-requests-list">
                      {pendingOutboundChatRequests.map((req) => (
                        <li key={req.id} className="chat-requests-card chat-requests-card--muted">
                          <Avatar name={req.recipient_name} avatarUrl={req.recipient_avatar_url} />
                          <div className="chat-requests-card-body">
                            <strong>{req.recipient_name}</strong>
                            <span className="chat-requests-card-meta">
                              {req.recipient_employee_id ?? '—'}
                              {' · '}invite pending
                            </span>
                            <div className="chat-requests-card-actions">
                              <button
                                type="button"
                                className="chat-requests-btn chat-requests-btn--ghost"
                                disabled={chatRequestBusyId === req.id}
                                onClick={() => void handleActOnChatRequest(req.id, 'cancel')}
                              >
                                {chatRequestBusyId === req.id ? '…' : 'Cancel request'}
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {pendingInboundChatRequests.length === 0 && pendingOutboundChatRequests.length === 0 ? (
                  <p className="chat-requests-panel-empty">No pending chat requests.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <aside className="chat-left-panel">
        <div className="chat-recent-header">
          <span>Recent Chats</span>
        </div>
        <div className="chat-conversations">
          {filteredConversations.map((convo) => (
            <button
              key={convo.id}
              type="button"
              className={`chat-conversation-item ${activeConversationId === convo.id ? 'active' : ''}`}
              onClick={() => {
                setChatViewClosed(false);
                setActiveConversationId(convo.id);
                void loadMessages(convo.id);
              }}
            >
              <div className="chat-recent-row-main">
                <Avatar name={convo.other_user_name} avatarUrl={convo.other_user_avatar_url} />
                <div className="chat-recent-text">
                  <p>{convo.other_user_name}</p>
                  <small>{convo.last_message?.body ?? convo.other_user_employee_id}</small>
                </div>
              </div>
              <div className="chat-recent-meta">
                <small>
                  {convo.last_message_at
                    ? new Date(convo.last_message_at).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })
                    : ''}
                </small>
                {convo.is_pinned || convo.is_muted ? (
                  <span
                    className="chat-conversation-status"
                    title={[convo.is_pinned ? 'Pinned' : null, convo.is_muted ? 'Muted' : null].filter(Boolean).join(' · ')}
                  >
                    {convo.is_pinned ? <Pin size={12} /> : null}
                    {convo.is_muted ? <BellOff size={12} /> : null}
                  </span>
                ) : null}
              {convo.unread_count > 0 ? <span className="chat-unread-badge">{convo.unread_count}</span> : null}
              </div>
            </button>
          ))}
          {filteredConversations.length === 0 ? <p className="chat-muted">No chats found.</p> : null}
        </div>
      </aside>

      <section className="chat-main-panel">
        {activeConversationId ? (
          <>
        <header className="chat-main-header">
          <div className="chat-main-header-left">
            <div className="chat-main-user">
              <Avatar name={activeConversation?.other_user_name ?? 'Contact'} avatarUrl={activeConversation?.other_user_avatar_url ?? null} />
              <div>
                <h3>{activeConversation?.other_user_name ?? 'Select conversation'}</h3>
                <span>{activeConversation?.other_user_designation ?? ''}</span>
              </div>
            </div>
            <nav className="chat-main-tabs" aria-label="Conversation sections">
              <button type="button" className={conversationViewMode === 'chat' ? 'active' : ''} onClick={() => setConversationViewMode('chat')}>Chat</button>
              <button type="button" className={conversationViewMode === 'files' ? 'active' : ''} onClick={() => setConversationViewMode('files')}>Files</button>
              <button type="button" className={conversationViewMode === 'photos' ? 'active' : ''} onClick={() => setConversationViewMode('photos')}>Photos</button>
            </nav>
          </div>
          <div className="chat-main-header-actions" ref={headerMenuRef}>
            {messageSearchOpen ? (
              <input
                className="chat-inline-search-input"
                value={messageSearchQuery}
                onChange={(event) => setMessageSearchQuery(event.target.value)}
                placeholder="Search messages"
              />
            ) : null}
            <button type="button" title="Find in chat" onClick={() => setMessageSearchOpen((current) => !current)}><Search size={15} /></button>
            <button type="button" title="More" onClick={() => setHeaderMenuOpen((current) => !current)}>
              <MoreHorizontal size={15} />
            </button>
            {headerMenuOpen ? (
              <div className="chat-header-more-menu">
                <button type="button" onClick={() => void toggleConversationPin()}>
                  {activeConversation?.is_pinned ? <PinOff size={15} /> : <Pin size={15} />}
                  {activeConversation?.is_pinned ? 'Unpin' : 'Pin'}
                </button>
                <button type="button" onClick={() => void toggleConversationMute()}>
                  {activeConversation?.is_muted ? <Bell size={15} /> : <BellOff size={15} />}
                  {activeConversation?.is_muted ? 'Unmute' : 'Mute'}
                </button>
                <button type="button" onClick={() => void handleDeleteConversationFromList()}>
                  <Trash2 size={15} />
                  Delete
                </button>
                <button type="button" onClick={() => { setConversationViewMode('files'); setHeaderMenuOpen(false); }}>
                  <FileText size={15} />
                  Files
                </button>
                <button type="button" onClick={() => { setConversationViewMode('photos'); setHeaderMenuOpen(false); }}>
                  <Image size={15} />
                  Photos
                </button>
                <button type="button" onClick={() => void handleClearChat()}>
                  <Trash2 size={15} />
                  Clear chat
                </button>
                <button type="button" onClick={() => handleCloseChatView()}>
                  <X size={15} />
                  Close chat
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="chat-message-list">
          {visibleMessages.map((message, index) => {
            const mine = message.sender_id === currentUserId;
            const imageAttachments = message.attachments.filter((att) => isImageMime(att.mime_type));
            const fileAttachments = message.attachments.filter((att) => !isImageMime(att.mime_type));
            const hasAttachments = message.attachments.length > 0;
            const isDeletedMessage =
              Boolean(message.deleted_at)
              || (
                message.body == null
                && message.attachments.length === 0
                && !message.reply_to
                && !message.forwarded_from
              );
            const previous = index > 0 ? visibleMessages[index - 1] : null;
            const showDayDivider = !previous || formatMessageDay(previous.created_at) !== formatMessageDay(message.created_at);
            const imageItems = imageAttachments.map((att) => ({ id: att.id, name: att.filename }));
            return (
              <Fragment key={message.id}>
                {showDayDivider ? <div className="chat-day-divider">{formatMessageDay(message.created_at)}</div> : null}
                <div className={`chat-message-row ${mine ? 'chat-message-row--mine' : 'chat-message-row--theirs'}`}>
                {!mine ? <Avatar name={message.sender_name} avatarUrl={message.sender_avatar_url} /> : null}
                <div className="chat-message-stack">
                  {!mine && !isDeletedMessage ? (
                    <div className="chat-message-meta-row">
                      <span className="chat-message-meta-name">{message.sender_name}</span>
                      <span className="chat-message-meta-time">{formatMessageTime(message.created_at)}</span>
                    </div>
                  ) : null}
                  <div className={`chat-message-bubble-row ${mine ? 'chat-message-bubble-row--mine' : ''}`}>
                  {mine && !isDeletedMessage ? (
                    <span className="chat-message-meta-time chat-message-meta-time--inline">{formatMessageTime(message.created_at)}</span>
                  ) : null}
                  <article
                  className={`chat-message-bubble ${mine ? 'mine' : 'theirs'}${message.forwarded_from ? ' chat-message-bubble--forwarded' : ''}${hasAttachments ? ' chat-message-bubble--with-attachments' : ''}${isDeletedMessage ? ' chat-message-bubble--deleted' : ''}`}
                  >
                  {message.reply_to ? <p className="chat-reply-preview">Reply: {message.reply_to.body ?? '[deleted]'}</p> : null}
                  {message.forwarded_from ? (
                    <div className="chat-forward-banner" role="note">
                      <Forward size={13} className="chat-forward-banner-icon" aria-hidden />
                      <span className="chat-forward-banner-text">
                        <span className="chat-forward-banner-label">Forwarded from</span>
                        <span className="chat-forward-banner-name">{message.forwarded_from.sender_name}</span>
                      </span>
                    </div>
                  ) : null}
                  {isDeletedMessage ? (
                    <p className="chat-message-body chat-message-body--deleted">This message has been deleted</p>
                  ) : message.body ? (
                    <p className="chat-message-body">{renderWithIosEmoji(message.body)}</p>
                  ) : null}
                  {!isDeletedMessage && imageAttachments.length > 0 ? (
                    <div className="chat-attachments chat-attachments--images">
                      {imageAttachments.map((att) => (
                        <a
                          key={att.id}
                          href={messageAttachmentUrls[att.id] ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="chat-attachment-image-link"
                          title={att.filename}
                          download={att.filename}
                          onClick={(event) => {
                            if (!messageAttachmentUrls[att.id]) {
                              event.preventDefault();
                              return;
                            }
                            event.preventDefault();
                            openImageViewer(imageItems, imageItems.findIndex((item) => item.id === att.id));
                          }}
                        >
                          {messageAttachmentUrls[att.id] ? (
                            <img
                              src={messageAttachmentUrls[att.id]}
                              alt={att.filename}
                              className="chat-attachment-image"
                              loading="lazy"
                            />
                          ) : (
                            <span className="chat-attachment-image-fallback">{att.filename}</span>
                          )}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {!isDeletedMessage && fileAttachments.length > 0 ? (
                    <div className="chat-attachments chat-attachments--files">
                      {fileAttachments.map((att) => (
                        <a
                          key={att.id}
                          href={messageAttachmentUrls[att.id] ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="chat-attachment-file"
                          title={att.filename}
                          download={att.filename}
                          onClick={(event) => {
                            if (!messageAttachmentUrls[att.id]) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <span className="chat-attachment-file-icon" aria-hidden>
                            <FileText size={15} strokeWidth={2} />
                          </span>
                          <span className="chat-attachment-file-meta">
                            <span className="chat-attachment-file-name">{att.filename}</span>
                            <span className="chat-attachment-file-type">{att.mime_type || 'File'}</span>
                          </span>
                          <span className="chat-attachment-file-download">
                            <Download size={13} strokeWidth={2.2} />
                            Download
                          </span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {isDeletedMessage ? null : (
                  <div className="chat-message-toolbar">
                    <div className="chat-message-toolbar-reactions">
                      {HOVER_QUICK_REACTIONS.map((emoji) => (
                        <button
                          key={`${message.id}-${emoji}`}
                          type="button"
                          className="chat-message-toolbar-emoji-btn"
                          title={`React ${emoji}`}
                          onClick={() => void handleReact(message.id, emoji)}
                        >
                          {renderWithIosEmoji(emoji)}
                        </button>
                      ))}
                    </div>
                    <span className="chat-message-toolbar-divider" />
                    <button
                      type="button"
                      title="More reactions"
                      onClick={() =>
                        setReactionPickerMessageId((current) => (current === message.id ? null : message.id))
                      }
                    >
                      <SmilePlus size={13} />
                    </button>
                    {mine ? (
                      <>
                        <button type="button" title="Edit" disabled={editingMessageId === message.id} onClick={() => void handleEditMessage(message)}>
                          <Pencil size={13} />
                        </button>
                        <button type="button" title="Delete" onClick={() => void handleDeleteMessage(message.id)}>
                          <Trash2 size={13} />
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      title="More"
                      onClick={() => setActionMenuMessageId((current) => (current === message.id ? null : message.id))}
                    >
                      <MoreHorizontal size={13} />
                    </button>
                    {reactionPickerMessageId === message.id ? (
                      <div className="chat-reaction-picker">
                        <EmojiPicker
                          onEmojiClick={(emojiData) => handleReactionEmojiSelect(emojiData, message.id)}
                          lazyLoadEmojis
                          width={280}
                          height={320}
                          theme={Theme.LIGHT}
                          emojiStyle={EmojiStyle.APPLE}
                          previewConfig={{ showPreview: false }}
                        />
                      </div>
                    ) : null}
                    {actionMenuMessageId === message.id ? (
                      <div className="chat-message-more-menu">
                        <button type="button" onClick={() => { setReplyingTo(message); setActionMenuMessageId(null); }}>
                          <Undo2 size={15} />
                          Reply
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setForwardSourceMessageId(message.id);
                            setForwardQuery('');
                            setForwardSelectedIds([]);
                            setActionMenuMessageId(null);
                          }}
                        >
                          <Forward size={15} />
                          Forward
                        </button>
                        <button type="button" onClick={() => { void handleCopyMessageLink(message.id); setActionMenuMessageId(null); }}>
                          <Link2 size={15} />
                          Copy link
                        </button>
                        {mine ? <button type="button" onClick={() => { void handleDeleteMessage(message.id); setActionMenuMessageId(null); }}><Trash2 size={15} />Delete</button> : null}
                        <button type="button" onClick={() => setActionMenuMessageId(null)}>
                          <Pin size={15} />
                          Pin for everyone
                        </button>
                        <button type="button" onClick={() => setActionMenuMessageId(null)}>
                          <Mail size={15} />
                          Mark as unread
                        </button>
                        <button type="button" onClick={() => setActionMenuMessageId(null)}>
                          <Languages size={15} />
                          Translation
                          <ChevronRight size={14} className="chat-menu-arrow" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  )}
                  </article>
                  </div>
                  {!isDeletedMessage && message.reactions.length > 0 ? (
                    <div className="chat-reactions chat-reactions--below">
                      {message.reactions.map((reaction) => (
                        <button key={reaction.emoji} type="button" onClick={() => void handleReact(message.id, reaction.emoji)}>
                          {renderWithIosEmoji(reaction.emoji)}
                          {reaction.count > 1 ? ` ${reaction.count}` : ''}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {mine ? (
                  <span className="chat-read-state chat-read-state--outside" title={message.is_read_by_other ? 'Read' : 'Sent'}>
                    {message.is_read_by_other ? <Eye size={12} /> : <CheckCircle2 size={12} />}
                  </span>
                ) : null}
                </div>
              </Fragment>
            );
          })}
          {visibleMessages.length === 0 ? <p className="chat-muted">No related messages found.</p> : null}
        </div>

        <div className="chat-composer">
          {replyingTo ? (
            <div className="chat-reply-bar" role="status">
              <div className="chat-reply-bar-main">
                <div className="chat-reply-bar-topline">
                  <span className="chat-reply-bar-kicker">Replying to</span>
                  <strong className="chat-reply-bar-name">{replyingTo.sender_name}</strong>
                </div>
                <p className="chat-reply-bar-quote">{replyingTo.body ?? '[deleted]'}</p>
              </div>
              <button
                type="button"
                className="chat-reply-bar-dismiss"
                onClick={() => setReplyingTo(null)}
                aria-label="Cancel reply"
                title="Cancel reply"
              >
                <X size={15} strokeWidth={2.25} />
              </button>
            </div>
          ) : null}
          <div className={`chat-composer-shell${voiceRecording ? ' chat-composer-shell--voice-active' : ''}`}>
            {voiceRecording ? (
              <div className="chat-voice-recording-bar" aria-live="polite">
                <span className="chat-voice-recording-pulse" aria-hidden />
                <span>
                  Recording <strong>{formatVoiceDuration(voiceRecordSeconds)}</strong>
                  <span className="chat-voice-recording-hint"> — release to send</span>
                </span>
              </div>
            ) : null}
            <div className="chat-composer-top">
              <div className="chat-composer-input-wrap">
                <div
                  ref={composerInputRef}
                  className="chat-composer-input"
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-label="Type a message"
                  data-placeholder="Type a message"
                  onInput={() => {
                    if (composerInputRef.current) {
                      setComposerText(readComposerText(composerInputRef.current));
                    }
                  }}
                />
              </div>
              <div className="chat-composer-toolbar">
                <div className="chat-composer-actions" aria-label="Composer tools">
                  <button
                    type="button"
                    title="Emoji"
                    ref={emojiTriggerRef}
                    onClick={() => setIsEmojiPickerOpen((current) => !current)}
                  >
                    <Smile size={17} strokeWidth={1.85} />
                  </button>
                  <button type="button" title="Image" onClick={() => fileInputRef.current?.click()}>
                    <Image size={17} strokeWidth={1.85} />
                  </button>
                  <button type="button" title="Attachment" onClick={() => fileInputRef.current?.click()}>
                    <Paperclip size={17} strokeWidth={1.85} />
                  </button>
                  <button
                    type="button"
                    className={`chat-composer-voice${voiceRecording ? ' chat-composer-voice--recording' : ''}`}
                    title="Hold to record voice message"
                    aria-label="Hold to record a voice message. Release to send."
                    disabled={isSending || !activeConversationId}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || isSending || !activeConversationId) {
                        return;
                      }
                      micPointerDownRef.current = true;
                      try {
                        (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
                      } catch {
                        /* ignore */
                      }
                      void startVoiceRecording();
                    }}
                    onPointerUp={(event) => {
                      micPointerDownRef.current = false;
                      try {
                        (event.currentTarget as HTMLButtonElement).releasePointerCapture(event.pointerId);
                      } catch {
                        /* ignore */
                      }
                      stopVoiceRecording();
                    }}
                    onPointerCancel={() => {
                      discardVoiceRecordingRef.current = true;
                      micPointerDownRef.current = false;
                      stopVoiceRecording();
                    }}
                    onContextMenu={(event) => event.preventDefault()}
                  >
                    <Mic size={17} strokeWidth={2} />
                  </button>
                </div>
                <button
                  type="button"
                  className="chat-composer-send"
                  title="Send"
                  disabled={isSending}
                  onClick={() => void handleSendMessage()}
                >
                  <SendHorizontal size={18} strokeWidth={2} />
                </button>
              </div>
            </div>
            {isEmojiPickerOpen ? (
              <div className="chat-emoji-picker-wrap" ref={emojiPickerRef}>
                <EmojiPicker
                  onEmojiClick={handleComposerEmojiSelect}
                  lazyLoadEmojis
                  width={360}
                  height={360}
                  theme={Theme.LIGHT}
                  emojiStyle={EmojiStyle.APPLE}
                  previewConfig={{ showPreview: false }}
                />
              </div>
            ) : null}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="chat-file-input-hidden"
            onChange={(event) =>
              setSelectedFiles((current) => [...current, ...Array.from(event.target.files ?? [])])
            }
          />
          {selectedFiles.length > 0 ? (
            <div className="chat-file-pill-list">
              {selectedFilePreviews.map((item) => {
                const { file, index, isImage, previewUrl } = item;
                return (
                  <span
                    key={`${file.name}-${index}`}
                    className={`chat-file-pill${isImage ? ' chat-file-pill--image' : ''}`}
                  >
                    {isImage && previewUrl ? (
                      <img src={previewUrl} alt={file.name} className="chat-file-pill-thumb" />
                    ) : (
                      <span className="chat-file-pill-icon" aria-hidden>
                        <FileText size={14} strokeWidth={2.1} />
                      </span>
                    )}
                    <span className="chat-file-pill-name">{file.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => setSelectedFiles((current) => current.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
          </>
        ) : null}
      </section>

      {error ? <p className="chat-error">{error}</p> : null}

      {forwardSourceMessageId ? (
        <div
          className="chat-forward-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeForwardPicker();
            }
          }}
        >
          <div
            className="chat-forward-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-forward-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="chat-forward-modal-head">
              <div>
                <h2 id="chat-forward-modal-title">Forward to</h2>
                <p className="chat-forward-modal-sub">Select one or more chats, then Send</p>
              </div>
              <button type="button" className="chat-forward-modal-close" title="Close" onClick={() => closeForwardPicker()}>
                <X size={18} />
              </button>
            </header>
            <div className="chat-forward-modal-search">
              <Search size={15} aria-hidden />
              <input
                type="search"
                value={forwardQuery}
                onChange={(event) => setForwardQuery(event.target.value)}
                placeholder="Search by name or ID…"
                aria-label="Filter chats to forward to"
              />
            </div>
            <div className="chat-forward-modal-list">
              {forwardTargetConversations.length === 0 ? (
                <p className="chat-forward-modal-empty">
                  {conversations.length <= 1
                    ? 'You need another open chat to forward to. Start a conversation from the search box on the left.'
                    : 'No chats match your search.'}
                </p>
              ) : (
                forwardTargetConversations.map((convo) => {
                  const selected = forwardSelectedIds.includes(convo.id);
                  return (
                    <button
                      key={convo.id}
                      type="button"
                      className={`chat-forward-modal-row${selected ? ' chat-forward-modal-row--selected' : ''}`}
                      disabled={forwardBusy}
                      aria-pressed={selected}
                      onClick={() => toggleForwardTarget(convo.id)}
                    >
                      <Avatar name={convo.other_user_name} avatarUrl={convo.other_user_avatar_url} />
                      <div className="chat-forward-modal-row-text">
                        <span className="chat-forward-modal-row-name">{convo.other_user_name}</span>
                        <span className="chat-forward-modal-row-meta">
                          {convo.other_user_employee_id}
                          {convo.other_user_designation ? ` · ${convo.other_user_designation}` : ''}
                        </span>
                      </div>
                      <span className={`chat-forward-modal-check${selected ? ' chat-forward-modal-check--on' : ''}`} aria-hidden>
                        {selected ? <Check size={14} strokeWidth={2.8} /> : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <footer className="chat-forward-modal-footer">
              <span className="chat-forward-modal-footer-hint">
                {forwardSelectedIds.length === 0 ? 'No chats selected' : `${forwardSelectedIds.length} chat${forwardSelectedIds.length === 1 ? '' : 's'} selected`}
              </span>
              <button
                type="button"
                className="chat-forward-modal-send"
                disabled={forwardSelectedIds.length === 0 || forwardBusy}
                onClick={() => void submitForwardToSelected()}
              >
                {forwardBusy ? 'Sending…' : 'Send'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {imageViewer ? (
        <div
          className="chat-image-viewer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setImageViewer(null);
            }
          }}
        >
          <div className="chat-image-viewer" role="dialog" aria-modal="true" aria-label="Image preview">
            <button
              type="button"
              className="chat-image-viewer-close"
              onClick={() => {
                setImageViewer(null);
                setImageViewerZoom(1);
              }}
              aria-label="Close preview"
            >
              <X size={18} />
            </button>
            <div className="chat-image-viewer-main">
              {imageViewer.items.length > 1 ? (
                <button type="button" className="chat-image-viewer-nav chat-image-viewer-nav--prev" onClick={() => moveImageViewer(-1)} aria-label="Previous image">
                  <ChevronLeft size={22} />
                </button>
              ) : null}
              <img
                src={messageAttachmentUrls[imageViewer.items[imageViewer.index]?.id] ?? ''}
                alt={imageViewer.items[imageViewer.index]?.name ?? 'Preview'}
                className="chat-image-viewer-image"
                style={{ transform: `scale(${imageViewerZoom})` }}
              />
              {imageViewer.items.length > 1 ? (
                <button type="button" className="chat-image-viewer-nav chat-image-viewer-nav--next" onClick={() => moveImageViewer(1)} aria-label="Next image">
                  <ChevronRight size={22} />
                </button>
              ) : null}
            </div>
            <div className="chat-image-viewer-footer">
              <span className="chat-image-viewer-name">{imageViewer.items[imageViewer.index]?.name ?? ''}</span>
              <div className="chat-image-viewer-controls">
                <button
                  type="button"
                  className="chat-image-viewer-control-btn"
                  aria-label="Zoom out"
                  title="Zoom out"
                  onClick={() => setImageViewerZoom((zoom) => Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10))}
                >
                  -
                </button>
                <button
                  type="button"
                  className="chat-image-viewer-control-btn chat-image-viewer-control-btn--label"
                  aria-label="Reset zoom"
                  title="Reset zoom"
                  onClick={() => setImageViewerZoom(1)}
                >
                  {Math.round(imageViewerZoom * 100)}%
                </button>
                <button
                  type="button"
                  className="chat-image-viewer-control-btn"
                  aria-label="Zoom in"
                  title="Zoom in"
                  onClick={() => setImageViewerZoom((zoom) => Math.min(3, Math.round((zoom + 0.1) * 10) / 10))}
                >
                  +
                </button>
              </div>
              <a
                href={messageAttachmentUrls[imageViewer.items[imageViewer.index]?.id] ?? '#'}
                className="chat-image-viewer-download"
                download={imageViewer.items[imageViewer.index]?.name ?? 'image'}
                onClick={(event) => {
                  if (!messageAttachmentUrls[imageViewer.items[imageViewer.index]?.id]) {
                    event.preventDefault();
                  }
                }}
              >
                <Download size={14} />
                Download
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
