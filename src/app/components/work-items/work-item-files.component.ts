import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { WorkItemsService } from '../../services/work-items.service';
import { saveBlob } from '../../services/execution-plan.service';
import { CliipboardService } from '../../services/cliipboard.service';
import { renderMarkdown } from '../../helpers/markdown-ext';
import { FILE_VIEWER_DIALOG, FileViewerDialogComponent, FileViewerDialogData } from '../file-viewer/file-viewer-dialog.component';
import { formatWorkNumber } from './work-item.model';
import {
  WorkItemFile,
  fileIcon,
  fileKindLook,
  fileMeta,
  fileSourceChip,
  filePreviewKind,
  filesOfItem,
  filesOfTask,
  groupFiles,
  guessUploadKind,
  isTextFile,
  normalizeFiles
} from './work-item-files';
import { FilesSource } from './card-files.store';

/** Limite do servidor por arquivo (10 MB; 50 MB por item) — recusado já na tela. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * 0085 rodada 5 (1.2): **Arquivos** de um item de trabalho — só os dele (e os do plano ligado, marcados "do plano"),
 * agrupados por tipo (Chamados, Scripts, Análises, Dados, Textos, Anexos), com a sub-tarefa de origem. Abrir (o
 * visualizador de markdown/código do projeto), baixar, copiar o texto; o chamado ganha destaque e "Copiar chamado".
 * "Anexar arquivo" envia pelo `POST WorkItems/{number}/files`. Com `[taskNumber]` mostra só os daquela sub-tarefa (e o
 * upload fica ligado a ela). O estado vem do `WorkItemFilesStore` (ao vivo) de quem usa.
 */
