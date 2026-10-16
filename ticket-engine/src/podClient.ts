// podClient.ts
//
// Client for the omni-RTC pod's WSS protocol — presence roster, signaling
// relay, and queue drain. Shared by the frontend (`src/core/rtc/podClient.ts`)
// and the RN app (`src/shared/rtcPodClient.ts`); the wire format matches the
// pod (SERVERLESS-ARCHATECTURE.md). Storage of the pod URL stays client-side
// (localStorage on web, key_value on RN) — only the protocol lives here.

/** Production pod — the default when no override has been saved. */
export const DEFAULT_POD_URL = 'wss://directeatz.com/rtc';

/** key/localStorage row holding a per-device pod URL override. */
export const POD_URL_STORAGE_KEY = 'rtc_pod_url';

export interface PodRosterState {
  status: 'idle' | 'connecting' | 'joined' | 'error';
  deviceIds: string[];
  errorMessage: string | null;
}

export const initialRosterState: PodRosterState = {
  status: 'idle',
  deviceIds: [],
  errorMessage: null,
};

// Queue envelopes as delivered by the pod: {id, fromDeviceId, payload}.
export interface PodEnvelope {
  id?: string;
  fromDeviceId?: string;
  payload?: unknown;
}

export interface PodMessage {
  type: string;
  event?: string;
  devices?: { deviceId: string }[];
  deviceId?: string;
  fromDeviceId?: string;
  payload?: unknown;
  envelopes?: PodEnvelope[];
  message?: string;
}

// Extra frame handlers the RTC sync managers need (signals + queue drain +
// live-event notifications); the settings screens only care about roster state.
export interface PodClientHandlers {
  onSignal?: (fromDeviceId: string, payload: unknown) => void;
  onQueued?: (envelopes: PodEnvelope[]) => void;
  onEvent?: (event: string, payload: unknown) => void;
}

// Pure reducer over the pod's WSS frames — keeps roster logic testable
// without a live socket.
export function applyPodMessage(
  state: PodRosterState,
  msg: PodMessage,
): PodRosterState {
  switch (msg.type) {
    case 'roomJoined':
      return {
        status: 'joined',
        deviceIds: (msg.devices ?? []).map((d) => d.deviceId),
        errorMessage: null,
      };
    case 'deviceJoined':
      if (!msg.deviceId || state.deviceIds.includes(msg.deviceId)) return state;
      return { ...state, deviceIds: [...state.deviceIds, msg.deviceId] };
    case 'deviceLeft':
      return {
        ...state,
        deviceIds: state.deviceIds.filter((id) => id !== msg.deviceId),
      };
    case 'error':
      return { ...state, errorMessage: msg.message ?? 'error' };
    default:
      return state;
  }
}

