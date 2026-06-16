import type { WsMessage, WsStatus } from '../types';

type MessageHandler = (message: WsMessage) => void;
type StatusHandler = (status: WsStatus) => void;

class WsService {
  private ws: WebSocket | null = null;
  private status: WsStatus = 'disconnected';
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private url = '';
  private token = '';

  connect(token: string, url: string = '/ws/quotes') {
    this.token = token;

    if (this.ws && (this.status === 'connected' || this.status === 'connecting')) {
      return;
    }

    this.url = url;
    this.setStatus('connecting');

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = url.startsWith('ws')
        ? `${url}?token=${encodeURIComponent(token)}`
        : `${protocol}//${window.location.host}${url}?token=${encodeURIComponent(token)}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WsMessage = JSON.parse(event.data);
          if (message.type === 'ping') {
            this.send({ type: 'pong' });
            return;
          }
          this.messageHandlers.forEach((handler) => {
            try {
              handler(message);
            } catch (e) {
              console.error('WS handler error:', e);
            }
          });
        } catch (e) {
          console.error('WS message parse error:', e);
        }
      };

      this.ws.onerror = () => {
        console.error('WebSocket error');
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.setStatus('disconnected');
        this.tryReconnect();
      };
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      this.setStatus('disconnected');
      this.tryReconnect();
    }
  }

  disconnect() {
    this.stopReconnect();
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  send(message: Partial<WsMessage> & { type: string }) {
    if (this.ws && this.status === 'connected') {
      this.ws.send(JSON.stringify(message));
    }
  }

  subscribe(symbols: string[]) {
    this.send({ type: 'subscribe', symbols } as any);
  }

  unsubscribe(symbols: string[]) {
    this.send({ type: 'unsubscribe', symbols } as any);
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => this.statusHandlers.delete(handler);
  }

  getStatus(): WsStatus {
    return this.status;
  }

  private setStatus(status: WsStatus) {
    this.status = status;
    this.statusHandlers.forEach((handler) => {
      try {
        handler(status);
      } catch (e) {
        console.error('WS status handler error:', e);
      }
    });
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.status === 'connected') {
        this.send({ type: 'ping' });
      }
    }, 25000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.stopReconnect();
    this.setStatus('reconnecting');

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      console.log(`Reconnecting... attempt ${this.reconnectAttempts}`);
      if (this.token) {
        this.connect(this.token, this.url);
      }
    }, delay);
  }

  private stopReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const wsService = new WsService();
export default wsService;
