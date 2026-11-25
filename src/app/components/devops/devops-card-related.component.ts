import { Component, ViewEncapsulation, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DevOpsService } from '../../services/devops.service';
import { CardRelation, F, typeIcon } from './devops.model';

/** Nome da relação como o DevOps mostra (em pt-BR). */
const REL_LABEL: Record<string, string> = {
  'System.LinkTypes.Hierarchy-Reverse': 'Pai',
  'System.LinkTypes.Hierarchy-Forward': 'Filhos',
  'System.LinkTypes.Related': 'Relacionados',
  'System.LinkTypes.Dependency-Forward': 'Sucessores',
  'System.LinkTypes.Dependency-Reverse': 'Predecessores',
  'System.LinkTypes.Duplicate-Forward': 'Duplicados',
  'System.LinkTypes.Duplicate-Reverse': 'Duplicado de',
  'Microsoft.VSTS.Common.TestedBy-Forward': 'Testado por',
  'Microsoft.VSTS.Common.TestedBy-Reverse': 'Testa',
  ArtifactLink: 'Desenvolvimento (PR, commit, branch)',
  Hyperlink: 'Links',
};
const REL_ORDER = Object.keys(REL_LABEL);

export interface RelatedGroup {
  rel: string;
  label: string;
  items: { id: number | null; url: string; name: string | null }[];
}

/** Relações do card agrupadas (anexos ficam de fora — têm aba própria), na ordem do DevOps. */
export function relatedGroups(relations: CardRelation[] | null | undefined): RelatedGroup[] {
  const groups = new Map<string, RelatedGroup>();
  for (const r of relations ?? []) {
    if (r.rel === 'AttachedFile') continue;
    const g = groups.get(r.rel) ?? { rel: r.rel, label: REL_LABEL[r.rel] ?? r.rel.replace(/^.*\./, ''), items: [] };
    g.items.push({ id: r.id ?? null, url: r.url, name: r.name ?? null });
    groups.set(r.rel, g);
  }
  const rank = (rel: string) => (REL_ORDER.indexOf(rel) < 0 ? 99 : REL_ORDER.indexOf(rel));
  return [...groups.values()].sort((a, b) => rank(a.rel) - rank(b.rel));
}

/** Texto de um link de desenvolvimento (`vstfs:///Git/PullRequestId/...` → "Pull request 123"). */
export function artifactLabel(url: string, name: string | null): string {
  const m = /vstfs:\/\/\/Git\/(PullRequestId|Commit|Ref)\/(.+)$/i.exec(url);
  if (!m) return name || url;
  const tail = decodeURIComponent(m[2]).split('/').pop() ?? '';
  if (/pullrequest/i.test(m[1])) return `Pull request ${tail}`;
  if (/commit/i.test(m[1])) return `Commit ${tail.slice(0, 8)}`;
  return `Branch ${tail.replace(/^GB/, '')}`;
}

/**
 * 0099 ajustes 3: aba "Relacionados" do modal — pai, filhos, relacionados, dependências e links de desenvolvimento, com
 * título/estado dos cards (uma consulta). Clicar abre o card no próprio modal.
 */
@Component({
  selector: 'app-devops-card-related',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="dvr">
      @if (!groups().length) { <div class="dv-hint">Nenhum card ou link relacionado.</div> }
      @for (g of groups(); track g.rel) {
        <section class="dvr__group">
          <h4>{{ g.label }} <span class="dvr__n">{{ g.items.length }}</span></h4>
          <ul>
            @for (it of g.items; track it.url) {
              <li>
                @if (it.id; as id) {
                  @let info = titles()[id];
                  <button type="button" class="dvr__card" (click)="openCard.emit(id)" [matTooltip]="'Abrir o card ' + id + ' aqui'">
                    <mat-icon>{{ icon(info?.type) }}</mat-icon>
                    <span class="dvr__id">{{ id }}</span>
                    <span class="dvr__title">{{ info?.title || (loading() ? 'Carregando…' : '') }}</span>
                    @if (info?.state) { <span class="dvr__state">{{ info!.state }}</span> }
                  </button>
                } @else {
                  <span class="dvr__link"><mat-icon>{{ g.rel === 'ArtifactLink' ? 'merge' : 'link' }}</mat-icon>
                    @if (g.rel === 'Hyperlink') { <a [href]="it.url" target="_blank" rel="noopener">{{ it.name || it.url }}</a> }
                    @else { <span>{{ artifact(it.url, it.name) }}</span> }
                  </span>
                }
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
  styles: [`
    .dvr { display: flex; flex-direction: column; gap: 14px; max-width: 980px; }
    .dvr__group h4 { margin: 0 0 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--cc-text-2); }
    .dvr__n { font-weight: 400; color: var(--cc-text-3); margin-left: 4px; }
    .dvr ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .dvr__card { width: 100%; display: flex; align-items: center; gap: 8px; text-align: left; border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08));
      background: color-mix(in srgb, var(--surface-2, #2e343f) 70%, transparent); color: inherit; font: inherit; font-size: 13px; border-radius: 8px; padding: 6px 10px; cursor: pointer; min-width: 0; }
    .dvr__card:hover { border-color: color-mix(in srgb, var(--mat-sys-primary) 60%, transparent); }
    .dvr__card mat-icon, .dvr__link mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--cc-text-2); flex: none; }
    .dvr__id { font-weight: 600; flex: none; }
    .dvr__title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dvr__state { flex: none; font-size: 11.5px; color: var(--cc-text-3); }
    .dvr__link { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 2px; min-width: 0; overflow-wrap: anywhere; }
  `]
})
export class DevOpsCardRelatedComponent {
  private api = inject(DevOpsService);

  readonly relations = input<CardRelation[]>([]);
  readonly openCard = output<number>();

  readonly groups = computed(() => relatedGroups(this.relations()));
  readonly titles = signal<Record<number, { title: string; state: string; type: string }>>({});
  readonly loading = signal(false);

  constructor() {
    effect(() => {
      const ids = [...new Set(this.groups().flatMap((g) => g.items.map((i) => i.id)).filter((id): id is number => !!id))];
      untracked(() => this.loadTitles(ids));
    });
  }

  private loadTitles(ids: number[]): void {
    const missing = ids.filter((id) => !this.titles()[id]).slice(0, 200);
    if (!missing.length) return;
    this.loading.set(true);
    this.api.query({
      wiql: `SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (${missing.join(',')})`,
      fields: [F.title, F.state, F.workItemType], top: missing.length,
    }).subscribe({
      next: (r) => {
        const map = { ...this.titles() };
        for (const i of r.items) map[i.id] = { title: `${i.fields[F.title] ?? ''}`, state: `${i.fields[F.state] ?? ''}`, type: `${i.fields[F.workItemType] ?? ''}` };
        this.titles.set(map);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  icon(type: string | undefined): string {
    return typeIcon(null, type);
  }

  artifact(url: string, name: string | null): string {
    return artifactLabel(url, name);
  }
}