// Accepts a pasteable https(s) URL or a ws(s) URL; appends /ws when missing
// (the pod serves its WSS endpoint at /ws; ingress strips the /rtc prefix).
export function normalizePodWsUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let ws = trimmed
    .replace(/^https:\/\//i, 'wss://')
    .replace(/^http:\/\//i, 'ws://');
  if (!ws.endsWith('/ws')) ws += '/ws';
  return ws;
}

// HTTP endpoint for POST /queue derived from the pod's WSS URL
// (ingress strips the /rtc prefix, so https://host/rtc/ws → .../rtc/queue).
export function podQueueUrl(raw: string): string {
  const ws = normalizePodWsUrl(raw);
  if (!ws) return '';
  return ws.replace(/^ws/i, 'http').replace(/\/ws$/, '/queue');
}

// STUN server URL derived from the pod's WSS URL — the pod serves STUN on
// UDP 3478 of the same host (e.g. wss://directeatz.com/rtc → stun:directeatz.com:3478).
export function podStunUrl(raw: string): string {
  const ws = normalizePodWsUrl(raw);
  if (!ws) return '';
  try {
    const host = new URL(ws).hostname;
    return host ? `stun:${host}:3478` : '';
  } catch {
    return '';
  }
}

// Reconnect backoff: 1s, 2s, 4s … capped at 30s, ±20% jitter.
export function reconnectDelayMs(attempt: number): number {
  const base = Math.min(30000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

const PING_INTERVAL_MS = 25000;

export class RtcPodClient {
  private ws: WebSocket | null = null;
  private state: PodRosterState = initialRosterState;
  private identity: {
    url: string;
    lg: string;
    deviceId: string;
    token: string;
  } | null = null;
  private manualClose = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly onUpdate: (state: PodRosterState) => void,
    private readonly handlers: PodClientHandlers = {},
  ) {}

  private setState(next: PodRosterState): void {
    this.state = next;
    try {
      this.onUpdate(next);
    } catch (e) {
      // Roster listeners run from ws events — never let them kill the app.
      console.warn('[rtc] roster update listener failed:', e);
    }
  }

  getState(): PodRosterState {
    return this.state;
  }

  // Returns false when inputs are unusable; otherwise starts connecting.
  // `token` is the omni-minted pod JWT (empty string joins anonymously while
  // the pod still allows it).
  connect(
    rawUrl: string,
    lgUuid: string,
    deviceId: string,
    token: string = '',
  ): boolean {
    const url = normalizePodWsUrl(rawUrl);
    if (!url || !lgUuid || !deviceId) return false;
    this.closeSocket();
    this.manualClose = false;
    this.attempt = 0;
    this.clearReconnect();
    this.identity = { url, lg: lgUuid, deviceId, token };
    this.setState({ status: 'connecting', deviceIds: [], errorMessage: null });
    this.open();
    return true;
  }

  // Relay an opaque signaling payload (SDP/ICE) to one room member.
  sendSignal(targetDeviceId: string, payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (!targetDeviceId || payload == null) return false;
    try {
      this.ws.send(JSON.stringify({ type: 'signal', targetDeviceId, payload }));
    } catch (e) {
      console.warn('[rtc] signal send failed:', e);
      return false;
    }
    return true;
  }

  disconnect(): void {
    this.manualClose = true;
    this.identity = null;
    this.clearReconnect();
    this.closeSocket();
    this.setState(initialRosterState);
  }

  private open(): void {
    const id = this.identity;
    if (!id) return;
    try {
      const ws = new WebSocket(id.url);
      this.ws = ws;

      ws.onopen = () => {
        try {
          if (this.ws !== ws) return;
          this.attempt = 0;
          ws.send(
            JSON.stringify({
              type: 'join',
              locationGroupUuid: id.lg,
              deviceId: id.deviceId,
              token: id.token,
            }),
          );
          this.startPing(ws);
        } catch (e) {
          console.warn('[rtc] pod onopen failed:', e);
        }
      };
      ws.onmessage = (event) => {
        try {
          if (this.ws !== ws) return;
          let msg: PodMessage;
          try {
            msg = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (
            msg.type === 'signal' &&
            msg.fromDeviceId &&
            this.handlers.onSignal
          ) {
            this.handlers.onSignal(msg.fromDeviceId, msg.payload);
          }
          if (msg.type === 'queued' && this.handlers.onQueued) {
            this.handlers.onQueued(msg.envelopes ?? []);
          }
          if (msg.type === 'event' && msg.event && this.handlers.onEvent) {
            this.handlers.onEvent(msg.event, msg.payload);
          }
          this.setState(applyPodMessage(this.state, msg));
        } catch (e) {
          console.warn('[rtc] pod onmessage failed:', e);
        }
      };
      ws.onerror = () => {
        // Reconnect scheduling in onclose handles the retry path.
      };
      ws.onclose = () => {
        try {
          if (this.ws !== ws) return;
          this.ws = null;
          this.stopPing();
          if (this.manualClose || !this.identity) {
            this.setState(initialRosterState);
            return;
          }
          // Unexpected close: show reconnecting and schedule a retry with backoff.
          this.setState({
            status: 'connecting',
            deviceIds: [],
            errorMessage:
              this.attempt > 0
                ? `reconnecting (attempt ${this.attempt + 1})`
                : null,
          });
          this.scheduleReconnect();
        } catch (e) {
          console.warn('[rtc] pod onclose failed:', e);
        }
      };
    } catch (e) {
      // Bad ws URL, native socket failure — schedule a retry instead of dying.
      console.warn('[rtc] pod socket open failed:', e);
      this.ws = null;
      if (!this.manualClose && this.identity) this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.identity) return;
    const delay = reconnectDelayMs(this.attempt);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      try {
        if (this.manualClose || !this.identity) return;
        this.setState({ status: 'connecting', deviceIds: [], errorMessage: null });
        this.open();
      } catch (e) {
        console.warn('[rtc] reconnect failed:', e);
      }
    }, delay);
  }

  private startPing(ws: WebSocket): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      try {
        if (this.ws === ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      } catch (e) {
        console.warn('[rtc] ping failed:', e);
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null;
    this.stopPing();
    if (ws) {
      try {
        ws.close();
      } catch (e) {
        console.warn('[rtc] socket close failed:', e);
      }
    }
  }
}
