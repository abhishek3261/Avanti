import {
  BadgeCheck, Check, CheckCheck, MessageCircle, Paperclip, RotateCcw,
  Send, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../context/AuthContext'
import { getRideChat, markRideChatRead, sendRideChatMessage, type ChatMessage, type ChatSnapshot } from '../../lib/chat'
import { getSessionRealtimeSocket } from '../../lib/realtime'
import type { RideStatus } from '../../lib/rides'

type LocalMessage = ChatMessage & { deliveryState?: 'sending' | 'failed' | 'sent' }
type SendAck = { ok: boolean; message?: ChatMessage; error?: string }
type JoinAck = { ok: boolean; canSend?: boolean; otherOnline?: boolean; error?: string }

const activeRideStatuses: RideStatus[] = ['accepted', 'driver_arriving', 'driver_arrived', 'in_progress']
const quickReplies = [
  "I'm arriving.",
  "I'm at the pickup location.",
  'Please wait 2 minutes.',
  'Where are you?',
  "I've reached the pickup point.",
]

function statusText(status: RideStatus) {
  return ({
    requested: 'Requesting driver', accepted: 'Driver assigned', driver_arriving: 'Driver arriving',
    driver_arrived: 'At pickup', in_progress: 'Trip in progress', completed: 'Trip complete',
    rejected: 'Request expired', cancelled: 'Trip cancelled',
  } as const)[status]
}

function mergeMessage(current: LocalMessage[], next: LocalMessage) {
  const index = current.findIndex(message => message.id === next.id || message.clientMessageId === next.clientMessageId)
  if (index < 0) return [...current, next].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  const merged = [...current]
  merged[index] = { ...merged[index], ...next }
  return merged
}

export default function RideChat({ rideId, rideStatus, otherPartyName, otherPartyDetail }: {
  rideId: string
  rideStatus: RideStatus
  otherPartyName: string
  otherPartyDetail: string
}) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [otherOnline, setOtherOnline] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)
  const [loading, setLoading] = useState(false)
  const [canSendFromServer, setCanSendFromServer] = useState(true)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [peerTyping, setPeerTyping] = useState(false)
  const [notice, setNotice] = useState('')
  const socketRef = useRef<ReturnType<typeof getSessionRealtimeSocket> | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const openRef = useRef(false)
  const canSendRef = useRef(false)
  const seenIdsRef = useRef(new Set<string>())
  const typingTimerRef = useRef<number | null>(null)
  const peerTypingTimerRef = useRef<number | null>(null)
  const noticeTimerRef = useRef<number | null>(null)

  const canSend = activeRideStatuses.includes(rideStatus) && canSendFromServer
  canSendRef.current = canSend
  openRef.current = open
  const initials = useMemo(() => otherPartyName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'A', [otherPartyName])

  const upsertMessage = useCallback((message: LocalMessage) => {
    seenIdsRef.current.add(message.id)
    setMessages(current => mergeMessage(current, message))
  }, [])

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const snapshot: ChatSnapshot = await getRideChat(rideId)
      for (const message of snapshot.messages) seenIdsRef.current.add(message.id)
      setMessages(current => snapshot.messages.reduce((all, message) => mergeMessage(all, { ...message, deliveryState: 'sent' }), current))
      setUnreadCount(snapshot.unreadCount)
      setCanSendFromServer(snapshot.canSend)
      setError('')
      const socket = socketRef.current
      for (const message of snapshot.messages) {
        if (socket && message.recipientId === user?.id && !message.deliveredAt) {
          socket.emit('chat:delivered', { rideId, messageId: message.id })
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this ride chat.')
    } finally {
      setLoading(false)
    }
  }, [rideId, user?.id])

  const markViewedMessagesRead = useCallback(async () => {
    if (!openRef.current || document.visibilityState !== 'visible') return
    try {
      const result = await markRideChatRead(rideId)
      setUnreadCount(0)
      if (result.readAt) {
        const readIds = new Set(result.messageIds)
        setMessages(current => current.map(message => readIds.has(message.id)
          ? { ...message, deliveredAt: message.deliveredAt || result.readAt, readAt: result.readAt }
          : message))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update message read status.')
    }
  }, [rideId])

  const joinConversation = useCallback(() => {
    const socket = socketRef.current
    if (!socket || !openRef.current || !activeRideStatuses.includes(rideStatus)) return
    if (!socket.connected) {
      socket.connect()
      return
    }
    socket.emit('chat:join', { rideId }, (result: JoinAck) => {
      if (!result?.ok) {
        setError(result?.error || 'Could not join this ride chat.')
        return
      }
      setCanSendFromServer(Boolean(result.canSend))
      setOtherOnline(Boolean(result.otherOnline))
      void loadHistory().then(() => markViewedMessagesRead())
    })
  }, [loadHistory, markViewedMessagesRead, rideId, rideStatus])

  useEffect(() => {
    const socket = getSessionRealtimeSocket()
    socketRef.current = socket
    setSocketConnected(socket.connected)
    const onMessage = (message: ChatMessage) => {
      if (message.rideId !== rideId || seenIdsRef.current.has(message.id)) return
      seenIdsRef.current.add(message.id)
      upsertMessage({ ...message, deliveryState: 'sent' })
      if (message.senderId === user?.id) return
      socket.emit('chat:delivered', { rideId, messageId: message.id })
      const actuallyViewed = openRef.current && document.visibilityState === 'visible'
      if (actuallyViewed) {
        void markViewedMessagesRead()
      } else {
        setUnreadCount(count => count + 1)
        setNotice(`New message from ${otherPartyName}`)
        if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
        noticeTimerRef.current = window.setTimeout(() => setNotice(''), 4_500)
      }
    }
    const onReceipt = (receipt: { rideId: string; messageIds: string[]; deliveredAt?: string; readAt?: string }) => {
      if (receipt.rideId !== rideId) return
      const ids = new Set(receipt.messageIds)
      setMessages(current => current.map(message => ids.has(message.id) ? {
        ...message,
        deliveredAt: receipt.deliveredAt || receipt.readAt || message.deliveredAt,
        readAt: receipt.readAt || message.readAt,
      } : message))
    }
    const onTyping = (event: { rideId: string; userId: string; typing: boolean }) => {
      if (event.rideId !== rideId || event.userId === user?.id) return
      setPeerTyping(event.typing)
      if (peerTypingTimerRef.current !== null) window.clearTimeout(peerTypingTimerRef.current)
      if (event.typing) peerTypingTimerRef.current = window.setTimeout(() => setPeerTyping(false), 2_000)
    }
    const onEnded = (event: { rideId: string }) => {
      if (event.rideId === rideId) setCanSendFromServer(false)
    }
    const onPresence = (event: { rideId: string; userId: string; online: boolean }) => {
      if (event.rideId === rideId && event.userId !== user?.id) setOtherOnline(event.online)
    }
    const onConnect = () => {
      setSocketConnected(true)
      if (openRef.current && activeRideStatuses.includes(rideStatus)) joinConversation()
      else void loadHistory()
    }
    const onDisconnect = () => {
      setSocketConnected(false)
      setOtherOnline(false)
    }
    const onConnectError = (cause: Error) => {
      setSocketConnected(false)
      setError(`Live chat reconnecting: ${cause.message}`)
    }

    socket.on('chat:message', onMessage)
    socket.on('chat:receipt', onReceipt)
    socket.on('chat:typing', onTyping)
    socket.on('chat:ended', onEnded)
    socket.on('chat:presence', onPresence)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    void loadHistory()
    if (!socket.connected) socket.connect()
    return () => {
      socket.off('chat:message', onMessage)
      socket.off('chat:receipt', onReceipt)
      socket.off('chat:typing', onTyping)
      socket.off('chat:ended', onEnded)
      socket.off('chat:presence', onPresence)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.emit('chat:leave', { rideId })
      socketRef.current = null
      if (typingTimerRef.current !== null) window.clearTimeout(typingTimerRef.current)
      if (peerTypingTimerRef.current !== null) window.clearTimeout(peerTypingTimerRef.current)
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    }
  }, [joinConversation, loadHistory, markViewedMessagesRead, otherPartyName, rideId, rideStatus, upsertMessage, user?.id])

  useEffect(() => {
    if (!open) {
      socketRef.current?.emit('chat:leave', { rideId })
      socketRef.current?.emit('chat:typing', { rideId, typing: false })
      setPeerTyping(false)
      return
    }
    joinConversation()
    if (window.matchMedia('(min-width: 700px)').matches) inputRef.current?.focus()
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', escape)
    const visibility = () => { if (document.visibilityState === 'visible') void markViewedMessagesRead() }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('keydown', escape)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [joinConversation, markViewedMessagesRead, open, rideId])

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, open, peerTyping])

  const sendMessage = (text: string, retry?: LocalMessage) => {
    const body = text.trim()
    const socket = socketRef.current
    if (!body || !canSendRef.current) return
    const clientMessageId = retry?.clientMessageId || crypto.randomUUID()
    const optimistic: LocalMessage = retry
      ? { ...retry, deliveryState: 'sending' }
      : {
          id: `local-${clientMessageId}`,
          rideId,
          senderId: user?.id || '',
          recipientId: '',
          clientMessageId,
          body,
          createdAt: new Date().toISOString(),
          deliveredAt: null,
          readAt: null,
          deliveryState: 'sending',
        }
    upsertMessage(optimistic)
    setError('')
    if (!retry) setDraft('')
    const deliverOverHttp = () => {
      void sendRideChatMessage(rideId, clientMessageId, body)
        .then(message => {
          setError('')
          upsertMessage({ ...message, deliveryState: 'sent' })
        })
        .catch(cause => {
          setMessages(current => current.map(message => message.clientMessageId === clientMessageId
            ? { ...message, deliveryState: 'failed' }
            : message))
          setError(cause instanceof Error ? cause.message : 'Message could not be sent. Please retry.')
        })
    }
    if (!socket?.connected) {
      setError('Live chat is reconnecting. Sending this message securely over HTTPS.')
      deliverOverHttp()
      return
    }
    socket.emit('chat:typing', { rideId, typing: false })
    socket.timeout(8_000).emit('chat:send', { rideId, clientMessageId, body }, (timeoutError: Error | null, result: SendAck) => {
      if (timeoutError) {
        setError('Live chat was interrupted. Retrying this message securely over HTTPS.')
        deliverOverHttp()
        return
      }
      if (!result?.ok || !result.message) {
        setError(result?.error ? `${result.error} Retrying over HTTPS.` : 'Live chat rejected the message. Retrying over HTTPS.')
        deliverOverHttp()
        return
      }
      upsertMessage({ ...result.message, deliveryState: 'sent' })
    })
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    sendMessage(draft)
  }

  const onDraftChange = (value: string) => {
    setDraft(value)
    if (!canSendRef.current) return
    socketRef.current?.emit('chat:typing', { rideId, typing: Boolean(value.trim()) })
    if (typingTimerRef.current !== null) window.clearTimeout(typingTimerRef.current)
    if (value.trim()) typingTimerRef.current = window.setTimeout(() => {
      socketRef.current?.emit('chat:typing', { rideId, typing: false })
    }, 1_400)
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (draft.trim()) sendMessage(draft)
    }
  }

  const lastOwnMessageId = [...messages].reverse().find(message => message.senderId === user?.id)?.id

  return <>
    <div className="ride-chat-launch-wrap">
      <button className="ride-chat-launch" type="button" aria-label={`Open chat with ${otherPartyName}${unreadCount ? `, ${unreadCount} unread messages` : ''}`} aria-expanded={open} onClick={() => setOpen(true)}>
        <MessageCircle size={16} /><span>Chat</span>
        {unreadCount > 0 && <span className="ride-chat-unread" aria-label={`${unreadCount} unread`}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {notice && !open && <button className="ride-chat-toast" type="button" onClick={() => setOpen(true)}>{notice}</button>}
    </div>
    {open && createPortal(<div className="ride-chat-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false) }}>
      <section className="ride-chat-window" role="dialog" aria-modal="true" aria-label={`Chat with ${otherPartyName}`}>
        <header className="ride-chat-header">
          <div className="ride-chat-person">
            <span className="ride-chat-avatar">{initials}</span>
            <span className="ride-chat-person-copy"><b>{otherPartyName}</b><small>{otherPartyDetail} · {statusText(rideStatus)}</small></span>
          </div>
          <div className="ride-chat-header-actions"><span className={`ride-chat-state ${canSend && socketConnected && otherOnline ? 'is-active' : ''}`}><i />{canSend ? !socketConnected ? 'Reconnecting' : otherOnline ? 'Online' : 'Offline' : 'Read only'}</span><button type="button" className="ride-chat-close" aria-label="Close chat" onClick={() => setOpen(false)}><X size={18} /></button></div>
        </header>
        <div className="ride-chat-ride-note"><BadgeCheck size={14} /><span>Private conversation for this ride</span></div>
        <div className="ride-chat-messages" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Messages">
          {loading && messages.length === 0 && <div className="ride-chat-empty">Loading conversation…</div>}
          {!loading && messages.length === 0 && <div className="ride-chat-empty"><MessageCircle size={20} /><b>Start your conversation</b><span>Use chat to coordinate this ride.</span></div>}
          {messages.map(message => {
            const own = message.senderId === user?.id
            return <article key={message.id} className={`ride-chat-message ${own ? 'is-own' : 'is-other'}`}>
              <div className="ride-chat-bubble">{message.body}</div>
              <div className="ride-chat-message-meta">
                <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                {own && message.id === lastOwnMessageId && <span className="ride-chat-receipt">
                  {message.deliveryState === 'sending' ? 'Sending…' : message.deliveryState === 'failed' ? <button type="button" onClick={() => sendMessage(message.body, message)}><RotateCcw size={11} /> Retry</button> : message.readAt ? <><CheckCheck size={13} /> Read</> : message.deliveredAt ? <><CheckCheck size={13} /> Delivered</> : <><Check size={13} /> Sent</>}
                </span>}
              </div>
            </article>
          })}
          {peerTyping && <div className="ride-chat-typing"><i /><i /><i /><span>{otherPartyName.split(' ')[0]} is typing</span></div>}
          <div ref={messagesEndRef} />
        </div>
        {error && <p className="ride-chat-error" role="alert">{error}</p>}
        {canSend && <>
          <div className="ride-chat-quick-replies" aria-label="Quick replies">{quickReplies.map(reply => <button key={reply} type="button" onClick={() => sendMessage(reply)}>{reply}</button>)}</div>
          <form className="ride-chat-composer" onSubmit={submit}>
            <button type="button" className="ride-chat-attach" disabled title="Attachments are not available yet" aria-label="Attachments not available yet"><Paperclip size={17} /></button>
            <textarea ref={inputRef} rows={1} maxLength={2_000} value={draft} onChange={event => onDraftChange(event.target.value)} onKeyDown={handleInputKeyDown} placeholder="Write a message…" aria-label="Write a message" />
            <button type="submit" className="ride-chat-send" disabled={!draft.trim()} aria-label="Send message"><Send size={17} /></button>
          </form>
          <p className="ride-chat-compose-note">Enter to send · Shift + Enter for a new line</p>
        </>}
        {!canSend && <div className="ride-chat-readonly">This ride has ended. You can still read the conversation.</div>}
      </section>
    </div>, document.body)}
  </>
}
