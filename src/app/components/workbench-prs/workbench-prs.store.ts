import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Subject, Subscription, firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CardFull } from '../card-details-dialog/card-full.model';
import { TargetBranchOption } from '../target-branch-toggle/target-branch-toggle.component';
import { CardPrStateService } from '../../services/card-pr-state.service';
import { GdsService } from '../../services/gds.service';
import { GithubPullRequest, PullRequestRegister, PullRequestService } from '../../services/pull-request.service';
import { StorageService } from '../../services/storage.service';
import { WsService } from '../../services/ws.service';
import { RepoOption } from '../../interfaces/RepoOption';
import { parseActiveBranches, parseActiveRepositories } from './workbench-prs.logic';

/** Tempo real do card (PullRequestRealTimeEvents no backend) — o mesmo da tela de PR. */
const PULLREQUEST_CARD_EVENT = 'pullRequestCardUpdated';
const pullRequestCardGroup = (card: string) => `pullrequest:${card.trim()}`;
/** Plugin "Pull Request" (ActiveBranchs / ActiveRepositories). */
const PULLREQUEST_PLUGIN_ID = 9;

/** Registro do card com os campos do resumo não técnico (0011), que a API devolve junto. */
export type WorkbenchRegister = PullRequestRegister & {
  summary?: string | null;
  summaryCommentId?: string | number | null;
  summaryUpdatedAt?: string | null;
  summaryPublishedAt?: string | null;
};

/** `GET Skills/rules?card=` (0085) — só o que o "Abrir PR" usa. */
export interface CardBranchRules {
  mainBranch: string;
  branchesByTarget: Record<string, string>;
}

/**
 * Estado dos PRs do card na Bancada (feature 0085). Provido no `WorkbenchPrsComponent` junto com uma instância
 * **própria** do `CardPrStateService` — o modal "Abrir PR", a lista de PRs e os atalhos rápidos (que injetam esse
 * serviço) passam a usar a instância da Bancada, sem tocar no singleton da tela de pull request.
 */
@Injectable()
export class WorkbenchPrsStore implements OnDestroy {
  /** Instância local (providers do componente), não a raiz. */
  readonly pr = inject(CardPrStateService);
  private prService = inject(PullRequestService);
  private gds = inject(GdsService);
  private http = inject(HttpClient);
  private ws = inject(WsService);
  private storage = inject(StorageService);
  private base = environment.apiUrl;

  readonly card = signal<string | null>(null);
  readonly cardType = signal<'bug' | 'user-story'>('bug');

  readonly register = signal<WorkbenchRegister | null>(null);
  /** O registro já foi buscado para o card atual (mesmo que não exista). */
  readonly registerLoaded = signal(false);
  readonly registerLoading = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly prs = this.pr.githubPrs;
  readonly prsLoading = this.pr.githubPrsLoading;

  readonly cardFull = signal<CardFull | null>(null);
  readonly cardLoading = signal(false);
  private cardFullFor: string | null = null;

  readonly targetOptions = signal<TargetBranchOption[]>([]);
  readonly repositoryOptions = signal<RepoOption[]>([]);
  private configLoad: Promise<void> | null = null;

  readonly rules = signal<CardBranchRules | null>(null);
  private rulesFor: string | null = null;

  /** Última escolha do "Abrir PR" nesta Bancada (padrão do próximo). */
  readonly lastTarget = signal<string | null>(null);
  readonly lastRepository = signal<string | null>(null);

  /** Descrição/RC editados no modal e ainda não salvos no registro do card. */
  readonly dirty = computed(() => {
    if (!this.registerLoaded()) return false;
    const saved = this.register();
    return (this.pr.description() ?? '') !== (saved?.description ?? '')
      || (this.pr.rootCause() ?? '') !== (saved?.rootCause ?? '');
  });

  /** Uma ação do DevOps (ou o RC salvo) mudou o card: a Bancada recarrega o cabeçalho/alertas. */
  readonly devopsChanged$ = new Subject<void>();

  private registerLoad: Promise<void> = Promise.resolve();
  private group: string | null = null;
  private listening = false;
  private resyncSub?: Subscription;

  private cachedUserId: string | null = null;

  /** externalId do usuário logado (quem abre o PR no CIME) — lido uma vez (o "access" é decifrado a cada leitura). */
  get userId(): string {
    if (this.cachedUserId === null) {
      try {
        this.cachedUserId = (this.storage.getAccess() as any)?.user?.externalId ?? '';
      } catch {
        this.cachedUserId = '';
      }
    }
    return this.cachedUserId ?? '';
  }

