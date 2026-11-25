import { Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { saveBlob } from '../../services/execution-plan.service';
import { CliipboardService } from '../../services/cliipboard.service';
import { renderMarkdown } from '../../helpers/markdown-ext';
import { FileViewerComponent, fileViewKind } from './file-viewer.component';

export interface FileViewerDialogData {
  name: string;
  contentType?: string | null;
  kind?: string | null;
  subtitle?: string | null;
  icon?: string | null;
  card?: string | null;
  /** Aviso no topo (ex.: chamado completo — copie e abra no sistema de chamados). */
  note?: string | null;
  /** Copiar como chamado (texto + formatado). */
  ticket?: boolean;
  load: () => Promise<Blob>;
  /**
   * Galeria: os arquivos da mesma lista (anexos do card, evidências, arquivos do item) para ir e voltar com ← → ou com as setas
   * nas bordas. `index` = o aberto. Sem `items`, só este arquivo.
   */
  items?: FileViewerDialogData[];
  index?: number;
}

/** Abre o visualizador num arquivo de uma lista (← → navegam entre eles). */
export function openFileViewer(dialog: MatDialog, items: FileViewerDialogData[], index: number) {
  const i = Math.max(0, Math.min(index, items.length - 1));
  return dialog.open(FileViewerDialogComponent, { ...FILE_VIEWER_DIALOG, data: { ...items[i], items, index: i } });
}

export const FILE_VIEWER_DIALOG = {
  width: 'min(1100px, 96vw)',
  maxWidth: '96vw',
  height: 'min(860px, 92vh)',
  panelClass: 'plan-files-dialog-panel',
  autoFocus: false
};

/**
 * Um arquivo no visualizador rico (`app-file-viewer`) — o "Abrir" dos arquivos do item de trabalho, dos anexos do card e das
 * evidências. Com `items`, navega entre os arquivos da lista: ← → do teclado ou as setas nas bordas (apagadas nas pontas).
 */
@Component({
  selector: 'app-file-viewer-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, FileViewerComponent],
  template: `
    <div class="fvd">
      <div class="fvd__header">
        <mat-icon class="fvd__lead">{{ cur().icon || 'description' }}</mat-icon>
        <div class="fvd__titles">
          <span class="fvd__title" [title]="cur().name">{{ cur().name }}</span>
          @if (cur().subtitle) { <span class="fvd__sub">{{ cur().subtitle }}</span> }
        </div>
        <span class="fvd__spacer"></span>
        @if (list.length > 1) { <span class="fvd__count" aria-live="polite">{{ index() + 1 }} de {{ list.length }}</span> }
        <button mat-icon-button mat-dialog-close matTooltip="Fechar (Esc)" aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </div>
      @if (cur().note) { <div class="fvd__note"><mat-icon>info_outline</mat-icon>{{ cur().note }}</div> }
      <div class="fvd__stage">
      @if (error()) {
        <div class="fvd__state fvd__state--err"><mat-icon>error_outline</mat-icon>Não foi possível carregar o arquivo.</div>
      } @else if (!blob()) {
        <div class="fvd__state"><mat-icon class="fvd__spin">progress_activity</mat-icon>Carregando…</div>
      } @else {
        <app-file-viewer [name]="cur().name" [contentType]="cur().contentType" [kind]="cur().kind" [blob]="blob()" [card]="cur().card" [actions]="true">
          <ng-container viewerActions>
            @if (canCopy()) {
              <button mat-stroked-button (click)="copy()"><mat-icon>{{ copied() ? 'check' : (cur().ticket ? 'confirmation_number' : 'content_copy') }}</mat-icon>
                {{ cur().ticket ? 'Copiar chamado' : 'Copiar' }}</button>
            }
            <button mat-flat-button color="primary" (click)="download()"><mat-icon>download</mat-icon> Baixar</button>
          </ng-container>
        </app-file-viewer>
      }
      @if (list.length > 1) {
        <button type="button" class="fvd__nav fvd__nav--prev" (click)="go(-1)" [disabled]="index() === 0"
                [attr.aria-label]="'Anterior' + (index() > 0 ? ': ' + list[index() - 1].name : '')"
                [matTooltip]="index() > 0 ? 'Anterior (←): ' + list[index() - 1].name : 'Este é o primeiro'"><mat-icon>chevron_left</mat-icon></button>
        <button type="button" class="fvd__nav fvd__nav--next" (click)="go(1)" [disabled]="index() === list.length - 1"
                [attr.aria-label]="'Próximo' + (index() < list.length - 1 ? ': ' + list[index() + 1].name : '')"
                [matTooltip]="index() < list.length - 1 ? 'Próximo (→): ' + list[index() + 1].name : 'Este é o último'"><mat-icon>chevron_right</mat-icon></button>
      }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .fvd { display: flex; flex-direction: column; height: 100%; color: var(--mat-sys-on-surface); }
    .fvd__header { flex: none; display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 18px; background: var(--surface-2, #323232);
      border-bottom: 1px solid rgba(255,255,255,.06); }
    .fvd__lead { color: var(--mat-sys-primary); flex: none; }
    .fvd__titles { min-width: 0; display: flex; flex-direction: column; }
    .fvd__title { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fvd__sub { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .fvd__spacer { flex: 1 1 auto; }
    .fvd__count { flex: none; font-size: 12.5px; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .fvd__stage { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; position: relative; }
    .fvd__nav { position: absolute; top: 50%; z-index: 2; transform: translateY(-50%); width: 40px; height: 64px; border-radius: 10px; border: 1px solid rgba(255,255,255,.14);
      display: grid; place-items: center; cursor: pointer; color: #fff; background: rgba(20,22,26,.62); backdrop-filter: blur(4px);
      transition: background .15s, opacity .15s; padding: 0; }
    .fvd__nav:hover:not(:disabled) { background: rgba(20,22,26,.85); }
    .fvd__nav:disabled { opacity: .28; cursor: default; }
    .fvd__nav .mat-icon { font-size: 30px; width: 30px; height: 30px; }
    .fvd__nav--prev { left: 10px; }
    .fvd__nav--next { right: 10px; }
    @media (max-width: 600px) { .fvd__nav { width: 34px; height: 52px; } .fvd__nav--prev { left: 4px; } .fvd__nav--next { right: 4px; } }
    .fvd__note { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 18px; font-size: 13px;
      background: color-mix(in srgb, #d29922 12%, transparent); }
    .fvd__note .mat-icon { font-size: 18px; width: 18px; height: 18px; color: #d29922; }
    .fvd__state { flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
      font-size: 13px; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .fvd__state--err { color: var(--mat-sys-error, #f2b8b5); }
    .fvd__spin { animation: fvd-spin .9s linear infinite; }
    @keyframes fvd-spin { to { transform: rotate(360deg); } }
  `]
})
export class FileViewerDialogComponent {
  readonly data = inject<FileViewerDialogData>(MAT_DIALOG_DATA);
  private snack = inject(MatSnackBar);
  private clipboard = inject(CliipboardService);

