'use client';
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { RealtimeEvent } from '@simplyai/shared';
import { get } from './api';

let socket: Socket | null = null;
let connecting: Promise<Socket> | null = null;

async function connect(): Promise<Socket> {
  if (socket?.connected) return socket;
  if (connecting) return connecting;
  connecting = (async () => {
    const url = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4000';
    const s = io(url, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: async (cb) => {
        try {
          const { token } = await get<{ token: string }>('/auth/ws-token');
          cb({ token });
        } catch {
          cb({});
        }
      },
      reconnectionDelayMax: 10_000,
    });
    socket = s;
    return s;
  })();
  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

/** Subscribe to realtime events for a workspace, execution or conversation. */
export function useRealtime(target: { workspaceId?: string | null; executionId?: string | null; conversationId?: string | null }, onEvent: (e: RealtimeEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const { workspaceId, executionId, conversationId } = target;
  useEffect(() => {
    if (!workspaceId) return;
    let s: Socket | null = null;
    let cancelled = false;
    const sub = { workspaceId, executionId: executionId ?? undefined, conversationId: conversationId ?? undefined };
    const listener = (e: RealtimeEvent) => {
      if (executionId && 'executionId' in e && e.executionId !== executionId) return;
      if (conversationId && 'conversationId' in e && e.conversationId !== conversationId) return;
      handler.current(e);
    };
    const onConnect = () => s?.emit('subscribe', sub);
    void connect().then((sock) => {
      if (cancelled) return;
      s = sock;
      sock.on('event', listener);
      sock.on('connect', onConnect);
      if (sock.connected) onConnect();
    });
    return () => {
      cancelled = true;
      if (s) {
        s.off('event', listener);
        s.off('connect', onConnect);
        s.emit('unsubscribe', executionId ? { executionId } : conversationId ? { conversationId } : { workspaceId });
      }
    };
  }, [workspaceId, executionId, conversationId]);
}