  /** Troca o card da Bancada: zera o estado, entra no grupo de tempo real e busca o registro + PRs. */
  setCard(card: string | null): void {
    const next = card?.trim() || null;
    if (next === this.card()) return;
    this.card.set(next);
    this.register.set(null);
    this.registerLoaded.set(false);
    this.loadError.set(null);
    this.cardFull.set(null);
    this.cardFullFor = null;
    this.rules.set(null);
    this.rulesFor = null;
    this.pr.loadRegister(next, null);
    this.switchGroup(next);
    this.registerLoad = next ? this.loadRegister() : Promise.resolve();
  }

  /** Espera a carga do registro do card atual (para não sobrescrever um status mais novo com o persistido). */
  ready(): Promise<void> {
    return this.registerLoad;
  }

  /** `GET PullRequest/GetByCardNumber` — registro do card com os PRs do GitHub (status persistido). */
  async loadRegister(): Promise<void> {
    const card = this.card();
    if (!card) return;
    this.registerLoading.set(true);
    this.pr.githubPrsLoading.set(true);
    try {
      const res = (await firstValueFrom(this.prService.getByCardNumber(card))) as WorkbenchRegister | null;
      if (this.card() !== card) return;
      this.register.set(res ?? null);
      this.pr.loadRegister(card, res ?? null);
      this.loadError.set(null);
    } catch (e: any) {
      if (this.card() !== card) return;
      this.loadError.set(e?.error?.error ?? 'Não foi possível carregar os dados salvos do card.');
    } finally {
      if (this.card() === card) {
        this.registerLoaded.set(true);
        this.registerLoading.set(false);
        this.pr.githubPrsLoading.set(false);
      }
    }
  }

  /** Recarrega só o registro (descrição/RC/resumo) sem perder edição local não salva. */
  async reloadRegisterQuiet(): Promise<void> {
    const card = this.card();
    if (!card || this.registerLoading()) return;
    try {
      const res = (await firstValueFrom(this.prService.getByCardNumber(card))) as WorkbenchRegister | null;
      if (this.card() !== card || !res) return;
      const keepEdits = this.dirty();
      this.register.set(res);
      if (!keepEdits) this.pr.setContent(res.description ?? null, res.rootCause ?? null);
      this.pr.register.set(res);
    } catch (e) {
      console.error('Falha ao recarregar o registro do card', e);
    }
  }

  /**
   * PRs do card. `refreshStatus` consulta o GitHub (cache de 60 s no backend; `force` ignora o cache);
   * sem ele, só o banco (para o tempo real, em que quem emitiu já atualizou o status).
   */
  async refreshPrs(refreshStatus = true, force = false, silent = false): Promise<void> {
    const card = this.card();
    if (!card) return;
    if (!silent) this.pr.githubPrsLoading.set(true);
    try {
      const prs = await firstValueFrom(this.prService.listGithubPrs(card, refreshStatus, force));
      if (this.card() !== card) return;
      if (!silent || signature(prs ?? []) !== signature(this.pr.githubPrs())) this.pr.setGithubPrs(prs ?? []);
    } catch (e) {
      if (!silent) console.error('Falha ao atualizar os PRs do card', e);
    } finally {
      if (!silent && this.card() === card) this.pr.githubPrsLoading.set(false);
    }
  }

  /** Destinos e repositórios do plugin "Pull Request" (uma vez). */
  loadConfig(force = false): Promise<void> {
    if (force) this.configLoad = null;
    this.configLoad ??= firstValueFrom(this.gds.getAllById(PULLREQUEST_PLUGIN_ID))
      .then((res: any) => {
        const cfg = res?.configurations ?? {};
        const targets = parseActiveBranches(cfg.ActiveBranchs);
        this.targetOptions.set(targets.length ? targets : [{ label: 'DEV', value: 'development' }]);
        this.repositoryOptions.set(parseActiveRepositories(cfg.ActiveRepositories));
      })
      .catch(e => {
        console.error('Falha ao carregar a configuração de PR', e);
        this.configLoad = null;
        if (!this.targetOptions().length) this.targetOptions.set([{ label: 'DEV', value: 'development' }]);
      });
    return this.configLoad;
  }

