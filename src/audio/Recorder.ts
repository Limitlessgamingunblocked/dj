/* Records the master output with MediaRecorder. */
export class MixRecorder {
  private dest: MediaStreamAudioDestinationNode;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  startedAt = 0;
  lastUrl: string | null = null;
  lastBlob: Blob | null = null;
  mime = '';

  constructor(
    private ctx: AudioContext,
    source: AudioNode,
  ) {
    this.dest = ctx.createMediaStreamDestination();
    source.connect(this.dest);
  }

  get supported(): boolean {
    return typeof MediaRecorder !== 'undefined';
  }

  get recording(): boolean {
    return !!this.rec && this.rec.state === 'recording';
  }

  get elapsed(): number {
    return this.recording ? this.ctx.currentTime - this.startedAt : 0;
  }

  start(): boolean {
    if (!this.supported || this.recording) return false;
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    this.mime = types.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
    try {
      this.rec = new MediaRecorder(this.dest.stream, this.mime ? { mimeType: this.mime, audioBitsPerSecond: 256000 } : undefined);
    } catch {
      return false;
    }
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(1000);
    this.startedAt = this.ctx.currentTime;
    return true;
  }

  stop(): Promise<{ blob: Blob; url: string; ext: string } | null> {
    return new Promise((resolve) => {
      const rec = this.rec;
      if (!rec || rec.state !== 'recording') {
        resolve(null);
        return;
      }
      rec.onstop = () => {
        const type = rec.mimeType || this.mime || 'audio/webm';
        const blob = new Blob(this.chunks, { type });
        if (this.lastUrl) URL.revokeObjectURL(this.lastUrl);
        this.lastUrl = URL.createObjectURL(blob);
        this.lastBlob = blob;
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        resolve({ blob, url: this.lastUrl, ext });
      };
      rec.stop();
    });
  }
}
