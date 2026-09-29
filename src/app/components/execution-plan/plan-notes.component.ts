import {
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CliipboardService } from '../../services/cliipboard.service';
import { ExecutionPlanService, planApiError } from '../../services/execution-plan.service';
import { PlanMarkdownPipe } from './plan-markdown.pipe';
import { ExecutionArtifact, ExecutionNote, PlanPhase } from './execution-plan.model';

/** Mesmos limites da API (10 MB por arquivo, 20 por comentário). */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 20;
/** Comentários visíveis antes do "ver todos". */
const COLLAPSED_COUNT = 4;

interface PendingFile {
  id: number;
  file: File;
  preview: string | null;
}

/**
 * Comentários e anexos do usuário no plano de execução (0031). Texto + imagens/arquivos — arrastando para o
 * painel, colando (Ctrl+V) ou pelo ícone de anexo. Tudo é numerado por card ("comentário #n", "anexo #n") e a
 * skill lê como entrada da análise; o usuário cita esses números no Claude ou aqui.
 */
@Component({
  selector: 'app-plan-notes',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe],
  template: `
    <section class="notes" aria-label="Comentários e anexos">
      <div class="notes__title">
        <mat-icon>forum</mat-icon>
        Comentários e anexos
        @if (notes().length) { <span class="notes__count">{{ notes().length }}</span> }
        <span class="notes__hint">o Claude considera tudo na análise — cite "anexo #n" ou "comentário #n"</span>
      </div>

      @if (hiddenCount() > 0) {
        <button mat-button class="notes__more" (click)="showAll.set(true)">
          <mat-icon>expand_less</mat-icon>Ver os {{ hiddenCount() }} comentários anteriores
        </button>
      }

      @for (note of visibleNotes(); track note.id) {
        <article class="note" [class.note--claude]="note.fromExecutor" [attr.data-note]="note.number">
          <span class="note__avatar" aria-hidden="true"><mat-icon>{{ note.fromExecutor ? 'smart_toy' : 'person' }}</mat-icon></span>
          <div class="note__main">
            <div class="note__head">
              <strong>{{ note.fromExecutor ? 'Claude' : note.authorName }}</strong>
              <button type="button" class="note__num" (click)="copyRef('comentário #' + note.number)"
                      matTooltip="Copiar a referência (cite no Claude: comentário #{{ note.number }})">#{{ note.number }}</button>
              <span class="note__time" [matTooltip]="formatDateTime(note.createdAt)">{{ relative(note.createdAt) }}</span>
              @if (note.updatedAt) { <span class="note__tag">editado</span> }
              @if (note.planId !== planId()) {
                <span class="note__tag">{{ phaseLabel(note.planPhase) }}</span>
              }
              @if (note.stepKey) {
                <span class="note__tag note__tag--step" [matTooltip]="'Etapa: ' + stepTitle(note.stepKey)">
                  <mat-icon>subdirectory_arrow_right</mat-icon>{{ stepTitle(note.stepKey) }}
                </span>
              }
              <span class="note__spacer"></span>
              @if (canChange(note) && editingId() !== note.id && confirmDeleteId() !== note.id) {
                <button mat-icon-button class="note__action" (click)="startEdit(note)" matTooltip="Editar" aria-label="Editar">
                  <mat-icon>edit</mat-icon>
                </button>
                <button mat-icon-button class="note__action" (click)="confirmDeleteId.set(note.id)" matTooltip="Remover" aria-label="Remover">
                  <mat-icon>delete_outline</mat-icon>
                </button>
              }
            </div>

            @if (confirmDeleteId() === note.id) {
              <div class="note__confirm">
                Remover o comentário #{{ note.number }}{{ note.attachments.length ? ' e os anexos' : '' }}?
                <button mat-button (click)="confirmDeleteId.set(null)">Não</button>
                <button mat-flat-button color="warn" (click)="remove(note)" [disabled]="busy()">Remover</button>
              </div>
            }

            @if (editingId() === note.id) {
              <textarea class="notes__input notes__input--edit" [(ngModel)]="editText" rows="3"
                        (keydown)="onEditKey($event, note)"></textarea>
              <div class="note__edit-actions">
                <button mat-button (click)="editingId.set(null)">Cancelar</button>
                <button mat-flat-button color="primary" (click)="saveEdit(note)" [disabled]="busy()">Salvar</button>
              </div>
            } @else if (note.text) {
              <div class="note__text plan-md" [innerHTML]="note.text | planMarkdown"></div>
            }

            @if (note.attachments.length) {
              <div class="note__files">
                @for (a of note.attachments; track a.id) {
                  @if (a.kind === 'image') {
                    <button type="button" class="note__thumb" (click)="open(a)"
                            [matTooltip]="'anexo #' + a.number + ' — ' + a.name + ' (' + size(a.size) + ')'">
                      @if (thumbs()[a.id]; as src) { <img [src]="src" [alt]="a.name" /> }
                      @else { <mat-icon>image</mat-icon> }
                      <span class="note__badge">#{{ a.number }}</span>
                    </button>
                  } @else {
                    <button type="button" class="note__file" (click)="open(a)"
                            [matTooltip]="'anexo #' + a.number + ' — ' + size(a.size)">
                      <mat-icon>{{ fileIcon(a) }}</mat-icon>
                      <span class="note__file-num">#{{ a.number }}</span>
                      <span class="note__file-name">{{ a.name }}</span>
                    </button>
                  }
                }
              </div>
            }
          </div>
        </article>
      }

      <div class="composer" [class.composer--drop]="dropping()"
           (dragover)="onDragOver($event)" (dragleave)="dropping.set(false)" (drop)="onDrop($event)">
        <textarea #input class="notes__input" [(ngModel)]="text" rows="2"
                  placeholder="Comente, cole uma imagem (Ctrl+V) ou arraste arquivos para cá…"
                  (paste)="onPaste($event)" (keydown)="onKey($event)"></textarea>

        @if (pending().length) {
          <div class="composer__pending">
            @for (p of pending(); track p.id) {
              <span class="composer__file" [matTooltip]="p.file.name + ' (' + size(p.file.size) + ')'">
                @if (p.preview) { <img [src]="p.preview" alt="" /> } @else { <mat-icon>{{ pendingIcon(p.file) }}</mat-icon> }
                <span class="composer__file-name">{{ p.file.name }}</span>
                <button type="button" class="composer__remove" (click)="removePending(p)" aria-label="Remover anexo">
                  <mat-icon>close</mat-icon>
                </button>
              </span>
            }
          </div>
        }

        <div class="composer__bar">
          <input #picker type="file" multiple hidden (change)="onPick($event)" />
          <button mat-icon-button (click)="picker.click()" matTooltip="Anexar imagens ou arquivos" aria-label="Anexar">
            <mat-icon>attach_file</mat-icon>
          </button>
          @if (steps().length) {
            <select class="composer__step" [ngModel]="stepKeyChoice()" (ngModelChange)="stepOverride.set($event)"
                    matTooltip="Etapa do plano a que o comentário se refere">
              <option [ngValue]="null">Plano (geral)</option>
              @for (s of steps(); track s.key) { <option [ngValue]="s.key">{{ s.title }}</option> }
            </select>
          }
          <span class="composer__spacer"></span>
          <span class="composer__keys">Ctrl+Enter envia</span>
          <button mat-flat-button color="primary" (click)="send()" [disabled]="!canSend()">
            <mat-icon>{{ busy() ? 'progress_activity' : 'send' }}</mat-icon>Comentar
          </button>
        </div>
        @if (dropping()) {
          <div class="composer__overlay"><mat-icon>upload_file</mat-icon>Solte para anexar ao comentário</div>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .notes { margin: 14px 0 6px; padding-top: 12px; border-top: 1px solid var(--plan-line, rgba(255,255,255,.1)); }
    .notes__title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; letter-spacing: .02em;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 80%, transparent); margin-bottom: 8px; flex-wrap: wrap; }
    .notes__title .mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); }
    .notes__count { font-size: 11px; padding: 0 6px; border-radius: 9px; background: color-mix(in srgb, var(--mat-sys-primary) 22%, transparent); }
    .notes__hint { font-weight: 400; font-size: 11px; color: var(--plan-muted, #888); }
    .notes__more { font-size: 12px; margin-bottom: 4px; }

    .note { display: flex; gap: 8px; padding: 8px 6px; border-radius: 8px; animation: note-in .25s ease-out; }
    .note:hover { background: rgba(255,255,255,.025); }
    .note__avatar { flex: none; width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--mat-sys-on-surface) 12%, transparent); }
    .note__avatar .mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .note--claude .note__avatar { background: color-mix(in srgb, var(--mat-sys-primary) 25%, transparent); color: var(--mat-sys-primary); }
    .note__main { flex: 1; min-width: 0; }
    .note__head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; min-height: 26px; }
    .note__num { border: none; cursor: pointer; font: inherit; font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 9px;
      color: var(--mat-sys-primary); background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent); }
    .note__time { color: var(--plan-muted, #888); font-size: 11px; }
    .note__tag { display: inline-flex; align-items: center; gap: 2px; font-size: 10.5px; padding: 0 6px; border-radius: 9px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 70%, transparent); background: rgba(255,255,255,.06); max-width: 220px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .note__tag .mat-icon { font-size: 12px; width: 12px; height: 12px; }
    .note__spacer { flex: 1; }
    .note__action.mat-mdc-icon-button { width: 26px; height: 26px; padding: 3px; opacity: .6; }
    .note__action.mat-mdc-icon-button:hover { opacity: 1; }
    .note__action .mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .note__text { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    .note__text :first-child { margin-top: 2px; }
    .note__text :last-child { margin-bottom: 0; }
    .note__confirm { display: flex; align-items: center; gap: 6px; font-size: 12px; margin: 4px 0; flex-wrap: wrap; }
    .note__edit-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px; }

    .note__files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .note__thumb { position: relative; width: 96px; height: 72px; padding: 0; border-radius: 6px; overflow: hidden; cursor: zoom-in;
      border: 1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.25); display: inline-flex; align-items: center; justify-content: center;
      color: var(--plan-muted, #888); transition: transform .15s, border-color .15s; }
    .note__thumb:hover { transform: translateY(-1px); border-color: var(--mat-sys-primary); }
    .note__thumb img { width: 100%; height: 100%; object-fit: cover; }
    .note__badge { position: absolute; left: 4px; bottom: 4px; font-size: 10px; font-weight: 700; padding: 0 5px; border-radius: 8px;
      background: rgba(0,0,0,.7); color: #fff; }
    .note__file { display: inline-flex; align-items: center; gap: 4px; max-width: 260px; height: 28px; padding: 0 10px 0 6px; cursor: pointer;
      border-radius: 14px; border: 1px solid rgba(255,255,255,.14); background: transparent; color: inherit; font: inherit; font-size: 12px; }
    .note__file:hover { border-color: var(--mat-sys-primary); }
    .note__file .mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); }
    .note__file-num { font-weight: 700; font-size: 11px; }
    .note__file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .composer { position: relative; margin-top: 8px; padding: 8px; border-radius: 10px; border: 1px solid rgba(255,255,255,.1);
      background: rgba(0,0,0,.18); transition: border-color .15s, background .15s; }
    .composer:focus-within { border-color: color-mix(in srgb, var(--mat-sys-primary) 60%, transparent); }
    .composer--drop { border-color: var(--mat-sys-primary); border-style: dashed; background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent); }
    .notes__input { width: 100%; box-sizing: border-box; resize: vertical; min-height: 40px; max-height: 260px; border: none; outline: none;
      background: transparent; color: inherit; font: inherit; font-size: 13px; line-height: 1.45; }
    .notes__input--edit { border: 1px solid rgba(255,255,255,.14); border-radius: 6px; padding: 6px 8px; margin-top: 4px; }
    .composer__pending { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0; }
    .composer__file { display: inline-flex; align-items: center; gap: 6px; max-width: 220px; height: 34px; padding: 0 2px 0 3px; border-radius: 8px;
      background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); font-size: 12px; animation: note-in .2s ease-out; }
    .composer__file img { width: 28px; height: 28px; object-fit: cover; border-radius: 5px; }
    .composer__file .mat-icon { font-size: 18px; width: 18px; height: 18px; margin-left: 4px; color: var(--mat-sys-primary); }
    .composer__file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .composer__remove { border: none; background: transparent; color: inherit; cursor: pointer; display: inline-flex; padding: 2px; border-radius: 50%; opacity: .7; }
    .composer__remove:hover { opacity: 1; background: rgba(255,255,255,.08); }
    .composer__remove .mat-icon { font-size: 15px; width: 15px; height: 15px; margin: 0; color: inherit; }
    .composer__bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .composer__step { max-width: 220px; height: 28px; border-radius: 6px; border: 1px solid rgba(255,255,255,.14); background: var(--surface-2, #323232);
      color: inherit; font: inherit; font-size: 12px; padding: 0 6px; }
    .composer__spacer { flex: 1; }
    .composer__keys { font-size: 11px; color: var(--plan-muted, #888); }
    .composer__overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; border-radius: 10px;
      pointer-events: none; font-size: 13px; font-weight: 600; color: var(--mat-sys-primary);
      background: color-mix(in srgb, var(--surface-1, #2a2a2a) 80%, transparent); }
    @keyframes note-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  `]
})
export class PlanNotesComponent implements OnDestroy {
  private api = inject(ExecutionPlanService);
  private snackBar = inject(MatSnackBar);
  private clipboard = inject(CliipboardService);

