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
    // Heartbeat, on a timer rather than the render loop: a background tab stops rendering
    // (so it stops sending game snapshots) but must not look like a dead opponent.
    // If nothing at all arrives for 10 s, the other browser has really gone.
    setInterval(() => {
      if (!this.connected) return;
      this.send({ t: '_ping' });
      if (performance.now() - this.lastMsg > 10000) this._lost('Your opponent timed out.');
    }, 1000);
  }

  on(type, fn) { this.handlers[type] = fn; }
  _emit(type, data) { this.handlers[type]?.(data); }

  _onMessage(msg) {
    this.lastMsg = performance.now();
    if (msg?.t === '_ping') return;
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    this._emit('msg', msg);
  }

  _attach(conn) {
    this.conn = conn;
    conn.on('open', () => { this.connected = true; this.lastMsg = performance.now(); this._emit('connected'); });
    conn.on('data', (d) => this._onMessage(d));
    const gone = (reason) => {
      if (this.conn !== conn) return;          // an old attempt that was already replaced
      if (this.connected) { this._lost(reason); return; }
      this.conn = null;                        // attempt failed before it opened: free the seat
      this._joinReject?.(reason);
      this._emit('joinFailed', reason);
    };
    conn.on('close', () => gone('Your opponent left the match.'));
    conn.on('error', (e) => gone('Connection error: ' + (e?.type || e?.message || e)));
    conn.on('iceStateChanged', (state) => { if (state === 'failed') gone(NAT_MSG); });
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
        if (this.connected) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); }); return; }
        // A previous join attempt that never finished must not block the room.
        const stale = this.conn; this.conn = null;
        try { stale?.close(); } catch { /* ignore */ }
        this._attach(c);
        this._emit('joining');
        setTimeout(() => { if (this.conn === c && !this.connected) { this.conn = null; try { c.close(); } catch { /* ignore */ } this._emit('joinFailed', NAT_MSG); } }, 25000);
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
      let foundBroker = false;
      const timer = setTimeout(() => reject(new Error(foundBroker ? NAT_MSG : 'Could not reach the matchmaking server. Check your connection.')), 25000);
      this._joinReject = (reason) => { clearTimeout(timer); reject(new Error(reason)); };
      this.peer.on('open', () => {
        foundBroker = true;
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
    this._joinReject = null;
    try { this.bc?.postMessage({ t: '_bye', from: this.isHost ? 'host' : 'guest' }); this.bc?.close(); } catch { /* ignore */ }
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.bc = this.conn = this.peer = null;
  }
}

const NAT_MSG = 'Found the other player, but your two networks would not connect directly (a firewall or strict router is blocking it). Try a different network, such as a phone hotspot, or turn off any VPN.';

function friendlyError(e) {
  const t = e?.type;
  if (t === 'peer-unavailable') return 'No room with that code. Check the code and that the host is still waiting.';
  if (t === 'unavailable-id') return 'That room code is taken. Try hosting again.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Could not reach the matchmaking server. Check your connection.';
  if (t === 'browser-incompatible') return 'This browser does not support WebRTC.';
  return e?.message || String(e);
}
