import { Component, DestroyRef, ViewEncapsulation, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { DevOpsService } from '../../services/devops.service';
import { saveBlob } from '../../services/execution-plan.service';
import { FILE_VIEWER_DIALOG, FileViewerDialogComponent, FileViewerDialogData } from '../file-viewer/file-viewer-dialog.component';
import { DevOpsAttachment, devOpsErrorMessage } from './devops.model';

const SNACK = { horizontalPosition: 'right', verticalPosition: 'top' } as const;
const SOURCE_LABEL: Record<string, string> = { anexo: 'Anexado', campo: 'No campo', discussion: 'Na discussion' };

/** Tamanho legível (KB/MB). */
export function fileSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Ícone pelo nome do arquivo. */
export function fileIcon(name: string): string {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'picture_as_pdf';
  if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return 'movie';
  if (['zip', 'rar', '7z', 'gz'].includes(ext)) return 'folder_zip';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'table_chart';
  if (['doc', 'docx', 'txt', 'md', 'log', 'json', 'xml', 'sql'].includes(ext)) return 'description';
  return 'attach_file';
}

/**
 * 0099 ajustes 3: aba "Anexos" do modal do card — o que o DevOps tem do card: arquivos anexados e imagens coladas nos
 * campos e na discussion (a mesma lista que o especialista lê com `prmake_devops_card_attachments`). Imagens com miniatura;
 * "Abrir" no visualizador do PRMake e "Baixar" — tudo baixado pelo PRMake com a integração de quem vê.
 */
@Component({
  selector: 'app-devops-card-attachments',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="dva">
      <div class="dva__head">
        <span class="dv-hint">Arquivos anexados ao card e imagens coladas na descrição, nos campos e na discussion. O Especialista de gestão também lê estes anexos quando a pergunta depende deles.</span>
        <span class="dva__spacer"></span>
        @if (webUrl()) {
          <a mat-stroked-button [href]="webUrl()" target="_blank" rel="noopener" matTooltip="Anexar arquivos é pelo DevOps (aba Attachments do card)">
            <mat-icon>open_in_new</mat-icon>Anexar no DevOps
          </a>
        }
        <button mat-icon-button type="button" (click)="load()" [disabled]="loading()" matTooltip="Recarregar" aria-label="Recarregar anexos"><mat-icon>refresh</mat-icon></button>
      </div>
      @if (loading()) { <mat-progress-bar mode="indeterminate" class="dva__progress" /> }
      @if (error(); as e) {
        <div class="dva__err"><mat-icon>error_outline</mat-icon><span>{{ e }}</span><button type="button" class="dv-linkbtn" (click)="load()">Tentar de novo</button></div>
      }
      @if (!loading() && !error() && !items().length) { <div class="dv-hint dva__empty">Nenhum anexo neste card.</div> }

      <ul class="dva__grid">
        @for (a of items(); track a.id) {
          <li class="dva__item">
            <button type="button" class="dva__thumb" (click)="open(a)" [attr.aria-label]="'Abrir ' + a.name" [matTooltip]="'Abrir ' + a.name">
              @if (a.isImage && thumbs()[a.id]; as src) { <img [src]="src" [alt]="a.name"> }
              @else { <mat-icon>{{ icon(a.name) }}</mat-icon> }
            </button>
            <div class="dva__info">
              <span class="dva__name" [title]="a.name">{{ a.name }}</span>
              <span class="dva__meta">
                {{ sourceLabel(a) }}@if (a.sourceDetail) { · {{ a.sourceDetail }} }
                @if (a.size) { · {{ size(a.size) }} }
                @if (a.at) { · {{ a.at | date: 'dd/MM/yy HH:mm' }} }
              </span>
              @if (a.comment) { <span class="dva__comment">{{ a.comment }}</span> }
            </div>
            <div class="dva__actions">
              <button mat-icon-button type="button" (click)="open(a)" matTooltip="Abrir" aria-label="Abrir"><mat-icon>visibility</mat-icon></button>
              <button mat-icon-button type="button" (click)="download(a)" matTooltip="Baixar" aria-label="Baixar"><mat-icon>download</mat-icon></button>
            </div>
          </li>
        }
      </ul>
    </div>
  `,
  styles: [`
    app-devops-card-attachments { display: block; }
    .dva { display: flex; flex-direction: column; gap: 10px; }
    .dva__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .dva__head .dv-hint { flex: 1 1 320px; }
    .dva__head a mat-icon { margin-right: 4px; }
    .dva__spacer { flex: 0; }
    .dva__progress { height: 2px; }
    .dva__err { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px; font-size: 12.5px;
      background: rgba(248,81,73,.08); border: 1px solid rgba(248,81,73,.35); }
    .dva__empty { padding: 8px 2px; }
    .dva__grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
    .dva__item { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 8px; border-radius: 10px;
      border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); background: color-mix(in srgb, var(--surface-2, #2e343f) 70%, transparent); }
    .dva__thumb { flex: none; width: 64px; height: 52px; border-radius: 8px; border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08));
      background: var(--surface-input, #1a1f28); display: grid; place-items: center; overflow: hidden; cursor: zoom-in; padding: 0; color: var(--cc-text-2); }
    .dva__thumb img { width: 100%; height: 100%; object-fit: cover; }
    .dva__info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .dva__name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dva__meta { font-size: 11.5px; color: var(--cc-text-3); }
    .dva__comment { font-size: 12px; color: var(--cc-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dva__actions { display: flex; flex: none; }
  `]
})
export class DevOpsCardAttachmentsComponent {
  private api = inject(DevOpsService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  readonly card = input<string | null>(null);
  /** Link do card no DevOps (anexar é por lá). */
  readonly webUrl = input<string | null>(null);
  readonly countChange = output<number>();

  readonly items = signal<DevOpsAttachment[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Miniaturas (object URLs) por anexo. */
  readonly thumbs = signal<Record<string, string>>({});
  readonly count = computed(() => this.items().length);
  private loadSeq = 0;

  constructor() {
    effect(() => {
      const card = this.card();
      untracked(() => {
        this.clearThumbs();
        this.items.set([]);
        if (card) this.load();
      });
    });
    inject(DestroyRef).onDestroy(() => this.clearThumbs());
  }

  load(): void {
    const card = this.card();
    if (!card) return;
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    this.api.attachments(card).subscribe({
      next: (list) => {
        if (seq !== this.loadSeq) return;
        this.items.set(list);
        this.countChange.emit(list.length);
        this.loading.set(false);
        this.loadThumbs(card, list);
      },
      error: (e) => {
        if (seq !== this.loadSeq) return;
        this.error.set(devOpsErrorMessage(e, 'Não foi possível ler os anexos do card.'));
        this.loading.set(false);
      }
    });
  }

  private loadThumbs(card: string, list: DevOpsAttachment[]): void {
    for (const a of list.filter((x) => x.isImage).slice(0, 40)) {
      if (this.thumbs()[a.id]) continue;
      this.api.attachmentBlob(card, a.id, a.name).subscribe({
        next: (b) => { if (this.card() === card) this.thumbs.update((t) => ({ ...t, [a.id]: URL.createObjectURL(b) })); },
        error: () => {}
      });
    }
  }

  private clearThumbs(): void {
    for (const url of Object.values(this.thumbs())) URL.revokeObjectURL(url);
    this.thumbs.set({});
  }

  open(a: DevOpsAttachment): void {
    const card = this.card();
    if (!card) return;
    const data: FileViewerDialogData = {
      name: a.name,
      icon: this.icon(a.name),
      subtitle: [`Card ${card}`, this.sourceLabel(a), a.sourceDetail].filter(Boolean).join(' · '),
      card,
      load: () => firstValueFrom(this.api.attachmentBlob(card, a.id, a.name)),
    };
    this.dialog.open(FileViewerDialogComponent, { ...FILE_VIEWER_DIALOG, data });
  }

  download(a: DevOpsAttachment): void {
    const card = this.card();
    if (!card) return;
    this.api.attachmentBlob(card, a.id, a.name, true).subscribe({
      next: (b) => saveBlob(b, a.name),
      error: (e) => this.snack.open(devOpsErrorMessage(e, `Não foi possível baixar ${a.name}.`), 'Ok', { ...SNACK, duration: 6000 })
    });
  }

  sourceLabel(a: DevOpsAttachment): string {
    return SOURCE_LABEL[a.source] ?? a.source;
  }

  icon(name: string): string {
    return fileIcon(name);
  }

  size(bytes: number | null | undefined): string {
    return fileSize(bytes);
  }
}
