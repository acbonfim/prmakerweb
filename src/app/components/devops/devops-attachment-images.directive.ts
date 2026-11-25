import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DevOpsService } from '../../services/devops.service';
import { attachmentIdFromUrl, attachmentNameFromUrl } from './devops.model';

/** Imagens já baixadas (por GUID do anexo) — a mesma imagem aparece no campo, na discussion e na aba Anexos. */
const CACHE = new Map<string, Promise<string>>();
const CACHE_MAX = 200;

/**
 * 0099 ajustes 3: as imagens coladas no card (`<img src=".../_apis/wit/attachments/{guid}">`) exigem o token do DevOps — o
 * navegador não abre direto. Esta diretiva observa o HTML de dentro (campos, discussion) e troca cada uma pela cópia
 * baixada pelo PRMake (`GET DevOps/workitems/{card}/attachments/{guid}`); clicar abre a imagem numa aba nova.
 */
@Directive({ selector: '[dvAttachmentImages]', standalone: true })
export class DevOpsAttachmentImagesDirective {
  private api = inject(DevOpsService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

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
      img.classList.add('dv-img--loading');
      img.style.cursor = 'zoom-in';
      void this.url(card, id, attachmentNameFromUrl(src)).then((url) => {
        img.classList.remove('dv-img--loading');
        img.src = url;
        img.dataset['dvSrc'] = url;
        img.onclick = () => window.open(url, '_blank', 'noopener');
      }).catch(() => {
        img.classList.remove('dv-img--loading');
        img.classList.add('dv-img--error');
        img.alt = img.alt || 'Imagem do DevOps indisponível';
      });
    }
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