  /** Plano em tela (onde os comentários novos são gravados). */
  readonly planId = input.required<string>();
  readonly planPhase = input<PlanPhase>('analysis');
  readonly notes = input<ExecutionNote[]>([]);
  readonly steps = input<{ key: string; title: string }[]>([]);
  /** Etapa aberta no plano — padrão do seletor de etapa do comentário. */
  readonly selectedStepKey = input<string | null>(null);
  readonly currentUserId = input<string | null>(null);

  /** Algo mudou (comentário criado/editado/removido) — o plano recarrega. */
  readonly changed = output<void>();
  /** Abrir um arquivo do plano em tela no visualizador de arquivos. */
  readonly openArtifact = output<ExecutionArtifact>();

  @ViewChild('input') private inputRef?: ElementRef<HTMLTextAreaElement>;

  text = '';
  editText = '';
  readonly pending = signal<PendingFile[]>([]);
  readonly busy = signal(false);
  readonly dropping = signal(false);
  readonly showAll = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly confirmDeleteId = signal<string | null>(null);
  /** undefined = segue a etapa aberta no plano; null = plano (geral). */
  readonly stepOverride = signal<string | null | undefined>(undefined);
  readonly stepKeyChoice = computed(() => {
    const chosen = this.stepOverride();
    return chosen === undefined ? this.selectedStepKey() : chosen;
  });
  readonly thumbs = signal<Record<string, string>>({});

