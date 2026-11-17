import { apiUrl } from './api'

export type ChatMessage = {
  id: string
  rideId: string
  senderId: string
  recipientId: string
  clientMessageId: string
  body: string
  createdAt: string
  deliveredAt: string | null
  readAt: string | null
}

export type ChatSnapshot = {
  messages: ChatMessage[]
  unreadCount: number
  canSend: boolean
}

async function chatRequest<T>(path: string, method = 'GET'): Promise<T> {
  const response = await fetch(apiUrl(path), { method, credentials: 'include' })
  const data = await response.json().catch(() => ({})) as { error?: string } & T
  if (!response.ok) throw new Error(data.error || 'Chat is temporarily unavailable.')
  return data
}

export async function sendRideChatMessage(rideId: string, clientMessageId: string, body: string): Promise<ChatMessage> {
  const response = await fetch(apiUrl(`/api/rides/${encodeURIComponent(rideId)}/chat`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rideId, clientMessageId, body }),
  })
  const data = await response.json().catch(() => ({})) as { error?: string; message?: ChatMessage }
  if (!response.ok || !data.message) throw new Error(data.error || 'Chat is temporarily unavailable.')
  return data.message
}

export function getRideChat(rideId: string): Promise<ChatSnapshot> {
  return chatRequest(`/api/rides/${encodeURIComponent(rideId)}/chat`)
}

export function markRideChatRead(rideId: string): Promise<{ messageIds: string[]; senderIds: string[]; readAt: string | null }> {
  return chatRequest(`/api/rides/${encodeURIComponent(rideId)}/chat/read`, 'POST')
}
