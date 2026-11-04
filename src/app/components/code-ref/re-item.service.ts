import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Armadilha ligada ao item (o que já fez alguém errar). */
export interface ReItemTrap {
  title: string;
  text: string;
  needsReview: boolean;
  cards: string[];
}

/** `GET ReverseEngineering/card/{card}/items/{ref}` (0076) — um item da engenharia reversa. */
export interface ReItem {
  ref: string;
  moduleKey: string;
  moduleName?: string | null;
  docType: string;
  itemId: string;
  kind: string;
  /** "Caso de uso", "Regra de negócio"… */
  kindLabel: string;
  title: string;
  /** Texto do item (markdown). */
  body: string;
  refs: string[];
  evidence: string[];
  referencedBy: string[];
  sectionVersion?: number | string | null;
  removed: boolean;
  traps: ReItemTrap[];
}

export type ReItemResult =
  | { status: 'ok'; item: ReItem }
  /** 403: a engenharia reversa é só de administrador. */
  | { status: 'forbidden' }
  /** 404: o item não existe (ou o módulo não tem). */
  | { status: 'missing' }
  /** 400: o id existe em mais de um módulo — a mensagem diz quais. */
  | { status: 'ambiguous'; message: string };

/**
 * Itens da engenharia reversa citados nos textos do card (0076): o popover de `UC-121` /
 * `revamp-kaizen#RN-012`. Cache por card + ref (as respostas definitivas — ok, 403, 404, 400); erro de
 * rede propaga para o popover mostrar "Tentar de novo".
 */
@Injectable({ providedIn: 'root' })
export class ReItemService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}ReverseEngineering`;
  private cache = new Map<string, Promise<ReItemResult>>();

  get(card: string | number, ref: string): Promise<ReItemResult> {
    const c = `${card ?? ''}`.trim();
    const r = ref.trim();
    const key = `${c}|${r}`;
    let p = this.cache.get(key);
    if (!p) {
      p = firstValueFrom(this.http.get<ReItem>(
        `${this.apiUrl}/card/${encodeURIComponent(c)}/items/${encodeURIComponent(r)}`))
        .then((item): ReItemResult => (item ? { status: 'ok', item: normalize(item) } : { status: 'missing' }))
        .catch((err: HttpErrorResponse): ReItemResult => {
          if (err?.status === 403) return { status: 'forbidden' };
          if (err?.status === 404) return { status: 'missing' };
          if (err?.status === 400) return { status: 'ambiguous', message: errorText(err) };
          if (this.cache.get(key) === p) this.cache.delete(key);
          throw err;
        });
      this.cache.set(key, p);
    }
    return p;
  }

  /** Esquece o cache (ex.: a engenharia reversa foi republicada). */
  clear(): void {
    this.cache.clear();
  }
}

function normalize(item: ReItem): ReItem {
  return {
    ...item,
    body: item.body ?? '',
    refs: item.refs ?? [],
    evidence: item.evidence ?? [],
    referencedBy: item.referencedBy ?? [],
    traps: (item.traps ?? []).map(t => ({ ...t, cards: t.cards ?? [] })),
    removed: !!item.removed,
  };
}

function errorText(err: HttpErrorResponse): string {
  const e = err?.error;
  if (typeof e === 'string' && e.trim()) return e.trim();
  const msg = e?.error ?? e?.message ?? e?.title;
  return typeof msg === 'string' && msg.trim() ? msg.trim() : 'O item existe em mais de um módulo — use modulo#ID.';
}
