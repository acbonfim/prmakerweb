import { signal } from '@angular/core';

/** Máximo de uma mensagem de voz (0080). */
export const MAX_VOICE_SECONDS = 120;

export interface VoiceResult {
  file: File;
  transcript: string;
  seconds: number;
}

/**
 * 0080 (decisão 1): mensagem de voz — grava o áudio (MediaRecorder) e, ao mesmo tempo, transcreve no próprio navegador
 * (Web Speech API, pt-BR, contínuo), sem mandar áudio para IA nenhuma. A transcrição é o que o especialista lê; a pessoa
 * revisa antes de enviar. Navegador sem reconhecimento (Firefox): vai só o áudio.
 */
export class VoiceRecorder {
  readonly recording = signal(false);
  readonly seconds = signal(0);
  readonly transcript = signal('');
  /** Barras do "ao vivo" (0–1), as últimas 28. */
  readonly levels = signal<number[]>([]);
  readonly transcribes = transcriptionSupported();

  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private recognition: (Record<string, unknown> & { start(): void; stop(): void }) | null = null;
  private finals = '';
  private audio?: AudioContext;
  private analyser?: AnalyserNode;
  private resolveStop?: (r: VoiceResult | null) => void;
  private cancelled = false;

  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }

  async start(onProblem: (message: string) => void): Promise<boolean> {
    if (this.recording()) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onProblem('Permita o uso do microfone no navegador para gravar.');
      return false;
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
    this.recorder = type ? new MediaRecorder(this.stream, { mimeType: type }) : new MediaRecorder(this.stream);
    this.chunks = [];
    this.cancelled = false;
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.onstop = () => this.finish();
    this.recorder.start(500);
    this.seconds.set(0);
    this.transcript.set('');
    this.levels.set([]);
    this.finals = '';
    this.recording.set(true);
    this.startMeter();
    this.startRecognition();
    this.timer = setInterval(() => {
      this.seconds.update((s) => s + 1);
      if (this.seconds() >= MAX_VOICE_SECONDS) void this.stop();
    }, 1000);
    return true;
  }

  /** Para e devolve o áudio + a transcrição (null se cancelado). */
  stop(): Promise<VoiceResult | null> {
    if (!this.recorder || this.recorder.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      this.resolveStop = resolve;
      try { this.recognition?.stop(); } catch { /* já parou */ }
      this.recorder!.stop();
    });
  }

  cancel(): void {
    this.cancelled = true;
    void this.stop();
  }

  private finish(): void {
    clearInterval(this.timer);
    this.recording.set(false);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.audio?.close().catch(() => undefined);
    this.audio = undefined;
    const resolve = this.resolveStop;
    this.resolveStop = undefined;
    if (this.cancelled || !this.chunks.length) { resolve?.(null); return; }
    const type = this.recorder?.mimeType || 'audio/webm';
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    const file = new File(this.chunks, `voz-${stamp}.${ext}`, { type: type.split(';')[0] });
    resolve?.({ file, transcript: this.transcript().trim(), seconds: this.seconds() });
  }

  private startRecognition(): void {
    if (!this.transcribes) return;
    const w = window as unknown as Record<string, new () => Record<string, unknown> & { start(): void; stop(): void }>;
    const Ctor = w['SpeechRecognition'] ?? w['webkitSpeechRecognition'];
    const rec = new Ctor();
    rec['lang'] = 'pt-BR';
    rec['interimResults'] = true;
    rec['continuous'] = true;
    rec['onresult'] = (e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finals += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      this.transcript.set((this.finals + interim).replace(/\s+/g, ' ').trim());
    };
    // O Chrome encerra o reconhecimento sozinho depois de um silêncio: enquanto grava, recomeça.
    rec['onend'] = () => { if (this.recording()) { try { rec.start(); } catch { /* segue só com o áudio */ } } };
    rec['onerror'] = () => undefined;
    this.recognition = rec;
    try { rec.start(); } catch { this.recognition = null; }
  }

  private startMeter(): void {
    try {
      const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx || !this.stream) return;
      this.audio = new Ctx();
      this.analyser = this.audio.createAnalyser();
      this.analyser.fftSize = 256;
      this.audio.createMediaStreamSource(this.stream).connect(this.analyser);
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const tick = () => {
        if (!this.recording() || !this.analyser) return;
        this.analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        this.levels.update((l) => [...l.slice(-27), Math.min(1, peak / 64)]);
        setTimeout(tick, 120);
      };
      tick();
    } catch {
      // sem medidor: grava do mesmo jeito
    }
  }
}

export function transcriptionSupported(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return !!(w['SpeechRecognition'] || w['webkitSpeechRecognition']);
}
