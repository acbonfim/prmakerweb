import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, firstValueFrom, map, of, shareReplay } from 'rxjs';
import { CardRulesSummary, CardStates, WorkItemsService } from '../../services/work-items.service';
import { GdsService } from '../../services/gds.service';
import { UserIntegrationService } from '../../services/user-integration.service';
import { parseActiveRepositories } from '../workbench-prs/workbench-prs.logic';
import { WorkItemCatalog } from '../work-items/work-item.model';
import { githubBase } from './param-input';

/** Plugin "Pull Request" (ActiveRepositories) — a mesma reserva da tela de PR. */
const PULLREQUEST_PLUGIN_ID = 9;
/** Estados do card mudam pouco; um minuto evita refazer a chamada a cada sub-tarefa. */
const STATES_TTL_MS = 60_000;

export interface RepoChoice {
  label: string;
  value: string;
  defaultBranch?: string | null;
}

/**
 * 0085 rodada 3: fontes dos controles do editor de itens, com cache por sessão — repositórios (`GitHub/repositories`,
 * reserva no `ActiveRepositories` do plugin de PR), regras do card (`Skills/rules`, só quando o catálogo não traz os
 * destinos do fluxo), estados do card no DevOps e a URL base do GitHub para os links.
 */
@Injectable({ providedIn: 'root' })
export class WorkItemPickerSource {
  private api = inject(WorkItemsService);
  private gds = inject(GdsService);
  private integrations = inject(UserIntegrationService);

  readonly repositories = signal<RepoChoice[]>([]);
  readonly repositoriesLoading = signal(false);
  readonly repositoriesError = signal<string | null>(null);
  private reposLoad: Promise<RepoChoice[]> | null = null;

  private rulesCache = new Map<string, Observable<CardRulesSummary | null>>();
  private statesCache = new Map<string, { at: number; obs: Observable<CardStates> }>();

  /** URL base do GitHub (`https://github.com/<owner>`), quando conhecida. */
  readonly githubUrl = signal<string | null>(null);
  private ownerLoad: Promise<void> | null = null;

  /** Carrega os repositórios uma vez (falha/vazio → os ativos do plugin de PR). */
  loadRepositories(force = false): Promise<RepoChoice[]> {
    if (force) this.reposLoad = null;
    this.reposLoad ??= (async () => {
      this.repositoriesLoading.set(true);
      this.repositoriesError.set(null);
      let list: RepoChoice[] = [];
      try {
        const repos = await firstValueFrom(this.api.repositories());
        list = (repos ?? []).filter((r) => r?.id).map((r) => ({ label: r.label || r.id, value: r.id, defaultBranch: r.defaultBranch ?? null }));
      } catch (e: any) {
        this.repositoriesError.set(e?.message ?? 'Não foi possível listar os repositórios.');
      }
      if (!list.length) {
        try {
          const res: any = await firstValueFrom(this.gds.getAllById(PULLREQUEST_PLUGIN_ID));
          list = parseActiveRepositories(res?.configurations?.ActiveRepositories);
        } catch { /* sem reserva: o campo aceita texto livre */ }
      }
      this.repositories.set(list);
      this.repositoriesLoading.set(false);
      if (!list.length) this.reposLoad = null; // tenta de novo na próxima abertura
      return list;
    })();
    return this.reposLoad;
  }

  /** Regras do card (branch principal, branch por destino, destinos do fluxo); erro → null. */
  rules(card: string): Observable<CardRulesSummary | null> {
    let obs = this.rulesCache.get(card);
    if (!obs) {
      obs = this.api.rules(card).pipe(catchError(() => of(null)), shareReplay(1));
      this.rulesCache.set(card, obs);
    }
    return obs;
  }

  /** Estados do card no DevOps (cache curto). */
  states(card: string): Observable<CardStates> {
    const hit = this.statesCache.get(card);
    if (hit && Date.now() - hit.at < STATES_TTL_MS) return hit.obs;
    const obs = this.api.cardStates(card).pipe(
      catchError((e) => { this.statesCache.delete(card); throw e; }),
      shareReplay(1)
    );
    this.statesCache.set(card, { at: Date.now(), obs });
    return obs;
  }

  /** Descobre a URL base do GitHub: catálogo (`githubUrl`) ou o Owner da integração do GitHub do usuário. */
  ensureGithubUrl(catalog?: WorkItemCatalog | null): void {
    const fromCatalog = githubBase(catalog?.githubUrl);
    if (fromCatalog) { this.githubUrl.set(fromCatalog); return; }
    if (this.githubUrl()) return;
    this.ownerLoad ??= (async () => {
      try {
        const list = this.integrations.integrations().length ? this.integrations.integrations() : await this.integrations.loadIntegrations();
        const gh = list.find((i) => i.description === 'Github Configurations');
        const owner = gh?.fields.find((f) => f.key.toLowerCase() === 'owner' && !f.sensitive)?.value;
        this.githubUrl.set(githubBase(null, owner));
      } catch {
        this.ownerLoad = null;
      }
    })();
  }

  /** Destinos do fluxo: do catálogo, se vierem; senão das regras do card. */
  flowTargets(catalog: WorkItemCatalog | null | undefined, card: string | null | undefined): Observable<string | string[] | null> {
    if (catalog?.flowTargets != null) return of(catalog.flowTargets);
    if (!card) return of(null);
    return this.rules(card).pipe(map((r) => r?.flowTargets ?? null));
  }
}
