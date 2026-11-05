import { Component, OnDestroy, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import {
  ExecutionPlanService,
  fileNameFromResponse,
  saveBlob
} from '../../services/execution-plan.service';
import { CliipboardService } from '../../services/cliipboard.service';
import { FileViewKind, FileViewerComponent, fileViewKind } from '../file-viewer/file-viewer.component';
import { ARTIFACT_GROUPS, ArtifactGroup, ExecutionArtifact } from './execution-plan.model';

export interface PlanFilesDialogData {
  planId: string;
  cardNumber: string;
  /** Lista viva: arquivos novos da skill aparecem com o dialog aberto. */
  artifacts: Signal<ExecutionArtifact[]>;
  groupId?: ArtifactGroup['id'];
  artifactId?: string;
  stepTitle: (key: string) => string | null;
}

interface Preview {
  artifact: ExecutionArtifact;
  kind: FileViewKind;
  blob: Blob;
}

/**
 * Visualizador dos arquivos do plano (feature 0023): lista por tipo à esquerda, prévia à direita
 * (`app-file-viewer` — o mesmo da aba Arquivos da Bancada): SQL/código com números de linha e destaque,
 * markdown renderizado (ou o fonte), JSON formatado, imagem com zoom. Copiar, baixar (nome original, ex.: .sql), abrir a imagem em nova aba e baixar
 * tudo (.zip). O conteúdo vem pelo HttpClient (x-api-key) como blob.
 */
@Component({
  selector: 'app-plan-files-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, FileViewerComponent],
  template: `
    <div class="pf">
      <div class="pf__header">
        <mat-icon class="pf__lead">folder_open</mat-icon>
        <span class="pf__title">Arquivos do plano · #{{ data.cardNumber }}</span>
        <span class="pf__spacer"></span>
        <button mat-stroked-button (click)="downloadZip()" [disabled]="!all().length || zipping()">
          <mat-icon>{{ zipping() ? 'progress_activity' : 'folder_zip' }}</mat-icon><span class="pf__zip-label"> Baixar tudo (.zip)</span>
        </button>
        <button mat-icon-button mat-dialog-close matTooltip="Fechar (Esc)" aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </div>

      <div class="pf__tabs" role="tablist">
        @for (g of groups; track g.id) {
          <button class="pf__tab" role="tab" [class.pf__tab--on]="groupId() === g.id" [attr.aria-selected]="groupId() === g.id"
                  (click)="selectGroup(g.id)">
            <mat-icon>{{ g.icon }}</mat-icon>{{ g.label }}<span class="pf__count">{{ countOf(g) }}</span>
          </button>
        }
      </div>

      <div class="pf__body">
        <div class="pf__list">
          @for (a of list(); track a.id) {
            <button class="pf__item" [class.pf__item--on]="selectedId() === a.id" (click)="select(a)">
              <mat-icon class="pf__item-icon">{{ iconOf(a) }}</mat-icon>
              <span class="pf__item-text">
                <span class="pf__item-name">{{ a.name }}</span>
                <span class="pf__item-meta">
                  {{ size(a.size) }} · {{ time(a.updatedAt || a.createdAt) }}
                  @if (a.stepKey && data.stepTitle(a.stepKey); as st) { · {{ st }} }
                </span>
              </span>
            </button>
          } @empty {
            <div class="pf__empty">Nenhum arquivo deste tipo ainda.</div>
          }
        </div>

        <div class="pf__preview">
          @if (loading()) {
            <div class="pf__state"><mat-icon class="pf__spin">progress_activity</mat-icon> Carregando…</div>
          } @else if (error()) {
            <div class="pf__state pf__state--error"><mat-icon>error_outline</mat-icon> {{ error() }}</div>
          } @else if (preview(); as p) {
            <app-file-viewer [name]="p.artifact.name" [contentType]="p.artifact.contentType" [kind]="p.artifact.kind"
                             [description]="p.artifact.description" [blob]="p.blob" [card]="data.cardNumber" [bar]="true" [actions]="true">
              <ng-container viewerActions>
                @if (p.kind !== 'none') {
                  <button mat-icon-button (click)="copy()" [matTooltip]="p.kind === 'image' ? 'Copiar imagem' : 'Copiar conteúdo'" aria-label="Copiar">
                    <mat-icon>content_copy</mat-icon>
                  </button>
                }
                <button mat-flat-button color="primary" (click)="download()"><mat-icon>download</mat-icon> Baixar</button>
              </ng-container>
            </app-file-viewer>
          } @else {
            <div class="pf__state"><mat-icon>touch_app</mat-icon> Escolha um arquivo.</div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .pf { display: flex; flex-direction: column; height: 100%; color: var(--mat-sys-on-surface); }
    .pf__header { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 18px; background: var(--surface-2, #323232);
      border-bottom: 1px solid rgba(255,255,255,.06); }
    .pf__lead { color: var(--mat-sys-primary); }
    .pf__title { font-weight: 600; font-size: 15px; }
    .pf__spacer { flex: 1 1 auto; }
    /* flex: none — com overflow-x o item podia encolher na vertical e as abas ficavam cortadas (prévia alta). */
    .pf__tabs { flex: none; display: flex; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid rgba(255,255,255,.06); overflow-x: auto; }
    .pf__tab { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border: none; background: transparent;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent); font: inherit; font-size: 13px; cursor: pointer;
      border-bottom: 2px solid transparent; white-space: nowrap; }
    .pf__tab .mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pf__tab--on { color: var(--mat-sys-primary); border-bottom-color: var(--mat-sys-primary); }
    .pf__count { min-width: 18px; padding: 0 5px; border-radius: 9px; font-size: 11px; font-weight: 700; text-align: center;
      background: rgba(255,255,255,.08); }
    .pf__body { flex: 1 1 auto; min-height: 0; display: flex; }
    .pf__list { flex: 0 0 min(300px, 38%); overflow-y: auto; padding: 8px; border-right: 1px solid rgba(255,255,255,.06); }
    .pf__item { width: 100%; display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border: none; border-radius: 8px;
      background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .pf__item:hover { background: rgba(255,255,255,.04); }
    .pf__item--on { background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent); }
    .pf__item-icon { flex: none; font-size: 18px; width: 18px; height: 18px; margin-top: 1px; color: var(--mat-sys-primary); }
    .pf__item-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf__item-name { font-size: 13px; font-weight: 500; word-break: break-all; }
    .pf__item-meta { font-size: 11px; color: color-mix(in srgb, var(--mat-sys-on-surface) 50%, transparent); }
    .pf__empty { padding: 16px; font-size: 13px; color: color-mix(in srgb, var(--mat-sys-on-surface) 50%, transparent); }
    .pf__preview { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .pf__state { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px;
      text-align: center; font-size: 13px; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .pf__state--error { color: var(--mat-sys-error, #f2b8b5); }
    .pf__spin { animation: pf-spin .9s linear infinite; }
    @keyframes pf-spin { to { transform: rotate(360deg); } }
    /* Celular (0043): o título não divide espaço com o rótulo do .zip (o ícone basta). */
    @media (max-width: 576px) {
      .pf__zip-label { display: none; }
      .pf__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    }
    @media (max-width: 720px) {
      .pf__body { flex-direction: column; }
      .pf__list { flex: 0 0 auto; max-height: 34%; border-right: none; border-bottom: 1px solid rgba(255,255,255,.06); }
    }
  `]
})
export class PlanFilesDialogComponent implements OnDestroy {
  readonly data = inject<PlanFilesDialogData>(MAT_DIALOG_DATA);
  private api = inject(ExecutionPlanService);
  private snackBar = inject(MatSnackBar);
  private clipboard = inject(CliipboardService);

