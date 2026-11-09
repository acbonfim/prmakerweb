import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { WorkItemsService } from '../../services/work-items.service';
import { FILE_VIEWER_DIALOG, FileViewerDialogComponent, FileViewerDialogData } from '../file-viewer/file-viewer-dialog.component';
import { formatWorkNumber } from './work-item.model';
import { WorkItemFile, evidenceCaption, evidenceImages } from './work-item-files';
import { FilesSource } from './card-files.store';

type Thumb = { state: 'loading' } | { state: 'ok'; url: string } | { state: 'error' };

/**
 * 0092: **Evidências** da sub-tarefa — os prints gravados pela validação em ambiente (tipo `evidence`, ou qualquer
 * imagem ligada à sub-tarefa), em grade, na ordem do nome. Cada miniatura vem do conteúdo autenticado do arquivo (blob)
 * e abre no visualizador de arquivos. Sem imagens, não mostra nada.
 */
@Component({
  selector: 'app-work-evidence-gallery',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (images().length) {
      <section class="weg" aria-label="Evidências da validação">
        <h5 class="weg__title"><mat-icon>photo_library</mat-icon>Evidências<small>{{ images().length }}</small></h5>
        <ul class="weg__grid">
          @for (f of images(); track f.id) {
            <li>
              <button type="button" class="weg__shot" (click)="open(f)" [matTooltip]="f.name" [attr.aria-label]="'Abrir ' + caption(f)">
                @switch (thumb(f).state) {
                  @case ('ok') { <img [src]="url(f)" [alt]="caption(f)" loading="lazy"> }
                  @case ('error') { <span class="weg__ph"><mat-icon>broken_image</mat-icon></span> }
                  @default { <span class="weg__ph weg__ph--load"><mat-icon>image</mat-icon></span> }
                }
                <span class="weg__cap">{{ caption(f) }}</span>
              </button>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [`
.weg { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.weg__title { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; font-weight: 600; color: var(--cc-text-1, inherit); }
.weg__title mat-icon { font-size: 17px; width: 17px; height: 17px; color: #56d364; }
.weg__title small { font-weight: 400; color: var(--cc-text-3); }
.weg__grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
.weg__shot { display: flex; flex-direction: column; width: 100%; padding: 0; overflow: hidden; cursor: zoom-in; font: inherit; text-align: left;
  border-radius: 8px; background: var(--cc-surface-2, rgba(255,255,255,.03)); color: inherit;
  border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); }
.weg__shot:hover, .weg__shot:focus-visible { border-color: color-mix(in srgb, var(--mat-sys-primary) 60%, transparent); outline: none; }
.weg__shot img, .weg__ph { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; }
.weg__ph { display: flex; align-items: center; justify-content: center; color: var(--cc-text-3); }
.weg__ph--load mat-icon { opacity: .5; }
.weg__cap { padding: 5px 8px; font-size: 11.5px; color: var(--cc-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`]
})
export class WorkEvidenceGalleryComponent {
  private api = inject(WorkItemsService);
  private dialog = inject(MatDialog);

  readonly store = input.required<FilesSource>();
  readonly taskNumber = input<number | null>(null);
  readonly card = input<string | null>(null);

  readonly images = computed(() => evidenceImages(this.store().files(), this.taskNumber()));
  private readonly thumbs = signal<Record<string, Thumb>>({});
  private readonly urls = new Map<string, string>();
  private destroyed = false;

  constructor() {
    effect(() => {
      const list = this.images();
      untracked(() => list.forEach((f) => this.load(f)));
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.urls.forEach((u) => URL.revokeObjectURL(u));
      this.urls.clear();
    });
  }

  caption(f: WorkItemFile): string {
    return evidenceCaption(f.name);
  }

  thumb(f: WorkItemFile): Thumb {
    return this.thumbs()[this.key(f)] ?? { state: 'loading' };
  }

  url(f: WorkItemFile): string {
    const t = this.thumb(f);
    return t.state === 'ok' ? t.url : '';
  }

  open(f: WorkItemFile): void {
    const data: FileViewerDialogData = {
      name: f.name,
      contentType: f.contentType,
      kind: f.kind,
      subtitle: ['Evidência', f.taskNumber ? `sub-tarefa ${formatWorkNumber(f.taskNumber)}` : ''].filter(Boolean).join(' · '),
      icon: 'image',
      card: this.card(),
      load: () => firstValueFrom(this.api.fileContent(this.numberOf(f), f))
    };
    this.dialog.open(FileViewerDialogComponent, { ...FILE_VIEWER_DIALOG, data });
  }

  private key(f: WorkItemFile): string {
    return `${f.source ?? 'item'}:${f.id}`;
  }

  private numberOf(f: WorkItemFile): number {
    return this.store().itemNumber || Number(f.workItemNumber ?? 0);
  }

  private async load(f: WorkItemFile): Promise<void> {
    const key = this.key(f);
    if (this.thumbs()[key]) return;
    this.thumbs.update((m) => ({ ...m, [key]: { state: 'loading' } }));
    try {
      const blob = await firstValueFrom(this.api.fileContent(this.numberOf(f), f));
      if (this.destroyed) return;
      const url = URL.createObjectURL(blob);
      this.urls.set(key, url);
      this.thumbs.update((m) => ({ ...m, [key]: { state: 'ok', url } }));
    } catch {
      this.thumbs.update((m) => ({ ...m, [key]: { state: 'error' } }));
    }
  }
}
