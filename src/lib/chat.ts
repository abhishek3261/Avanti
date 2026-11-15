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
  const response = await fetch(path, { method, credentials: 'include' })
  const data = await response.json().catch(() => ({})) as { error?: string } & T
  if (!response.ok) throw new Error(data.error || 'Chat is temporarily unavailable.')
  return data
}

export function getRideChat(rideId: string): Promise<ChatSnapshot> {
  return chatRequest(`/api/rides/${encodeURIComponent(rideId)}/chat`)
}

export function markRideChatRead(rideId: string): Promise<{ messageIds: string[]; senderIds: string[]; readAt: string | null }> {
  return chatRequest(`/api/rides/${encodeURIComponent(rideId)}/chat/read`, 'POST')
}
