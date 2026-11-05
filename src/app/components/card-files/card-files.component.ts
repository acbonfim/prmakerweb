import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, model, signal, untracked
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, firstValueFrom, from, map } from 'rxjs';
import { WorkItemsService } from '../../services/work-items.service';
import { saveBlob } from '../../services/execution-plan.service';
import { CliipboardService } from '../../services/cliipboard.service';
import { renderMarkdown } from '../../helpers/markdown-ext';
import { FileViewerComponent } from '../file-viewer/file-viewer.component';
import { PlanDocumentService } from '../execution-plan/plan-document.service';
import { CardFilesStore } from '../work-items/card-files.store';
import { WorkItem, formatWorkNumber } from '../work-items/work-item.model';
import {
  CASE_FILES_KEY, FILE_KIND_LOOKS, WorkItemFile, WorkItemFileKind, countFilesByItem, fileIcon, fileKindLook, fileMeta, filePreviewKind, fileSourceChip,
  filesOfItem, isTextFile, normalizeFileKind, planDocumentFiles
} from '../work-items/work-item-files';

type KindTab = 'all' | WorkItemFileKind;

interface FileView {
  status: 'loading' | 'ready' | 'error' | 'none';
  blob?: Blob;
}

const NARROW = '(max-width: 720px)';

/**
 * 0087: **Arquivos do card** no mesmo formato do modal "Textos do card": a lista de arquivos à esquerda e a
 * visualização à direita, com abas por tipo (Todos · Textos · Análises · Chamados · Scripts · Dados · Anexos) e o filtro
 * por item de trabalho. Mostra tudo o que foi gerado ou anexado no card, de qualquer item — o item continua mostrando só
 * os seus arquivos na própria tela. No celular vira lista OU arquivo (com "voltar").
 */
