import {
  Bell,
  Check,
  CircleCheckBig,
  CircleX,
  Eye,
  Forward,
  Image,
  Laugh,
  MoreHorizontal,
  Pencil,
  Paperclip,
  Phone,
  Plus,
  Reply,
  Search,
  SendHorizontal,
  Smile,
  SmilePlus,
  Sticker,
  Trash2,
  CheckCircle2,
  Video,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  actOnChatRequestRequest,
  chatAttachmentFileUrl,
  createChatRequestRequest,
  deleteChatMessageRequest,
  editChatMessageRequest,
  forwardChatMessageRequest,
  getChatConversationsRequest,
  getChatRequestsRequest,
  getConversationMessagesRequest,
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

const REACTION_OPTIONS = ['👍', '❤️', '🔥', '🎉', '😂', '👏'];

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
  const [chatSearch, setChatSearch] = useState('');
  const [searchedUsers, setSearchedUsers] = useState<ChatSearchUserRecord[]>([]);
  const [requests, setRequests] = useState<ChatRequestRecord[]>([]);
  const [conversations, setConversations] = useState<ChatConversationRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [composerText, setComposerText] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessageRecord | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollInFlightRef = useRef(false);

  const incomingPending = useMemo(
    () => requests.filter((row) => row.status === 'pending' && row.recipient_id === currentUserId),
    [requests, currentUserId],
  );

  const outgoingPending = useMemo(
    () => requests.filter((row) => row.status === 'pending' && row.requester_id === currentUserId),
    [requests, currentUserId],
  );

  const activeConversation = useMemo(
    () => conversations.find((row) => row.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );
  const requestUpdates = useMemo(
    () =>
      requests
        .filter((row) => row.status !== 'pending')
        .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
        .slice(0, 6),
    [requests],
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

  async function refreshAll() {
    await Promise.all([refreshRequests(), refreshConversations()]);
  }

  async function refreshRequests() {
    try {
      const rows = await getChatRequestsRequest();
      setRequests(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load chat requests');
    }
  }

  async function refreshConversations() {
    try {
      const rows = await getChatConversationsRequest();
      setConversations(rows);
      if (!activeConversationId && rows.length > 0) {
        setActiveConversationId(rows[0].id);
        void loadMessages(rows[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load conversations');
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

  async function handleRequestAction(requestId: string, action: 'approve' | 'reject' | 'cancel') {
    try {
      await actOnChatRequestRequest(requestId, action);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update request');
    }
  }

  async function handleSendRequest(userId: string) {
    try {
      await createChatRequestRequest(userId);
      await refreshRequests();
      setSearchedUsers([]);
      setChatSearch('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send chat request');
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
      setSelectedFiles([]);
      setReplyingTo(null);
      void refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send message');
    } finally {
      setIsSending(false);
    }
  }

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

  async function handleForward(messageId: string) {
    if (!activeConversationId) {
      return;
    }
    const target = window.prompt('Enter conversation ID to forward message');
    if (!target?.trim()) {
      return;
    }
    try {
      const sent = await forwardChatMessageRequest(messageId, target.trim());
      if (sent.conversation_id === activeConversationId) {
        setMessages((current) => [...current, sent]);
      }
      void refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to forward message');
    }
  }

  return (
    <section className="chat-page">
      <div className="chat-top-search-wrap">
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
              return (
                <div key={user.id} className="chat-top-search-user-row">
                  <div className="chat-user-identity">
                    <Avatar name={user.name} avatarUrl={user.avatar_url} />
                    <div>
                      <p>{user.name}</p>
                      <span>{user.employee_id}</span>
                    </div>
                  </div>
                  {existingConvo ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveConversationId(existingConvo.id);
                        void loadMessages(existingConvo.id);
                        setChatSearch('');
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
      <aside className="chat-left-panel">
        <div className="chat-request-box">
          <h4>Incoming Requests</h4>
          {incomingPending.length === 0 ? <p className="chat-muted">No pending requests.</p> : null}
          {incomingPending.map((req) => (
            <div key={req.id} className="chat-request-row">
              <div className="chat-user-identity">
                <Avatar name={req.requester_name} avatarUrl={req.requester_avatar_url} />
                <div>
                  <p>{req.requester_name}</p>
                  <span>{req.requester_employee_id ?? ''}</span>
                </div>
              </div>
              <div className="chat-request-actions">
                <button type="button" className="chat-icon-btn chat-icon-btn--approve" title="Approve" onClick={() => void handleRequestAction(req.id, 'approve')}>
                  <Check size={14} />
                </button>
                <button type="button" className="chat-icon-btn chat-icon-btn--reject" title="Reject" onClick={() => void handleRequestAction(req.id, 'reject')}>
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
          {outgoingPending.length > 0 ? (
            <>
              <h4>Outgoing</h4>
              {outgoingPending.map((req) => (
                <div key={req.id} className="chat-request-row">
                  <div className="chat-user-identity">
                    <Avatar name={req.recipient_name} avatarUrl={req.recipient_avatar_url} />
                    <div>
                      <p>{req.recipient_name}</p>
                      <span>{req.recipient_employee_id ?? ''}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="chat-icon-btn chat-icon-btn--reject"
                    title="Cancel request"
                    onClick={() => void handleRequestAction(req.id, 'cancel')}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </>
          ) : null}
        </div>

        <div className="chat-notification-box">
          <h4>
            <Bell size={14} /> Request Updates
          </h4>
          {requestUpdates.length === 0 ? <p className="chat-muted">No recent updates.</p> : null}
          {requestUpdates.map((row) => {
            const isMineRequest = row.requester_id === currentUserId;
            const otherName = isMineRequest ? row.recipient_name : row.requester_name;
            return (
              <div key={row.id} className="chat-notification-item">
                {row.status === 'approved' ? <CircleCheckBig size={14} className="chat-status-ok" /> : <CircleX size={14} className="chat-status-bad" />}
                <span>
                  <strong>{otherName}</strong> {row.status === 'approved' ? 'approved' : row.status} request
                </span>
              </div>
            );
          })}
        </div>

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
                setActiveConversationId(convo.id);
                void loadMessages(convo.id);
              }}
            >
              <div className="chat-user-identity">
                <Avatar name={convo.other_user_name} avatarUrl={convo.other_user_avatar_url} />
                <div>
                <p>{convo.other_user_name}</p>
                <small>{convo.other_user_employee_id}</small>
                </div>
              </div>
              {convo.unread_count > 0 ? <span className="chat-unread-badge">{convo.unread_count}</span> : null}
            </button>
          ))}
          {filteredConversations.length === 0 ? <p className="chat-muted">No chats found.</p> : null}
        </div>
      </aside>

      <section className="chat-main-panel">
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
              <button type="button" className="active">Chat</button>
              <button type="button">Files</button>
              <button type="button">Photos</button>
            </nav>
          </div>
          <div className="chat-main-header-actions">
            <button type="button" title="Video call"><Video size={15} /></button>
            <button type="button" title="Audio call"><Phone size={15} /></button>
            <button type="button" title="Find in chat"><Search size={15} /></button>
            <button type="button" title="More"><MoreHorizontal size={15} /></button>
          </div>
        </header>

        <div className="chat-message-list">
          {messages.map((message) => {
            const mine = message.sender_id === currentUserId;
            return (
              <div key={message.id} className={`chat-message-row ${mine ? 'chat-message-row--mine' : 'chat-message-row--theirs'}`}>
                {!mine ? <Avatar name={message.sender_name} avatarUrl={message.sender_avatar_url} /> : null}
                <article className={`chat-message-bubble ${mine ? 'mine' : 'theirs'}`}>
                  {message.reply_to ? <p className="chat-reply-preview">Reply: {message.reply_to.body ?? '[deleted]'}</p> : null}
                  {message.forwarded_from ? (
                    <p className="chat-reply-preview">Forwarded from {message.forwarded_from.sender_name}</p>
                  ) : null}
                  <p className="chat-message-body">{message.body ?? '[deleted message]'}</p>
                  {message.attachments.length > 0 ? (
                    <div className="chat-attachments">
                      {message.attachments.map((att) => (
                        <a key={att.id} href={chatAttachmentFileUrl(att.id)} target="_blank" rel="noreferrer">
                          {att.filename}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {message.reactions.length > 0 ? (
                    <div className="chat-reactions">
                      {message.reactions.map((reaction) => (
                        <button key={reaction.emoji} type="button" onClick={() => void handleReact(message.id, reaction.emoji)}>
                          {reaction.emoji} {reaction.count}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="chat-message-toolbar">
                    <button type="button" title="React 👍" onClick={() => void handleReact(message.id, REACTION_OPTIONS[0])}>👍</button>
                    <button type="button" title="React ❤️" onClick={() => void handleReact(message.id, REACTION_OPTIONS[1])}>❤️</button>
                    <button type="button" title="React 😂"><Laugh size={13} /></button>
                    <button type="button" title="React 😮"><Smile size={13} /></button>
                    <button type="button" title="Add reaction"><SmilePlus size={13} /></button>
                    <button type="button" title="Reply" onClick={() => setReplyingTo(message)}>
                      <Reply size={13} />
                    </button>
                    <button type="button" title="Forward" onClick={() => void handleForward(message.id)}>
                      <Forward size={13} />
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
                    <button type="button" title="More"><MoreHorizontal size={13} /></button>
                  </div>
                </article>
                {mine ? (
                  <span className="chat-read-state chat-read-state--outside" title={message.is_read_by_other ? 'Read' : 'Sent'}>
                    {message.is_read_by_other ? <Eye size={12} /> : <CheckCircle2 size={12} />}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="chat-composer">
          {replyingTo ? (
            <div className="chat-reply-box">
              Replying to {replyingTo.sender_name}: {replyingTo.body ?? '[deleted]'}
              <button type="button" onClick={() => setReplyingTo(null)}>
                x
              </button>
            </div>
          ) : null}
          <div className="chat-composer-shell">
            <div className="chat-composer-top">
              <textarea
                value={composerText}
                onChange={(event) => setComposerText(event.target.value)}
                placeholder="Type a message"
              />
              <div className="chat-composer-actions">
                <button type="button" title="Emoji">
                  <Smile size={16} />
                </button>
                <button type="button" title="Image" onClick={() => fileInputRef.current?.click()}>
                  <Image size={16} />
                </button>
                <button type="button" title="Attachment" onClick={() => fileInputRef.current?.click()}>
                  <Paperclip size={16} />
                </button>
                <button type="button" title="Stickers">
                  <Sticker size={16} />
                </button>
                <button type="button" title="More">
                  <Plus size={16} />
                </button>
                <button type="button" title="Send" disabled={isSending} onClick={() => void handleSendMessage()}>
                  <SendHorizontal size={18} />
                </button>
              </div>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="chat-file-input-hidden"
            onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
          />
          {selectedFiles.length > 0 ? (
            <p className="chat-muted">
              {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected
            </p>
          ) : null}
        </div>
      </section>

      {error ? <p className="chat-error">{error}</p> : null}
    </section>
  );
}