  readonly groups = ARTIFACT_GROUPS;
  readonly all = this.data.artifacts;
  readonly groupId = signal<ArtifactGroup['id']>(this.data.groupId ?? this.firstGroupWithFiles());
  readonly selectedId = signal<string | null>(this.data.artifactId ?? null);
  readonly preview = signal<Preview | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly zipping = signal(false);

  readonly list = computed(() => {
    const group = ARTIFACT_GROUPS.find((g) => g.id === this.groupId())!;
    return this.all().filter((a) => group.kinds.includes(a.kind)).sort((a, b) => a.name.localeCompare(b.name));
  });

  private sub?: Subscription;

  constructor() {
    // Seleção inicial e arquivo atualizado pela skill (sha mudou) → recarrega a prévia.
    effect(() => {
      const list = this.list();
      const id = this.selectedId();
      const current = untracked(() => this.preview());
      const target = list.find((a) => a.id === id) ?? (id ? null : list[0] ?? null);
      if (!target) return;
      if (!current || current.artifact.id !== target.id || current.artifact.sha256 !== target.sha256) {
        untracked(() => this.loadPreview(target));
      }
    });
  }

  countOf(g: ArtifactGroup): number {
    return this.all().filter((a) => g.kinds.includes(a.kind)).length;
  }