  /** Card do DevOps (`GET Azure/card/{n}/full`) para as Ações DevOps — só quando o modal precisa. */
  async loadCardFull(force = false): Promise<void> {
    const card = this.card();
    if (!card || (!force && this.cardFullFor === card && (this.cardFull() || this.cardLoading()))) return;
    this.cardFullFor = card;
    this.cardLoading.set(true);
    try {
      const res: any = await firstValueFrom(this.http.get<CardFull>(`${this.base}Azure/card/${encodeURIComponent(card)}/full`));
      if (this.card() !== card) return;
      // O backend devolve 200 com { error } quando o card não existe no DevOps.
      this.cardFull.set(res && !res.error && res.id ? res : null);
    } catch {
      if (this.card() === card) this.cardFull.set(null);
    } finally {
      if (this.card() === card) this.cardLoading.set(false);
    }
  }

  /** Usa o card que a Bancada já carregou (evita buscar de novo). */
  useCardFull(card: CardFull | null | undefined): void {
    if (!card || !this.card() || `${card.id}` !== this.card()) return;
    this.cardFull.set(card);
    this.cardFullFor = this.card();
  }

  /** Branch principal e branch por destino pelas regras do PRMake (`GET Skills/rules`); falha → sem sugestão. */
  async loadRules(): Promise<void> {
    const card = this.card();
    if (!card || this.rulesFor === card) return;
    this.rulesFor = card;
    try {
      const res: any = await firstValueFrom(this.http.get(`${this.base}Skills/rules?card=${encodeURIComponent(card)}`));
      if (this.card() !== card) return;
      const main = `${res?.mainBranch ?? ''}`.trim();
      this.rules.set(main ? { mainBranch: main, branchesByTarget: res?.branchesByTarget ?? {} } : null);
    } catch {
      if (this.card() === card) { this.rules.set(null); this.rulesFor = null; }
    }
  }

  /** Salva descrição/RC editados no modal no registro do card (mesmo `POST PullRequest` da tela de PR). */
  async saveContent(): Promise<WorkbenchRegister> {
    const card = this.card();
    if (!card) throw new Error('Sem card');
    const saved = (await firstValueFrom(this.prService.saveCard({
      cardNumber: card,
      userId: this.userId,
      formId: 1,
      description: this.pr.description(),
      rootCause: this.pr.rootCause(),
    }))) as WorkbenchRegister;
    if (this.card() === card) {
      const merged = { ...(this.register() ?? {}), ...saved, githubPullRequests: this.pr.githubPrs() } as WorkbenchRegister;
      this.register.set(merged);
      this.pr.register.set(merged);
    }
    return saved;
  }

  /** Lembra a última escolha do "Abrir PR". */
  remember(pr: GithubPullRequest): void {
    this.lastTarget.set(pr.targetBranch);
    this.lastRepository.set(pr.repositoryId);
  }

  ngOnDestroy(): void {
    this.devopsChanged$.complete();
    this.switchGroup(null);
    if (this.listening) this.ws.off(PULLREQUEST_CARD_EVENT, this.onCardUpdated);
    this.resyncSub?.unsubscribe();
  }

  private switchGroup(card: string | null): void {
    const group = card ? pullRequestCardGroup(card) : null;
    if (group === this.group) return;
    if (this.group) this.ws.removeFromGroup(this.group);
    if (group) {
      this.listen();
      this.ws.addToGroup(group);
    }
    this.group = group;
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.ws.startConnection();
    this.ws.on(PULLREQUEST_CARD_EVENT, this.onCardUpdated);
    this.resyncSub = this.ws._resynced.subscribe(() => {
      if (!this.card()) return;
      void this.reloadRegisterQuiet();
      void this.refreshPrs(false, false, true);
    });
  }

  /** Registro/resumo salvo em outro lugar → recarrega o registro; PRs abertos/atualizados → recarrega a lista (banco). */
  private onCardUpdated = (payload: any): void => {
    const card = this.card();
    if (!card || `${payload?.cardNumber ?? ''}`.trim() !== card) return;
    if (payload.action === 'register-saved' || payload.action === 'summary-saved') {
      void this.reloadRegisterQuiet();
    } else if (payload.action !== 'handover-saved') {
      if (payload.action === 'github-pr-opened' && !this.register()?.id) void this.reloadRegisterQuiet();
      void this.refreshPrs(false, false, true);
    }
  };
}

function signature(list: GithubPullRequest[]): string {
  return list.map(p => `${p.id}:${p.status}:${p.isDraft}:${p.statusStale}`).sort().join('|');
}