  readonly visibleNotes = computed(() => {
    const all = this.notes();
    return this.showAll() || all.length <= COLLAPSED_COUNT ? all : all.slice(-COLLAPSED_COUNT);
  });
  readonly hiddenCount = computed(() => this.notes().length - this.visibleNotes().length);

  private seq = 0;
  private loadingThumbs = new Set<string>();

  constructor() {
    effect(() => {
      for (const note of this.notes())
        for (const a of note.attachments)
          if (a.kind === 'image') this.loadThumb(a);
    });
  }

  // ── Compositor ─────────────────────────────────────────────────────────────────────────────────

  canSend(): boolean {
    return !this.busy() && (this.text.trim().length > 0 || this.pending().length > 0);
  }

  /** Arquivos vindos do arrastar-e-soltar (no painel inteiro), do seletor ou da área de transferência. */
  addFiles(files: File[] | FileList | null | undefined, fromClipboard = false): void {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    const accepted: PendingFile[] = [];
    for (const original of list) {
      if (original.size > MAX_FILE_BYTES) {
        this.snackBar.open(`"${original.name}" passa de 10 MB — não anexado.`, 'Fechar', { duration: 6000 });
        continue;
      }
      const file = fromClipboard || !original.name || /^image\.(png|jpe?g|gif|webp)$/i.test(original.name)
        ? this.renameClipboardFile(original)
        : original;
      accepted.push({ id: ++this.seq, file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
    }
    const merged = [...this.pending(), ...accepted];
    if (merged.length > MAX_FILES) {
      this.snackBar.open(`No máximo ${MAX_FILES} anexos por comentário.`, 'Fechar', { duration: 5000 });
      merged.splice(MAX_FILES).forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    }
    this.pending.set(merged);
    this.focus();
  }

  focus(): void {
    setTimeout(() => {
      const el = this.inputRef?.nativeElement;
      el?.focus();
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  removePending(p: PendingFile): void {
    if (p.preview) URL.revokeObjectURL(p.preview);
    this.pending.update((list) => list.filter((x) => x.id !== p.id));
  }

  onPaste(event: ClipboardEvent): void {
    const files = PlanNotesComponent.clipboardFiles(event);
    if (!files.length) return;
    event.preventDefault();
    this.addFiles(files, true);
  }

  onDragOver(event: DragEvent): void {
    if (!PlanNotesComponent.hasFiles(event)) return;
    event.preventDefault();
    this.dropping.set(true);
  }

  onDrop(event: DragEvent): void {
    if (!PlanNotesComponent.hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.dropping.set(false);
    this.addFiles(event.dataTransfer?.files);
  }

  onPick(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    this.addFiles(inputEl.files);
    inputEl.value = '';
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.send();
    }
  }

  send(): void {
    if (!this.canSend()) return;
    const files = this.pending().map((p) => p.file);
    this.busy.set(true);
    this.api.addNote(this.planId(), this.text.trim(), this.stepKeyChoice(), files).subscribe({
      next: (note) => {
        this.busy.set(false);
        this.text = '';
        this.pending().forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
        this.pending.set([]);
        this.stepOverride.set(undefined);
        this.snackBar.open(`Comentário #${note.number} enviado — o Claude considera na análise.`, 'Ok', { duration: 4000 });
        this.changed.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.snackBar.open(planApiError(err, 'Não foi possível enviar o comentário.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  // ── Editar / remover ───────────────────────────────────────────────────────────────────────────

  canChange(note: ExecutionNote): boolean {
    const me = this.currentUserId();
    return !note.fromExecutor && !!me && !!note.authorUserId && note.authorUserId.toLowerCase() === me.toLowerCase();
  }

  startEdit(note: ExecutionNote): void {
    this.editText = note.text;
    this.editingId.set(note.id);
  }

  onEditKey(event: KeyboardEvent, note: ExecutionNote): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); this.saveEdit(note); }
    if (event.key === 'Escape') this.editingId.set(null);
  }

  saveEdit(note: ExecutionNote): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.editNote(note.planId, note.id, this.editText.trim()).subscribe({
      next: () => { this.busy.set(false); this.editingId.set(null); this.changed.emit(); },
      error: (err) => { this.busy.set(false); this.snackBar.open(planApiError(err, 'Não foi possível editar.'), 'Fechar', { duration: 8000 }); }
    });
  }

  remove(note: ExecutionNote): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.deleteNote(note.planId, note.id).subscribe({
      next: () => { this.busy.set(false); this.confirmDeleteId.set(null); this.changed.emit(); },
      error: (err) => { this.busy.set(false); this.snackBar.open(planApiError(err, 'Não foi possível remover.'), 'Fechar', { duration: 8000 }); }
    });
  }

  // ── Anexos ─────────────────────────────────────────────────────────────────────────────────────

  /** Sempre no visualizador de arquivos do app (inclusive anexos do outro plano) — nada de guia com blob (PWA). */
  open(a: ExecutionArtifact): void {
    this.openArtifact.emit(a);
  }

  private loadThumb(a: ExecutionArtifact): void {
    if (this.thumbs()[a.id] || this.loadingThumbs.has(a.id)) return;
    this.loadingThumbs.add(a.id);
    this.api.content(a.planId, a.id).subscribe({
      next: (blob) => this.thumbs.update((t) => ({ ...t, [a.id]: URL.createObjectURL(blob) })),
      error: () => this.loadingThumbs.delete(a.id)
    });
  }

  copyRef(text: string): void {
    this.clipboard.copyFullDescriptionToClipboard(text);
  }

  // ── Formatação ─────────────────────────────────────────────────────────────────────────────────

  stepTitle(key: string): string {
    return this.steps().find((s) => s.key === key)?.title ?? key;
  }

  phaseLabel(phase: PlanPhase): string {
    return phase === 'correction' ? 'na correção' : 'na análise';
  }

  fileIcon(a: ExecutionArtifact): string {
    return ({ script: 'code', analysis: 'description', data: 'dataset', image: 'image' } as Record<string, string>)[a.kind] ?? this.iconByName(a.name);
  }

  pendingIcon(file: File): string {
    return this.iconByName(file.name);
  }

  private iconByName(name: string): string {
    if (/\.pdf$/i.test(name)) return 'picture_as_pdf';
    if (/\.(csv|xlsx?|json|log|txt|xml)$/i.test(name)) return 'dataset';
    if (/\.(zip|rar|7z)$/i.test(name)) return 'folder_zip';
    return 'insert_drive_file';
  }

  size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  relative(value: string): string {
    const diff = Date.now() - Date.parse(value);
    if (isNaN(diff)) return '';
    const min = Math.floor(Math.max(0, diff) / 60000);
    if (min < 1) return 'agora mesmo';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h} h`;
    return this.formatDateTime(value);
  }

  formatDateTime(value: string): string {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** Imagem colada/arrastada sem nome útil ("image.png") vira "colado-AAAAMMDD-HHMMSS-n.png". */
  private renameClipboardFile(file: File): File {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'bin';
    const name = `colado-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${this.seq + 1}.${ext}`;
    return new File([file], name, { type: file.type || 'application/octet-stream', lastModified: file.lastModified });
  }

  static hasFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }

  static clipboardFiles(event: ClipboardEvent): File[] {
    return Array.from(event.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
  }

  ngOnDestroy(): void {
    Object.values(this.thumbs()).forEach((url) => URL.revokeObjectURL(url));
    this.pending().forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
  }
}
