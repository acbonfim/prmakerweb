import { Component, Directive, ElementRef, EventEmitter, Input, Output, ViewChild, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * 0072: anexos do Pergunte à Base Solvace — imagem (print colado ou arrastado), PDF e arquivo de texto (log, CSV, JSON…).
 * Tudo é preparado aqui no navegador (imagem reduzida, texto cortado) e vai na pergunta em base64; nada é gravado.
 * Os limites vêm da API (`ask/status`) — estes são só o padrão enquanto ela não responde.
 */
export type AttachKind = 'image' | 'pdf' | 'text';

export interface PendingAttachment {
  id: string;
  name: string;
  mediaType: string;
  kind: AttachKind;
  /** Tamanho em bytes do que será enviado. */
  size: number;
  /** Conteúdo em base64, sem o prefixo data:. */
  data: string;
  /** URL local da miniatura (imagem). */
  preview?: string;
  /** Aviso (ex.: arquivo de texto cortado). */
  note?: string;
}

export interface AskAttachmentLimits {
  maxFiles: number;
  maxImageBytes: number;
  maxPdfBytes: number;
  maxPdfPages: number;
  maxTextBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_ATTACH_LIMITS: AskAttachmentLimits = {
  maxFiles: 4, maxImageBytes: 5 * 1024 * 1024, maxPdfBytes: 5 * 1024 * 1024, maxPdfPages: 10, maxTextBytes: 100 * 1024, maxTotalBytes: 12 * 1024 * 1024
};

/** Pergunta usada quando só há anexo (o texto é igual ao da API). */
export const DEFAULT_ATTACH_QUESTION = 'O que é isso e como resolvo?';

/** Lado maior da imagem enviada: acima disso o modelo reduz por conta própria e só pagamos mais tokens. */
export const IMAGE_MAX_SIDE = 1500;
const IMAGE_KEEP_ORIGINAL_BELOW = 1.5 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const TEXT_EXTENSIONS = ['.txt', '.log', '.csv', '.tsv', '.json', '.md', '.xml', '.yml', '.yaml', '.sql', '.sh', '.config', '.ini', '.env', '.html', '.htm', '.js', '.ts', '.cs', '.cshtml', '.asp', '.aspx'];
const TEXT_TYPES = ['application/json', 'application/xml', 'application/x-ndjson', 'application/csv', 'application/yaml', 'application/x-yaml', 'application/sql'];

/** Valor do atributo `accept` do seletor de arquivos. */
export const ATTACH_ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/*', ...TEXT_EXTENSIONS].join(',');

const fmt = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.0', '')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const extensionOf = (name: string) => { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i).toLowerCase() : ''; };
let counter = 0;

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => { const s = String(reader.result ?? ''); resolve(s.slice(s.indexOf(',') + 1)); };
    reader.readAsDataURL(blob);
  });
}

/** Reduz a imagem (lado maior ≤ 1.500 px, JPEG) — print de tela grande vira ~200 KB; as pequenas seguem como estão. */
async function shrinkImage(file: File): Promise<{ blob: Blob; mediaType: string }> {
  let bitmap: ImageBitmap | null = null;
  try { bitmap = await createImageBitmap(file); } catch { bitmap = null; }
  if (!bitmap) return { blob: file, mediaType: file.type };
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= IMAGE_MAX_SIDE && file.size <= IMAGE_KEEP_ORIGINAL_BELOW) { bitmap.close(); return { blob: file, mediaType: file.type }; }
  const scale = Math.min(1, IMAGE_MAX_SIDE / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close(); return { blob: file, mediaType: file.type }; }
  ctx.fillStyle = '#fff'; // PNG transparente vira fundo branco no JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return blob ? { blob, mediaType: 'image/jpeg' } : { blob: file, mediaType: file.type };
}

function kindOf(file: File): AttachKind | null {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return IMAGE_TYPES.includes(type) ? 'image' : null;
  if (type === 'application/pdf' || extensionOf(file.name) === '.pdf') return 'pdf';
  if (type.startsWith('text/') || TEXT_TYPES.includes(type) || TEXT_EXTENSIONS.includes(extensionOf(file.name))) return 'text';
  return null;
}

/** Nome do print colado (o navegador chama todos de "image.png"). */
function nameOf(file: File, kind: AttachKind): string {
  if (kind === 'image' && /^image\.\w+$/i.test(file.name)) {
    const now = new Date();
    const hhmmss = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join('');
    return `print-${hhmmss}.${file.type === 'image/jpeg' ? 'jpg' : (file.type.split('/')[1] || 'png')}`;
  }
  return file.name || 'anexo';
}

/** Prepara os arquivos escolhidos: confere tipo e tamanho, reduz imagem, corta texto. Devolve o que entrou e o motivo do que não entrou. */
export async function prepareAttachments(files: File[], current: PendingAttachment[], limits: AskAttachmentLimits): Promise<{ added: PendingAttachment[]; errors: string[] }> {
  const added: PendingAttachment[] = [];
  const errors: string[] = [];
  let total = current.reduce((sum, a) => sum + a.size, 0);
  for (const file of files) {
    if (current.length + added.length >= limits.maxFiles) { errors.push(`Anexe no máximo ${limits.maxFiles} arquivos por pergunta.`); break; }
    const kind = kindOf(file);
    if (!kind) { errors.push(`"${file.name}": tipo não aceito. Use imagem (PNG, JPEG, WebP, GIF), PDF ou arquivo de texto (log, CSV, JSON…).`); continue; }
    const name = nameOf(file, kind);
    try {
      let blob: Blob = file;
      let mediaType = file.type;
      let note: string | undefined;
      if (kind === 'image') {
        ({ blob, mediaType } = await shrinkImage(file));
        if (blob.size > limits.maxImageBytes) { errors.push(`"${name}": a imagem passa de ${fmt(limits.maxImageBytes)} mesmo reduzida. Recorte só a parte que importa.`); continue; }
      } else if (kind === 'pdf') {
        mediaType = 'application/pdf';
        if (file.size > limits.maxPdfBytes) { errors.push(`"${name}": o PDF passa de ${fmt(limits.maxPdfBytes)}.`); continue; }
      } else {
        mediaType = 'text/plain';
        if (file.size > limits.maxTextBytes) { blob = file.slice(0, limits.maxTextBytes); note = `só os primeiros ${fmt(limits.maxTextBytes)} serão lidos`; }
      }
      if (total + blob.size > limits.maxTotalBytes) { errors.push(`Os anexos passam de ${fmt(limits.maxTotalBytes)} no total.`); continue; }
      const data = await readBase64(blob);
      total += blob.size;
      added.push({
        id: `att-${Date.now()}-${++counter}`, name, mediaType, kind, size: blob.size, data, note,
        preview: kind === 'image' ? URL.createObjectURL(blob) : undefined
      });
    } catch {
      errors.push(`"${name}": não consegui ler o arquivo.`);
    }
  }
  return { added, errors };
}

export function releaseAttachment(a: PendingAttachment): void {
  if (a.preview) URL.revokeObjectURL(a.preview);
}

/** Corpo do anexo para a API. */
export const toRequest = (a: PendingAttachment) => ({ name: a.name, mediaType: a.mediaType, data: a.data });

// ── Ditado por voz (Web Speech API): preenche o campo, sem enviar áudio ao nosso servidor ───────────────────────

export const dictationSupported = (): boolean => {
  const w = window as unknown as Record<string, unknown>;
  return !!(w['SpeechRecognition'] || w['webkitSpeechRecognition']);
};

/** Ditado pt-BR: chama `onText` com o texto reconhecido até agora (inclui o parcial). */
export class Dictation {
  readonly listening = signal(false);
  private recognition: { start(): void; stop(): void } | null = null;

  start(onText: (text: string) => void, onProblem: (message: string) => void): void {
    const w = window as unknown as Record<string, new () => Record<string, unknown> & { start(): void; stop(): void }>;
    const Ctor = w['SpeechRecognition'] ?? w['webkitSpeechRecognition'];
    if (!Ctor) { onProblem('Este navegador não tem ditado por voz. Use o Chrome ou o Edge.'); return; }
    const rec = new Ctor();
    rec['lang'] = 'pt-BR';
    rec['interimResults'] = true;
    rec['continuous'] = false;
    rec['onresult'] = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onText(text.trim());
    };
    rec['onend'] = () => { this.listening.set(false); this.recognition = null; };
    rec['onerror'] = (e: { error: string }) => {
      this.listening.set(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') onProblem('Permita o uso do microfone no navegador para ditar.');
      else if (e.error === 'no-speech') onProblem('Não ouvi nada. Tente de novo, falando mais perto do microfone.');
      else if (e.error !== 'aborted') onProblem('Não consegui ouvir agora. Tente de novo.');
    };
    this.recognition = rec;
    this.listening.set(true);
    try { rec.start(); } catch { this.listening.set(false); }
  }

  stop(): void { this.recognition?.stop(); }
}

// ── Arrastar, soltar e colar ─────────────────────────────────────────────────────────────────────────────────────

/** No formulário da pergunta: arquivo arrastado ou imagem colada da área de transferência vira anexo; texto colado segue normal. */
@Directive({
  selector: '[kbAttachDrop]',
  standalone: true,
  host: {
    '(paste)': 'onPaste($event)',
    '(dragover)': 'onOver($event)',
    '(dragleave)': 'onLeave($event)',
    '(drop)': 'onDrop($event)',
    '[class.kb-drop--over]': 'over()'
  }
})
export class KbAttachDropDirective {
  @Output() filesDropped = new EventEmitter<File[]>();
  readonly over = signal(false);

  onPaste(e: ClipboardEvent): void {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!files.length) return; // só texto: o campo trata
    e.preventDefault();
    this.filesDropped.emit(files);
  }

  onOver(e: DragEvent): void {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    this.over.set(true);
  }

  onLeave(e: DragEvent): void {
    const host = e.currentTarget as HTMLElement | null;
    if (host && e.relatedTarget instanceof Node && host.contains(e.relatedTarget)) return;
    this.over.set(false);
  }

  onDrop(e: DragEvent): void {
    const files = Array.from(e.dataTransfer?.files ?? []);
    this.over.set(false);
    if (!files.length) return;
    e.preventDefault();
    this.filesDropped.emit(files);
  }
}