  /** Os arquivos da galeria (só este, sem `items`). */
  readonly list: FileViewerDialogData[] = this.data.items?.length ? this.data.items : [this.data];
  readonly index = signal(Math.max(0, Math.min(this.data.index ?? 0, this.list.length - 1)));
  readonly cur = computed(() => this.list[this.index()]);

  readonly blob = signal<Blob | null>(null);
  readonly error = signal(false);
  readonly copied = signal(false);
  /** Conteúdo já pedido por posição (ir e voltar não baixa de novo). */
  private loaded = new Map<number, Promise<Blob>>();

  constructor() {
    effect(() => {
      const i = this.index();
      untracked(() => this.show(i));
    });
  }

  private fetch(i: number): Promise<Blob> {
    let p = this.loaded.get(i);
    if (!p) {
      p = this.list[i].load();
      this.loaded.set(i, p);
      p.catch(() => this.loaded.delete(i)); // erro: tenta de novo ao voltar
    }
    return p;
  }

  private show(i: number): void {
    this.blob.set(null);
    this.error.set(false);
    this.copied.set(false);
    this.fetch(i).then((b) => { if (this.index() === i) this.blob.set(b); }, () => { if (this.index() === i) this.error.set(true); });
    // Adianta a imagem vizinha para a seta responder na hora (arquivos grandes, só quando abrir).
    for (const n of [i + 1, i - 1]) {
      const x = this.list[n];
      if (x && fileViewKind(x.name, x.contentType, 0, x.kind) === 'image') this.fetch(n).catch(() => {});
    }
  }

  /** Anterior (-1) / próximo (+1); para nas pontas. */
  go(step: number): void {
    const next = this.index() + step;
    if (next >= 0 && next < this.list.length) this.index.set(next);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (this.list.length < 2 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    e.preventDefault();
    this.go(e.key === 'ArrowLeft' ? -1 : 1);
  }

  canCopy(): boolean {
    const b = this.blob();
    if (!b) return false;
    const c = this.cur();
    const kind = fileViewKind(c.name, c.contentType || b.type, b.size, c.kind);
    return kind !== 'image' && kind !== 'pdf' && kind !== 'none';
  }

  async copy(): Promise<void> {
    const b = this.blob();
    if (!b) return;
    const text = await b.text();
    if (!text.trim()) { this.snack.open('O arquivo está vazio.', 'Ok', { duration: 3000 }); return; }
    const c = this.cur();
    const markdown = fileViewKind(c.name, c.contentType || b.type, b.size, c.kind) === 'markdown';
    if (c.ticket && markdown) await this.clipboard.copyRichToClipboard(renderMarkdown(text, { codeRefs: false }), text);
    else this.clipboard.copyFullDescriptionToClipboard(text);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1600);
  }

  download(): void {
    const b = this.blob();
    if (b) saveBlob(b, this.cur().name);
  }
}
