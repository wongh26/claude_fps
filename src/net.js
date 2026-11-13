// Peer-to-peer link between two browsers.
//  - Online: WebRTC data channel via PeerJS (its free public broker only does the handshake;
//    game traffic then flows directly between the two players). Works from GitHub Pages.
//  - Local test: BroadcastChannel between two tabs of the same site (add ?local to the URL).
const PREFIX = 'riftline-v2-';

export class Net {
  constructor() {
    this.handlers = {};
    this.peer = null; this.conn = null; this.bc = null;
    this.isHost = false; this.connected = false;
    this.lastMsg = 0;
    // If the opponent's browser dies, the data channel can take 30 s+ to close (or never does).
    // Snapshots arrive 20x a second, so 5 s of silence means they're gone.
    setInterval(() => {
      if (this.connected && performance.now() - this.lastMsg > 5000) this._lost('Your opponent timed out.');
    }, 1000);
  }

  on(type, fn) { this.handlers[type] = fn; }
  _emit(type, data) { this.handlers[type]?.(data); }

  _onMessage(msg) {
    this.lastMsg = performance.now();
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    this._emit('msg', msg);
  }

  _attach(conn) {
    this.conn = conn;
    conn.on('open', () => { this.connected = true; this.lastMsg = performance.now(); this._emit('connected'); });
    conn.on('data', (d) => this._onMessage(d));
    conn.on('close', () => this._lost('Your opponent left the match.'));
    conn.on('error', (e) => this._lost('Connection error: ' + (e?.type || e?.message || e)));
  }

  _lost(reason) {
    if (!this.connected) return;
    this.connected = false;
    this._emit('disconnected', reason);
  }

  _needPeerJS() {
    if (typeof window.Peer !== 'function') throw new Error('Networking library failed to load.');
  }

  /** Create a room. Resolves once the room code is registered with the broker. */
  host(code, local = false) {
    this.isHost = true;
    if (local) return this._localStart(code);
    this._needPeerJS();
    return new Promise((resolve, reject) => {
      this.peer = new window.Peer(PREFIX + code);
      this.peer.on('open', () => resolve(code));
      this.peer.on('connection', (c) => {
        if (this.conn) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); }); return; }
        this._attach(c);
      });
      let opened = false;
      this.peer.on('open', () => { opened = true; });
      this.peer.on('error', (e) => {
        if (this.connected) return; // the match runs over the data channel, not the broker
        if (!opened) reject(new Error(friendlyError(e)));
        else this._emit('lobbyError', friendlyError(e));
      });
      this.peer.on('disconnected', () => {
        if (this.connected) return;
        if (!opened) { reject(new Error('Lost contact with the matchmaking server.')); return; }
        // Still waiting in the lobby: try to get back onto the broker so the guest can find us.
        this._emit('lobbyError', 'Lost contact with the matchmaking server. Reconnecting…');
        try { this.peer.reconnect(); } catch { /* destroyed */ }
      });
    });
  }

  /** Join a room by code. Resolves when the data channel is open. */
  join(code, local = false) {
    this.isHost = false;
    if (local) return this._localStart(code);
    this._needPeerJS();
    return new Promise((resolve, reject) => {
      this.peer = new window.Peer();
      const timer = setTimeout(() => reject(new Error('Could not reach that room. Check the code and that the host is still waiting.')), 15000);
      this.peer.on('open', () => {
        const c = this.peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        this._attach(c);
        c.on('open', () => { clearTimeout(timer); resolve(); });
      });
      this.peer.on('error', (e) => { if (this.connected) return; clearTimeout(timer); reject(new Error(friendlyError(e))); });
    });
  }

  // BroadcastChannel transport for testing two tabs on one machine.
  _localStart(code) {
    this.bc = new BroadcastChannel(PREFIX + code);
    const me = this.isHost ? 'host' : 'guest';
    this.bc.onmessage = (e) => {
      const m = e.data;
      if (m.from === me) return;
      this.lastMsg = performance.now();
      if (m.t === '_hello') {
        if (!this.connected) {
          this.connected = true;
          if (this.isHost) this.bc.postMessage({ t: '_hello', from: me });
          this._localResolve?.();
          this._emit('connected');
        }
        return;
      }
      if (m.t === '_bye') { this._lost('Your opponent left the match.'); return; }
      this._onMessage(m);
    };
    window.addEventListener('beforeunload', () => this.bc?.postMessage({ t: '_bye', from: me }));
    if (!this.isHost) this.bc.postMessage({ t: '_hello', from: me });
    if (this.isHost) return Promise.resolve(code);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No local host found for that code.')), 4000);
      this._localResolve = () => { clearTimeout(timer); resolve(); };
    });
  }

  send(msg) {
    if (!this.connected) return;
    try {
      if (this.bc) this.bc.postMessage({ ...msg, from: this.isHost ? 'host' : 'guest' });
      else this.conn?.open && this.conn.send(msg);
    } catch { /* channel closing */ }
  }

  close() {
    this.connected = false;
    try { this.bc?.postMessage({ t: '_bye', from: this.isHost ? 'host' : 'guest' }); this.bc?.close(); } catch { /* ignore */ }
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.bc = this.conn = this.peer = null;
  }
}

function friendlyError(e) {
  const t = e?.type;
  if (t === 'peer-unavailable') return 'No room with that code. Check the code and that the host is still waiting.';
  if (t === 'unavailable-id') return 'That room code is taken. Try hosting again.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Could not reach the matchmaking server. Check your connection.';
  if (t === 'browser-incompatible') return 'This browser does not support WebRTC.';
  return e?.message || String(e);
}