@Component({
  selector: 'app-card-files',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, FileViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cf" [class.cf--detail]="narrow() && showDetail()">
      <div class="cf__tabs" role="tablist" aria-label="Tipos de arquivo">
        @for (t of tabs(); track t.id) {
          <button type="button" role="tab" class="cf__tab" [class.cf__tab--on]="kindTab() === t.id" [attr.aria-selected]="kindTab() === t.id"
                  (click)="kindTab.set(t.id)">
            <mat-icon [style.color]="t.color">{{ t.icon }}</mat-icon>{{ t.label }}<span class="cf__n">{{ t.count }}</span>
          </button>
        }
      </div>

      <div class="cf__body">
        <nav class="cf__list" aria-label="Arquivos do card">
          <div class="cf__filters">
            <label class="cf__field" matTooltip="Mostrar só os arquivos de um item de trabalho" matTooltipShowDelay="500">
              <mat-icon>filter_alt</mat-icon>
              <select class="cf__select" aria-label="Filtrar por item de trabalho" (change)="onItem($any($event.target).value)">
                <option value="all" [selected]="selected() === undefined">Todos os itens ({{ allFiles().length }})</option>
                @for (o of itemOptions(); track o.number) {
                  <option [value]="o.number" [selected]="selected() === o.number">{{ o.label }} ({{ o.count }})</option>
                }
              </select>
            </label>
            <label class="cf__field cf__field--search">
              <mat-icon>search</mat-icon>
              <input class="cf__input" type="search" placeholder="Buscar pelo nome" aria-label="Buscar arquivo pelo nome"
                     [value]="query()" (input)="query.set($any($event.target).value)" />
            </label>
          </div>

          @if (store().unavailable()) {
            <div class="cf__empty"><mat-icon>info_outline</mat-icon>Os arquivos do card ainda não estão disponíveis neste servidor.</div>
          } @else if (store().error(); as e) {
            <div class="cf__empty cf__empty--err"><mat-icon>error_outline</mat-icon>{{ e }}
              <button type="button" class="cf__link" (click)="store().load()">Tentar de novo</button></div>
          }

          @for (f of visible(); track key(f)) {
            <button type="button" class="cfi" [class.cfi--on]="current() && key(current()!) === key(f)" (click)="select(f)"
                    [attr.aria-current]="current() && key(current()!) === key(f) ? 'true' : null">
              <mat-icon class="cfi__icon" [style.color]="look(f).color" aria-hidden="true">{{ icon(f) }}</mat-icon>
              <span class="cfi__text">
                <span class="cfi__name" [title]="f.name">{{ f.name }}</span>
                <span class="cfi__meta">
                  <span>{{ look(f).label }}</span>
                  @if (meta(f); as m) { <span>{{ m }}</span> }
                </span>
                <span class="cfi__where">
                  <mat-icon>{{ whereIcon(f) }}</mat-icon>{{ whereOf(f) }}
                  @if (chip(f); as c) { <span class="cfi__chip" [matTooltip]="c.tooltip">{{ c.label }}</span> }
                </span>
              </span>
            </button>
          } @empty {
            @if (!store().unavailable() && !store().error()) {
              <div class="cf__empty">
                @if (!store().loaded()) { <mat-icon class="cf__spin">progress_activity</mat-icon>Buscando os arquivos do card… }
                @else if (!allFiles().length) { Nenhum arquivo neste card ainda — análises, chamados, scripts, dados e anexos aparecem aqui assim que são gerados. }
                @else { Nenhum arquivo com esse filtro. <button type="button" class="cf__link" (click)="clearFilters()">Limpar filtros</button> }
              </div>
            }
          }
        </nav>

        <section class="cf__detail" aria-live="polite">
          @if (current(); as f) {
            @if (narrow()) {
              <button type="button" class="cf__back" (click)="back()"><mat-icon>arrow_back</mat-icon>Voltar para a lista</button>
            }
            <div class="cfd__head">
              <mat-icon class="cfd__icon" [style.color]="look(f).color">{{ icon(f) }}</mat-icon>
              <div class="cfd__titles">
                <h2 class="cfd__title">{{ f.name }}</h2>
                <div class="cfd__meta">
                  <span class="cfd__fact">{{ look(f).label }}</span>
                  @if (meta(f, true); as m) { <span class="cfd__fact">{{ m }}</span> }
                  <span class="cfd__fact cfd__where"><mat-icon>{{ whereIcon(f) }}</mat-icon>{{ whereOf(f) }}</span>
                  @if (f.createdBy) { <span class="cfd__fact">por {{ f.createdBy }}</span> }
                </div>
              </div>
            </div>
            <div class="cfd__toolbar" role="toolbar" aria-label="Ações do arquivo">
              @if (f.kind === 'ticket' && isText(f)) {
                <button mat-flat-button color="primary" type="button" (click)="copy(f, true)" [disabled]="busy() === key(f)">
                  <mat-icon>{{ copied() === key(f) ? 'check' : 'confirmation_number' }}</mat-icon>Copiar chamado
                </button>
              }
              @if (isText(f) && f.kind !== 'ticket') {
                <button mat-stroked-button type="button" (click)="copy(f, false)" [disabled]="busy() === key(f)">
                  <mat-icon>{{ copied() === key(f) ? 'check' : 'content_copy' }}</mat-icon>Copiar texto
                </button>
              }
              <button mat-stroked-button type="button" (click)="download(f)" [disabled]="busy() === key(f)"><mat-icon>download</mat-icon>Baixar</button>
              <span class="cf__spacer"></span>
            </div>
            <div class="cfd__content">
              @switch (view().status) {
                @case ('loading') { <div class="cf__state" role="status"><mat-icon class="cf__spin">progress_activity</mat-icon> Carregando o arquivo…</div> }
                @case ('error') {
                  <div class="cf__state cf__state--err" role="alert"><mat-icon>error_outline</mat-icon> Não foi possível carregar o arquivo.
                    <button mat-stroked-button type="button" (click)="reload()">Tentar de novo</button></div>
                }
                @case ('none') {
                  <div class="cf__state"><mat-icon>draft</mat-icon>Este tipo de arquivo não tem visualização aqui.
                    <button mat-stroked-button type="button" (click)="download(f)"><mat-icon>download</mat-icon>Baixar {{ f.name }}</button></div>
                }
                @default {
                  <app-file-viewer class="cfd__viewer" [name]="f.name" [contentType]="f.contentType" [kind]="f.kind"
                                   [blob]="view().blob ?? null" [card]="card()" />
                }
              }
            </div>
          } @else {
            <div class="cf__state"><mat-icon>touch_app</mat-icon> Escolha um arquivo.</div>
          }
        </section>
      </div>
    </div>
  `,
  styleUrl: './card-files.component.css'
})
export class CardFilesComponent {
  readonly store = input.required<CardFilesStore>();
  readonly card = input<string | null>(null);
  /** Itens do card (os que têm arquivos viram opção do filtro; os que têm plano ganham o "plano completo"). */
  readonly items = input<WorkItem[]>([]);
  /** Tipo do card: em User Story o plano completo se chama "Plano de implementação completo". */
  readonly cardType = input<string | null>(null);
  /** Filtro por item: `undefined` = todos; número = só os arquivos desse item (0 = sem item). */
  readonly selected = model<number | undefined>(undefined);

  private api = inject(WorkItemsService);
  private snack = inject(MatSnackBar);
  private clipboard = inject(CliipboardService);
  private documents = inject(PlanDocumentService);

  readonly kindTab = signal<KindTab>('all');
  readonly query = signal('');
  private readonly pickedKey = signal<string | null>(null);
  readonly narrow = signal(window.matchMedia?.(NARROW).matches ?? false);
  readonly showDetail = signal(false);
  readonly busy = signal<string | null>(null);
  readonly copied = signal<string | null>(null);
  private readonly cache = new Map<string, FileView>();
  private seq = 0;
  readonly view = signal<FileView>({ status: 'loading' });

  readonly chip = fileSourceChip;
  readonly key = (f: WorkItemFile) => `${f.source ?? 'item'}:${f.id}`;
  readonly look = (f: WorkItemFile) => fileKindLook(f.kind);
  readonly icon = fileIcon;
  readonly isText = isTextFile;

  /** Os do servidor + o plano completo de cada item com plano (primeiro na lista, montado na hora). */
  readonly allFiles = computed(() => [...planDocumentFiles(this.items(), this.cardType() === 'user-story'), ...this.store().files()]);

  /** Arquivos do filtro de item (antes das abas e da busca) — as abas contam sobre ele. */
  private readonly ofItem = computed(() => filesOfItem(this.allFiles(), this.selected()));

  readonly tabs = computed(() => {
    const files = this.ofItem();
    const counts = new Map<string, number>();
    for (const f of files) counts.set(normalizeFileKind(f.kind), (counts.get(normalizeFileKind(f.kind)) ?? 0) + 1);
    const out = [{ id: 'all' as KindTab, label: 'Todos', icon: 'folder_copy', color: '', count: files.length }];
    // Textos, Análises, Chamados, Scripts, Dados, Anexos — só as abas que têm arquivo (e a que está aberta).
    const order: WorkItemFileKind[] = ['text', 'analysis', 'ticket', 'script', 'data', 'attachment'];
    for (const kind of order) {
      const count = counts.get(kind) ?? 0;
      if (!count && this.kindTab() !== kind) continue;
      const look = FILE_KIND_LOOKS.find((k) => k.kind === kind)!;
      out.push({ id: kind, label: look.group, icon: look.icon, color: look.color, count });
    }
    return out;
  });

  readonly visible = computed(() => {
    const tab = this.kindTab();
    const q = this.query().trim().toLowerCase();
    return this.ofItem().filter((f) => (tab === 'all' || normalizeFileKind(f.kind) === tab) && (!q || f.name.toLowerCase().includes(q)));
  });

  /** Arquivo aberto: o escolhido; no desktop, sem escolha vale o primeiro da lista (no celular, só depois de tocar). */
  readonly current = computed<WorkItemFile | null>(() => {
    const list = this.visible();
    const picked = this.pickedKey();
    const hit = picked ? list.find((f) => this.key(f) === picked) : null;
    if (hit) return hit;
    return this.narrow() ? null : list[0] ?? null;
  });

  readonly itemOptions = computed(() => {
    const counts = countFilesByItem(this.allFiles());
    const selected = this.selected();
    const out: { number: number; label: string; count: number }[] = [];
    for (const item of [...this.items()].sort((a, b) => b.number - a.number)) {
      const count = counts.get(item.number) ?? 0;
      if (!count && selected !== item.number) continue;
      out.push({ number: item.number, label: `${formatWorkNumber(item.number)} ${item.title}`, count });
    }
    const orphans = counts.get(0) ?? 0;
    if (orphans || selected === 0) out.push({ number: 0, label: 'Sem item (versões antigas do plano)', count: orphans });
    const conversation = counts.get(CASE_FILES_KEY) ?? 0;
    if (conversation || selected === CASE_FILES_KEY) out.push({ number: CASE_FILES_KEY, label: 'Conversa do especialista', count: conversation });
    return out;
  });

  private readonly mq = window.matchMedia?.(NARROW);
  private readonly onNarrow = (e: MediaQueryListEvent) => this.narrow.set(e.matches);

  constructor() {
    this.mq?.addEventListener('change', this.onNarrow);
    inject(DestroyRef).onDestroy(() => this.mq?.removeEventListener('change', this.onNarrow));

    // Carrega o conteúdo do arquivo aberto (com cache por versão do arquivo — recarga da lista não pisca a leitura).
    effect(() => {
      const f = this.current();
      untracked(() => this.load(f, false));
    });
    // Filtro por item que muda (ex.: "Arquivos do item" da Execução): volta para "Todos" as abas que ficaram sem arquivo.
    effect(() => {
      const tab = this.kindTab();
      if (tab === 'all') return;
      const has = this.ofItem().some((f) => normalizeFileKind(f.kind) === tab);
      if (!has && this.store().loaded()) untracked(() => this.kindTab.set('all'));
    });
  }

  select(f: WorkItemFile): void {
    this.pickedKey.set(this.key(f));
    this.showDetail.set(true);
  }

  back(): void {
    this.showDetail.set(false);
  }

  onItem(value: string): void {
    this.selected.set(value === 'all' ? undefined : Number(value));
    this.pickedKey.set(null);
    this.showDetail.set(false);
  }

  clearFilters(): void {
    this.selected.set(undefined);
    this.kindTab.set('all');
    this.query.set('');
  }

  whereIcon(f: WorkItemFile): string {
    return f.source === 'case' ? 'psychology' : f.workItemNumber ? 'checklist' : 'history';
  }

  whereOf(f: WorkItemFile): string {
    if (f.source === 'case') return 'Conversa do especialista';
    const n = Number(f.workItemNumber ?? 0);
    if (!n) return 'Versão antiga do plano';
    const item = this.items().find((i) => i.number === n);
    return item ? `${formatWorkNumber(n)} ${item.title}` : formatWorkNumber(n);
  }

  meta(f: WorkItemFile, full = false): string {
    return fileMeta({ ...f, taskNumber: full ? f.taskNumber : null }, (n) => formatWorkNumber(n), false);
  }

  private numberOf(f: WorkItemFile): number {
    return Number(f.workItemNumber ?? 0);
  }

  /** Conteúdo do arquivo: o do servidor ou, no plano completo, o documento montado do plano do item. */
  private content(f: WorkItemFile): Observable<Blob> {
    if (f.source === 'document' && f.planId) {
      return from(this.documents.buildById(f.planId, this.cardType() === 'user-story'))
        .pipe(map((md) => new Blob([md], { type: 'text/markdown' })));
    }
    return this.api.fileContent(this.numberOf(f), f);
  }

  private cacheKey(f: WorkItemFile): string {
    return `${this.key(f)}|${f.updatedAt ?? f.createdAt ?? ''}|${f.size ?? ''}`;
  }

  reload(): void {
    const f = this.current();
    if (f) this.load(f, true);
  }

  private load(f: WorkItemFile | null, force: boolean): void {
    const s = ++this.seq;
    if (!f) { this.view.set({ status: 'ready' }); return; }
    if (filePreviewKind(f) === 'none') { this.view.set({ status: 'none' }); return; }
    const ck = this.cacheKey(f);
    const cached = force ? undefined : this.cache.get(ck);
    if (cached) { this.view.set(cached); return; }
    this.view.set({ status: 'loading' });
    // A prévia (SQL com destaque, markdown, JSON, imagem com zoom) é a do `app-file-viewer` — a mesma de "Arquivos e textos".
    firstValueFrom(this.content(f)).then((blob) => {
      const view: FileView = { status: 'ready', blob };
      this.cache.set(ck, view);
      if (s === this.seq) this.view.set(view);
    }, () => { if (s === this.seq) this.view.set({ status: 'error' }); });
  }

  async download(f: WorkItemFile): Promise<void> {
    this.busy.set(this.key(f));
    try {
      saveBlob(await firstValueFrom(this.content(f)), f.name);
    } catch (e) {
      this.snack.open((e as Error)?.message || 'Não foi possível baixar o arquivo.', 'Fechar', { duration: 6000 });
    } finally {
      this.busy.set(null);
    }
  }

  /** Copia o texto (chamado/markdown vai também formatado — cola bonito no sistema de chamados). */
  async copy(f: WorkItemFile, rich: boolean): Promise<void> {
    const id = this.key(f);
    this.busy.set(id);
    try {
      const text = await (await firstValueFrom(this.content(f))).text();
      if (!text.trim()) { this.snack.open('O arquivo está vazio.', 'Ok', { duration: 3000 }); return; }
      if (rich && filePreviewKind(f) === 'markdown') await this.clipboard.copyRichToClipboard(renderMarkdown(text, { codeRefs: false }), text);
      else this.clipboard.copyFullDescriptionToClipboard(text);
      this.copied.set(id);
      setTimeout(() => { if (this.copied() === id) this.copied.set(null); }, 1600);
    } catch (e) {
      this.snack.open((e as Error)?.message || 'Não foi possível copiar o arquivo.', 'Fechar', { duration: 6000 });
    } finally {
      this.busy.set(null);
    }
  }
}
