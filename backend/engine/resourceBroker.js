export class ResourceBroker {
  constructor(limit = 4) { this.limit = limit; this.active = 0; this.humanActive = 0; this.queue = []; }
  acquire({ signal, priority = false } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('Slot request aborted')); return; }
      const entry = { signal, priority, resolve, reject };
      entry.abort = () => { const i = this.queue.indexOf(entry); if (i >= 0) this.queue.splice(i, 1); reject(new Error('Slot request aborted')); };
      signal?.addEventListener('abort', entry.abort, { once: true }); this.queue.push(entry); this.drain();
    });
  }
  drain() {
    for (let i = 0; i < this.queue.length;) {
      const e = this.queue[i];
      if (e.priority ? this.humanActive >= 1 : this.active >= this.limit) { i++; continue; }
      this.queue.splice(i, 1); e.signal?.removeEventListener('abort', e.abort);
      if (e.priority) this.humanActive++; else this.active++;
      let released = false;
      e.resolve(() => { if (released) return; released = true; if (e.priority) this.humanActive--; else this.active--; this.drain(); });
    }
  }
  snapshot() { return { maxWorkers: this.limit, activeWorkers: this.active, activeHumanPriority: this.humanActive, queued: this.queue.length }; }
}