// ── Botões (clipe e microfone) ───────────────────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-kb-attach-tools',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    @if (attachments) {
      <input #picker type="file" multiple hidden [accept]="accept" (change)="picked($event)" />
      <button type="button" mat-icon-button class="att__btn" (click)="picker.click()" matTooltip="Anexar imagem, PDF ou arquivo de texto (ou cole um print / arraste para cá)" aria-label="Anexar arquivo">
        <mat-icon>attach_file</mat-icon>
      </button>
    }
    @if (dictation) {
      <button type="button" mat-icon-button class="att__btn" [class.att__btn--live]="listening" (click)="mic.emit()"
              [matTooltip]="listening ? 'Parar de ouvir' : 'Falar a pergunta (o texto aparece no campo)'" [attr.aria-label]="listening ? 'Parar ditado' : 'Ditar a pergunta'">
        <mat-icon>{{ listening ? 'mic' : 'mic_none' }}</mat-icon>
      </button>
    }
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; }
    .att__btn { width: 34px; height: 34px; padding: 0; opacity: .75; }
    .att__btn:hover { opacity: 1; }
    .att__btn mat-icon { font-size: 20px; width: 20px; height: 20px; margin: 0 !important; }
    .att__btn--live { color: #ef5350; opacity: 1; animation: att-pulse 1.1s infinite ease-in-out; }
    @keyframes att-pulse { 50% { transform: scale(1.15); } }
  `]
})
export class KbAttachToolsComponent {
  /** O provedor de IA lê anexos (status da API). */
  @Input() attachments = false;
  /** O navegador tem ditado por voz. */
  @Input() dictation = false;
  @Input() listening = false;
  @Output() pick = new EventEmitter<File[]>();
  @Output() mic = new EventEmitter<void>();
  readonly accept = ATTACH_ACCEPT;
  @ViewChild('picker') private picker?: ElementRef<HTMLInputElement>;

  picked(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // permite escolher o mesmo arquivo de novo
    if (files.length) this.pick.emit(files);
  }
}

// ── Miniaturas e avisos ──────────────────────────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-kb-attach-chips',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    @if (files.length) {
      <div class="chips">
        @for (f of files; track f.id) {
          <span class="chip" [class.chip--warn]="!!f.note" [matTooltip]="f.note ? f.name + ' — ' + f.note : f.name">
            @if (f.preview) { <img [src]="f.preview" alt="" /> }
            @else { <mat-icon>{{ f.kind === 'pdf' ? 'picture_as_pdf' : 'description' }}</mat-icon> }
            <span class="chip__name">{{ f.name }}</span>
            <span class="chip__size">{{ size(f.size) }}</span>
            <button type="button" class="chip__x" (click)="remove.emit(f.id)" [attr.aria-label]="'Remover ' + f.name"><mat-icon>close</mat-icon></button>
          </span>
        }
      </div>
    }
    @for (m of messages; track $index) { <div class="chips__msg"><mat-icon>info</mat-icon>{{ m }}</div> }
  `,
  styles: [`
    :host { display: block; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .chip { display: inline-flex; align-items: center; gap: 6px; max-width: 260px; padding: 3px 4px 3px 6px; border-radius: 10px; font-size: 12px;
      background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); }
    .chip--warn { border-color: #ffb74d; }
    .chip img { width: 28px; height: 28px; object-fit: cover; border-radius: 6px; }
    .chip mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .chip__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip__size { opacity: .6; font-size: 11px; }
    .chip__x { display: inline-flex; border: none; background: none; color: inherit; cursor: pointer; padding: 2px; border-radius: 50%; opacity: .7; }
    .chip__x:hover { opacity: 1; background: rgba(255,255,255,.12); }
    .chip__x mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .chips__msg { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; color: #ffb74d; }
    .chips__msg mat-icon { font-size: 15px; width: 15px; height: 15px; }
  `]
})
export class KbAttachChipsComponent {
  @Input() files: PendingAttachment[] = [];
  /** Motivos de recusa e avisos para mostrar embaixo. */
  @Input() messages: string[] = [];
  @Output() remove = new EventEmitter<string>();
  size = fmt;
}
