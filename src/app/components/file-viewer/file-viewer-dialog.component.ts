import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
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
}

export const FILE_VIEWER_DIALOG = {
  width: 'min(1100px, 96vw)',
  maxWidth: '96vw',
  height: 'min(860px, 92vh)',
  panelClass: 'plan-files-dialog-panel',
  autoFocus: false
};

/** Um arquivo no visualizador rico (`app-file-viewer`) — o "Abrir" dos arquivos do item de trabalho. */
@Component({
  selector: 'app-file-viewer-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, FileViewerComponent],
  template: `
    <div class="fvd">
      <div class="fvd__header">
        <mat-icon class="fvd__lead">{{ data.icon || 'description' }}</mat-icon>
        <div class="fvd__titles">
          <span class="fvd__title" [title]="data.name">{{ data.name }}</span>
          @if (data.subtitle) { <span class="fvd__sub">{{ data.subtitle }}</span> }
        </div>
        <span class="fvd__spacer"></span>
        <button mat-icon-button mat-dialog-close matTooltip="Fechar (Esc)" aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </div>
      @if (data.note) { <div class="fvd__note"><mat-icon>info_outline</mat-icon>{{ data.note }}</div> }
      @if (error()) {
        <div class="fvd__state fvd__state--err"><mat-icon>error_outline</mat-icon>Não foi possível carregar o arquivo.</div>
      } @else if (!blob()) {
        <div class="fvd__state"><mat-icon class="fvd__spin">progress_activity</mat-icon>Carregando…</div>
      } @else {
        <app-file-viewer [name]="data.name" [contentType]="data.contentType" [kind]="data.kind" [blob]="blob()" [card]="data.card" [actions]="true">
          <ng-container viewerActions>
            @if (canCopy()) {
              <button mat-stroked-button (click)="copy()"><mat-icon>{{ copied() ? 'check' : (data.ticket ? 'confirmation_number' : 'content_copy') }}</mat-icon>
                {{ data.ticket ? 'Copiar chamado' : 'Copiar' }}</button>
            }
            <button mat-flat-button color="primary" (click)="download()"><mat-icon>download</mat-icon> Baixar</button>
          </ng-container>
        </app-file-viewer>
      }
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

  readonly blob = signal<Blob | null>(null);
  readonly error = signal(false);
  readonly copied = signal(false);

  constructor() {
    this.data.load().then((b) => this.blob.set(b), () => this.error.set(true));
  }

  canCopy(): boolean {
    const b = this.blob();
    if (!b) return false;
    const kind = fileViewKind(this.data.name, this.data.contentType || b.type, b.size, this.data.kind);
    return kind !== 'image' && kind !== 'none';
  }

  async copy(): Promise<void> {
    const b = this.blob();
    if (!b) return;
    const text = await b.text();
    if (!text.trim()) { this.snack.open('O arquivo está vazio.', 'Ok', { duration: 3000 }); return; }
    const markdown = fileViewKind(this.data.name, this.data.contentType || b.type, b.size, this.data.kind) === 'markdown';
    if (this.data.ticket && markdown) await this.clipboard.copyRichToClipboard(renderMarkdown(text, { codeRefs: false }), text);
    else this.clipboard.copyFullDescriptionToClipboard(text);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1600);
  }

  download(): void {
    const b = this.blob();
    if (b) saveBlob(b, this.data.name);
  }
}
