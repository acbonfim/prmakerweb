import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { DevOpsService } from '../../services/devops.service';
import { attachmentIdFromUrl, attachmentNameFromUrl } from './devops.model';

/** Imagens já baixadas (por GUID do anexo) — a mesma imagem aparece no campo, na discussion e na aba Anexos. */
const CACHE = new Map<string, Promise<string>>();
const CACHE_MAX = 200;

/**
 * 0099 ajustes 3: as imagens coladas no card (`<img src=".../_apis/wit/attachments/{guid}">`) exigem o token do DevOps — o
 * navegador não abre direto. Esta diretiva observa o HTML de dentro (campos, discussion) e troca cada uma pela cópia
 * baixada pelo PRMake (`GET DevOps/workitems/{card}/attachments/{guid}`). Clicar abre o visualizador com as outras imagens da
 * mesma aba ao lado (← →).
 */
@Directive({ selector: '[dvAttachmentImages]', standalone: true })
export class DevOpsAttachmentImagesDirective {
  private api = inject(DevOpsService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private dialog = inject(MatDialog);

  /** Card dono dos anexos. */
  readonly card = input<string | number | null>(null, { alias: 'dvAttachmentImages' });

  constructor() {
    const observer = new MutationObserver(() => this.scan());
    observer.observe(this.host.nativeElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    queueMicrotask(() => this.scan());
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  private scan(): void {
    const card = this.card();
    if (card == null || `${card}` === '') return;
    for (const img of Array.from(this.host.nativeElement.querySelectorAll('img'))) {
      const src = img.getAttribute('src') ?? '';
      if (img.dataset['dvSrc'] === src || src.startsWith('blob:')) continue;
      const id = attachmentIdFromUrl(src);
      if (!id) continue;
      img.dataset['dvSrc'] = src;
      img.dataset['dvOrig'] = src;
      img.classList.add('dv-img--loading');
      img.style.cursor = 'zoom-in';
      void this.url(card, id, attachmentNameFromUrl(src)).then((url) => {
        img.classList.remove('dv-img--loading');
        img.src = url;
        img.dataset['dvSrc'] = url;
        img.onclick = (e) => { e.preventDefault(); void this.open(img); };
      }).catch(() => {
        img.classList.remove('dv-img--loading');
        img.classList.add('dv-img--error');
        img.alt = img.alt || 'Imagem do DevOps indisponível';
      });
    }
  }

  /** Visualizador com as imagens já carregadas da mesma aba (ou do bloco todo), na ordem em que aparecem. */
  private async open(img: HTMLImageElement): Promise<void> {
    const scope = img.closest<HTMLElement>('[role=tabpanel]') ?? this.host.nativeElement;
    const shown = Array.from(scope.querySelectorAll('img')).filter((i) => i.src.startsWith('blob:'));
    const items = shown.map((i) => ({ url: i.src, name: attachmentNameFromUrl(i.getAttribute('data-dv-orig')), alt: i.alt || null }));
    const index = Math.max(0, shown.indexOf(img));
    const { MdImageViewerComponent } = await import('../code-ref/md-image-viewer.component');
    this.dialog.open(MdImageViewerComponent, {
      data: { ...(items[index] ?? { url: img.src, name: 'imagem' }), items, index },
      width: '96vw', maxWidth: '96vw', height: '92vh', panelClass: 'md-image-dialog', autoFocus: false,
    });
  }

  private url(card: string | number, id: string, name: string): Promise<string> {
    let hit = CACHE.get(id);
    if (!hit) {
      hit = firstValueFrom(this.api.attachmentBlob(card, id, name)).then((b) => URL.createObjectURL(b));
      hit.catch(() => CACHE.delete(id));
      if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
      CACHE.set(id, hit);
    }
    return hit;
  }
}