@Component({
  selector: 'app-work-item-files',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wif" [class.wif--compact]="compact()">
      @if (store().unavailable()) {
        <p class="wif__note"><mat-icon>info_outline</mat-icon>Os arquivos do item ainda não estão disponíveis neste servidor.</p>
      } @else if (store().error(); as e) {
        <p class="wif__note wif__note--err"><mat-icon>error_outline</mat-icon>{{ e }}<button mat-button (click)="store().load()">Tentar de novo</button></p>
      }

      @if (ticket(); as t) {
        <div class="wif__ticket">
          <mat-icon class="wif__ticket-ico">confirmation_number</mat-icon>
          <div class="wif__ticket-main">
            <b>Chamado pronto</b>
            <span class="wif__ticket-name" [title]="t.name">{{ t.name }}</span>
            <small>Copie e abra no sistema de chamados; depois cole o link na sub-tarefa.</small>
          </div>
          <button mat-stroked-button (click)="open(t)"><mat-icon>visibility</mat-icon>Abrir</button>
          <button mat-flat-button color="primary" (click)="copy(t, true)" [disabled]="busyId() === key(t)">
            <mat-icon>{{ copiedId() === key(t) ? 'check' : 'content_copy' }}</mat-icon>Copiar chamado
          </button>
        </div>
      }

      @for (g of groups(); track g.look.kind) {
        <section class="wif__group">
          <h5 class="wif__group-title"><mat-icon [style.color]="g.look.color">{{ g.look.icon }}</mat-icon>{{ g.look.group }}<small>{{ g.files.length }}</small></h5>
          <ul class="wif__list">
            @for (f of g.files; track key(f)) {
              <li class="wif__row" [class.wif__row--ticket]="f.kind === 'ticket'">
                <mat-icon class="wif__ico" [style.color]="g.look.color">{{ icon(f) }}</mat-icon>
                <button class="wif__name-btn" (click)="open(f)" [title]="f.name">
                  <span class="wif__name">{{ f.name }}</span>
                  <span class="wif__meta">{{ meta(f) }}</span>
                </button>
                @if (showItem()) {
                  <span class="wif__chip wif__chip--item" [matTooltip]="f.workItemNumber ? 'Arquivo do item de trabalho ' + num(f.workItemNumber) : 'Arquivo de uma versão antiga do plano, sem item de trabalho'">
                    <mat-icon>checklist</mat-icon>{{ f.workItemNumber ? num(f.workItemNumber) : 'sem item' }}
                  </span>
                }
                @if (chip(f); as c) { <span class="wif__chip wif__chip--plan" [matTooltip]="c.tooltip"><mat-icon>{{ c.icon }}</mat-icon>{{ c.label }}</span> }
                <span class="wif__acts">
                  <button mat-icon-button (click)="open(f)" [matTooltip]="canOpen(f) ? 'Abrir' : 'Baixar'" [attr.aria-label]="'Abrir ' + f.name"><mat-icon>{{ canOpen(f) ? 'visibility' : 'download' }}</mat-icon></button>
                  @if (isText(f)) {
                    <button mat-icon-button (click)="copy(f, f.kind === 'ticket')" [disabled]="busyId() === key(f)" [matTooltip]="f.kind === 'ticket' ? 'Copiar chamado' : 'Copiar texto'" [attr.aria-label]="'Copiar ' + f.name">
                      <mat-icon>{{ copiedId() === key(f) ? 'check' : 'content_copy' }}</mat-icon>
                    </button>
                  }
                  @if (canOpen(f)) {
                    <button mat-icon-button (click)="download(f)" [disabled]="busyId() === key(f)" matTooltip="Baixar" [attr.aria-label]="'Baixar ' + f.name"><mat-icon>download</mat-icon></button>
                  }
                </span>
              </li>
            }
          </ul>
        </section>
      } @empty {
        @if (!store().unavailable() && !store().error()) {
          <p class="wif__empty">
            @if (!store().loaded()) { Carregando os arquivos… }
            @else if (taskNumber() != null) { Nenhum arquivo desta sub-tarefa ainda. }
            @else if (filterItem() !== undefined && store().files().length) { Este item ainda não tem arquivos. }
            @else if (showItem()) { Nenhum arquivo neste card ainda — análises, chamados, scripts, dados e anexos aparecem aqui assim que são gerados. }
            @else { Nenhum arquivo neste item ainda — scripts, análises, chamados e anexos gerados aparecem aqui. }
          </p>
        }
      }

      @if (allowUpload() && !store().unavailable()) {
        <div class="wif__foot">
          <input #fileInput type="file" multiple hidden (change)="onPick($event)" />
          <button mat-stroked-button (click)="fileInput.click()" [disabled]="uploading()">
            <mat-icon [class.wif__spin]="uploading()">{{ uploading() ? 'progress_activity' : 'attach_file' }}</mat-icon>{{ uploading() ? 'Enviando…' : 'Anexar arquivo' }}
          </button>
          @if (taskNumber() != null) { <small class="wif__muted">O arquivo fica ligado à sub-tarefa {{ num(taskNumber()!) }}.</small> }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .wif { display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
    .wif__note { display: flex; align-items: center; gap: 6px; margin: 0; padding: 6px 10px; border-radius: 8px; font-size: 12px; color: var(--cc-text-3);
      border: 1px dashed var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .wif__note mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; }
    .wif__note--err { color: #f85149; border-style: solid; border-color: rgba(248,81,73,.35); }
    .wif__ticket { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; padding: 10px 12px; border-radius: 10px;
      background: rgba(210,153,34,.08); border: 1px solid rgba(210,153,34,.35); }
    .wif__ticket-ico { color: #d29922; flex: none; }
    .wif__ticket-main { flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .wif__ticket-name { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wif__ticket-main small { color: var(--cc-text-3); font-size: 11.5px; }
    .wif__ticket .mat-mdc-button-base mat-icon { margin-right: 4px; }
    .wif__group { display: flex; flex-direction: column; gap: 2px; }
    .wif__group-title { display: flex; align-items: center; gap: 6px; margin: 0 0 2px; font-size: 11px; font-weight: 700; letter-spacing: .06em;
      text-transform: uppercase; color: var(--cc-text-3); }
    .wif__group-title mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .wif__group-title small { font-weight: 600; opacity: .8; }
    .wif__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
    .wif__row { display: flex; align-items: center; gap: 8px; padding: 3px 4px 3px 8px; border-radius: 8px; }
    .wif__row:hover { background: rgba(255,255,255,.04); }
    .wif__row--ticket { background: rgba(210,153,34,.05); }
    .wif__ico { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .wif__name-btn { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; background: none; border: 0; padding: 2px 0; color: inherit;
      font: inherit; text-align: left; cursor: pointer; }
    .wif__name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wif__name-btn:hover .wif__name { text-decoration: underline; }
    .wif__meta { font-size: 11px; color: var(--cc-text-3); }
    .wif__chip { display: inline-flex; align-items: center; gap: 3px; padding: 0 7px; border-radius: 999px; font-size: 11px; line-height: 18px; flex: none;
      border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); color: var(--cc-text-2); font-variant-numeric: tabular-nums; }
    .wif__chip mat-icon { font-size: 12px; width: 12px; height: 12px; }
    .wif__chip--item { color: var(--cc-text-2); }
    .wif__chip--plan { color: var(--mat-sys-primary); border-color: color-mix(in srgb, var(--mat-sys-primary) 40%, transparent); }
    .wif__acts { display: inline-flex; flex: none; }
    .wif__acts .mat-mdc-icon-button { width: 30px; height: 30px; padding: 3px; }
    .wif__acts mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .wif__empty { margin: 0; color: var(--cc-text-3); font-size: 12.5px; }
    .wif__foot { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .wif__foot .mat-mdc-button-base mat-icon { margin-right: 4px; }
    .wif__muted { color: var(--cc-text-3); font-size: 11.5px; }
    .wif__spin { animation: wif-spin 1s linear infinite; }
    @keyframes wif-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .wif__spin { animation: none; } }
    .wif--compact .wif__ticket small { display: none; }
    @media (max-width: 560px) { .wif__chip--plan { display: none; } }
  `]
})
export class WorkItemFilesComponent {
  /** Estado (lista ao vivo) — do modal/sessão que usa o componente. */
  readonly store = input.required<FilesSource>();
  /** 0087: só os arquivos deste item (`0` = planos sem item); `undefined` = todos (lista do card). */
  readonly filterItem = input<number | null | undefined>(undefined);
  /** 0087: mostra de qual item é cada arquivo (lista do card). */
  readonly showItem = input(false);
  readonly card = input<string | null>(null);
  /** Só os arquivos desta sub-tarefa (e o upload ligado a ela). */
  readonly taskNumber = input<number | null>(null);
  readonly allowUpload = input(true);
  readonly compact = input(false);

  private api = inject(WorkItemsService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private clipboard = inject(CliipboardService);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly uploading = signal(false);
  readonly busyId = signal<string | null>(null);
  readonly copiedId = signal<string | null>(null);

  readonly files = computed(() => filesOfTask(filesOfItem(this.store().files(), this.filterItem()), this.taskNumber()));
  readonly groups = computed(() => groupFiles(this.files()));
  /** Chamado mais recente (destaque com "Copiar chamado"). */
  readonly ticket = computed(() => this.files().find((f) => f.kind === 'ticket' && isTextFile(f)) ?? null);

  readonly num = (n: number) => formatWorkNumber(Number(n));
  readonly icon = fileIcon;
  /** Detalhes da linha (o "do plano" vira o chip). Filtrando por sub-tarefa, ela não se repete. */
  readonly meta = (f: WorkItemFile) => fileMeta(this.taskNumber() != null ? { ...f, taskNumber: null } : f, (n) => formatWorkNumber(n), false);
  readonly isText = isTextFile;
  readonly canOpen = (f: WorkItemFile) => filePreviewKind(f) !== 'none';
  readonly chip = fileSourceChip;
  readonly key = (f: WorkItemFile) => `${f.source ?? 'item'}:${f.id}`;

  private get itemNumber(): number {
    return this.store().itemNumber ?? 0;
  }

  /** Item dono do arquivo (na lista do card vem em cada um; o `contentUrl` do servidor já resolve o conteúdo). */
  private numberOf(f: WorkItemFile): number {
    return this.itemNumber || Number(f.workItemNumber ?? 0);
  }

  /** Abre no visualizador rico (o mesmo de "Arquivos e textos": SQL com destaque, markdown, imagem com zoom); sem prévia → baixa. */
  open(f: WorkItemFile): void {
    if (filePreviewKind(f) === 'none') { this.download(f); return; }
    const data: FileViewerDialogData = {
      name: f.name,
      contentType: f.contentType,
      kind: f.kind,
      subtitle: [fileKindLook(f.kind).label, fileMeta(f, (n) => formatWorkNumber(n))].filter(Boolean).join(' · '),
      icon: this.icon(f),
      card: this.card(),
      ticket: f.kind === 'ticket',
      note: f.kind === 'ticket' ? 'Chamado completo — copie (texto e formatado) e abra no sistema de chamados.' : null,
      load: () => firstValueFrom(this.api.fileContent(this.numberOf(f), f))
    };
    this.dialog.open(FileViewerDialogComponent, { ...FILE_VIEWER_DIALOG, data });
  }

  async download(f: WorkItemFile): Promise<void> {
    const id = this.key(f);
    this.busyId.set(id);
    try {
      saveBlob(await firstValueFrom(this.api.fileContent(this.numberOf(f), f)), f.name);
    } catch (e) {
      this.snack.open((e as Error)?.message || 'Não foi possível baixar o arquivo.', 'Fechar', { duration: 6000 });
    } finally {
      this.busyId.set(null);
    }
  }

  /** Copia o texto (markdown vai também formatado — cola bonito no sistema de chamados). */
  async copy(f: WorkItemFile, rich = false): Promise<void> {
    const id = this.key(f);
    this.busyId.set(id);
    try {
      const text = await (await firstValueFrom(this.api.fileContent(this.numberOf(f), f))).text();
      if (!text.trim()) { this.snack.open('O arquivo está vazio.', 'Ok', { duration: 3000 }); return; }
      if (rich && filePreviewKind(f) === 'markdown') await this.clipboard.copyRichToClipboard(renderMarkdown(text, { codeRefs: false }), text);
      else this.clipboard.copyFullDescriptionToClipboard(text);
      this.copiedId.set(id);
      setTimeout(() => { if (this.copiedId() === id) this.copiedId.set(null); }, 1600);
    } catch (e) {
      this.snack.open((e as Error)?.message || 'Não foi possível copiar o arquivo.', 'Fechar', { duration: 6000 });
    } finally {
      this.busyId.set(null);
    }
  }

  async onPick(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = '';
    if (!picked.length || !this.itemNumber) return;
    const tooBig = picked.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig.length) this.snack.open(`Arquivo grande demais (máx. 10 MB): ${tooBig.map((f) => f.name).join(', ')}`, 'Fechar', { duration: 7000 });
    const ok = picked.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    if (!ok.length) return;
    this.uploading.set(true);
    let sent = 0;
    for (const file of ok) {
      try {
        const saved = await firstValueFrom(this.api.uploadFile(this.itemNumber, file, guessUploadKind(file.name, file.type), this.taskNumber()));
        const [norm] = normalizeFiles([saved ?? {}]);
        this.store().add(norm);
        sent++;
      } catch (e) {
        this.snack.open((e as Error)?.message || `Não foi possível anexar "${file.name}".`, 'Fechar', { duration: 8000 });
      }
    }
    this.uploading.set(false);
    if (sent) {
      this.snack.open(sent === 1 ? 'Arquivo anexado ao item.' : `${sent} arquivos anexados ao item.`, 'Ok', { duration: 3000 });
      this.store().load();
    }
  }

  /** Abre o seletor de arquivo (atalho para quem embute o componente). */
  pick(): void {
    this.fileInput()?.nativeElement.click();
  }
}