  selectGroup(id: ArtifactGroup['id']): void {
    this.groupId.set(id);
    this.selectedId.set(null);
    this.preview.set(null);
  }

  select(a: ExecutionArtifact): void {
    this.selectedId.set(a.id);
  }

  private loadPreview(a: ExecutionArtifact): void {
    this.selectedId.set(a.id);
    this.loading.set(true);
    this.error.set(null);
    this.sub?.unsubscribe();
    // Anexo de comentário pode ser do outro plano do card (0031).
    this.sub = this.api.content(a.planId || this.data.planId, a.id).subscribe({
      next: (blob) => {
        if (this.selectedId() !== a.id) return;
        this.preview.set({ artifact: a, kind: fileViewKind(a.name, a.contentType || blob.type, blob.size, a.kind), blob });
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Não foi possível carregar o arquivo.');
      }
    });
  }

  async copy(): Promise<void> {
    const p = this.preview();
    if (!p) return;
    if (p.kind === 'image') {
      try {
        // A área de transferência aceita PNG; outros formatos são convertidos pelo navegador quando possível.
        await navigator.clipboard.write([new ClipboardItem({ [p.blob.type || 'image/png']: p.blob })]);
        this.snackBar.open('Imagem copiada', 'Ok', { duration: 3000 });
      } catch {
        this.snackBar.open('O navegador não permitiu copiar esta imagem — use Baixar.', 'Ok', { duration: 5000 });
      }
      return;
    }
    this.clipboard.copyFullDescriptionToClipboard(await p.blob.text());
  }

  download(): void {
    const p = this.preview();
    if (p) saveBlob(p.blob, p.artifact.name);
  }

  downloadZip(): void {
    this.zipping.set(true);
    this.api.zip(this.data.planId).subscribe({
      next: (res) => {
        this.zipping.set(false);
        if (res.body) saveBlob(res.body, fileNameFromResponse(res, `card-${this.data.cardNumber}.zip`));
      },
      error: () => {
        this.zipping.set(false);
        this.snackBar.open('Não foi possível baixar os arquivos.', 'Fechar', { duration: 6000 });
      }
    });
  }

  iconOf(a: ExecutionArtifact): string {
    return { script: 'code', analysis: 'description', data: 'dataset', image: 'image', attachment: 'attach_file', ticket: 'confirmation_number' }[a.kind] ?? 'insert_drive_file';
  }

  size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  time(value: string): string {
    const d = new Date(value);
    const p = (n: number) => String(n).padStart(2, '0');
    return isNaN(d.getTime()) ? '' : `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  private firstGroupWithFiles(): ArtifactGroup['id'] {
    const all = this.data.artifacts();
    return ARTIFACT_GROUPS.find((g) => all.some((a) => g.kinds.includes(a.kind)))?.id ?? 'scripts';
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
