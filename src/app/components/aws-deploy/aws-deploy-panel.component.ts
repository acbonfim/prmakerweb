import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';

import { AwsDeployError, AwsDeployService } from '../../services/aws-deploy.service';
import { WsService } from '../../services/ws.service';
import { listenAws } from '../work-items/work-items-live';
import {
  AwsCardSnapshot, AwsCardState, AwsDeployConfig, AwsEnvPipeline, AwsEnvironment, AwsLook, appName, awsCollectCommand, codeLook,
  environmentLook, firstLine, formatDuration, formatFullDate, formatShortDate, isSecondary, lastDeployAt, orderEnvironments,
  pipelineStatusLook, refreshStatusText, relativeAgo, shortSha, sortPipelines
} from './aws-deploy.model';

/** Com o pedido de coleta na fila/rodando, relê o estado de tempos em tempos (caso o tempo real perca o evento). */
const ACTIVE_POLL_MS = 6000;
/** Acima de quantas esteiras a tabela do ambiente recolhe as já implantadas. */
const FOLD_OVER = 8;

/**
 * 0100: aba **AWS** da Bancada — por ambiente (DEV, QA, Sandboxefeso…), um veredito grande ("Nosso código está em QA")
 * e as esteiras de deploy do(s) repositório(s) do card (status, última execução, commit implantado e se ele contém o
 * nosso código), mais logs/erros recentes, outros recursos e o que a máquina não pôde ler. Somente leitura: o retrato
 * vem da máquina de quem coletou (CLI da AWS) — "Atualizar" pede a coleta ao seu executor; sem executor, o comando.
 */
@Component({
  selector: 'app-aws-deploy-panel',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './aws-deploy-panel.component.html',
  styleUrl: './aws-deploy-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AwsDeployPanelComponent {
  private api = inject(AwsDeployService);
  private ws = inject(WsService);
  private snack = inject(MatSnackBar);

  readonly cardNumber = input.required<string>();

  readonly state = signal<AwsCardState | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly config = signal<AwsDeployConfig | null>(null);
  /** POST do "Atualizar" em andamento. */
  readonly asking = signal(false);
  /** 409 NO_EXECUTOR no último "Atualizar". */
  readonly noExecutor = signal(false);
  /** Relógio para o "há X min". */
  readonly now = signal(Date.now());

  readonly snapshot = computed<AwsCardSnapshot | null>(() => this.state()?.snapshot ?? null);
  readonly collectedAt = computed(() => this.snapshot()?.collectedAt || this.state()?.collectedAt || null);
  readonly collectedBy = computed(() => this.snapshot()?.collectedBy || this.state()?.collectedBy || null);
  readonly command = computed(() => awsCollectCommand(this.cardNumber()));

  readonly environments = computed(() =>
    orderEnvironments(this.snapshot()?.environments ?? [], this.config()?.environments));
  readonly logEnvironments = computed(() => this.environments().filter((e) => (e.logs ?? []).length > 0));
  readonly repositories = computed(() => this.snapshot()?.repositories ?? []);
  readonly lambdas = computed(() => this.snapshot()?.resources?.lambdas ?? []);
  readonly alarms = computed(() => (this.snapshot()?.resources?.alarms ?? []).filter((a) => `${a.state ?? 'ALARM'}`.toUpperCase() === 'ALARM'));
  readonly distributions = computed(() => this.environments()
    .filter((e) => !!e.resources?.cloudfront?.id || (e.resources?.elasticBeanstalk ?? []).length > 0)
    .map((e) => ({ env: e, cf: e.resources?.cloudfront ?? null, eb: e.resources?.elasticBeanstalk ?? [] })));
  readonly hasOther = computed(() => this.lambdas().length + this.alarms().length + this.distributions().length > 0);
  readonly denied = computed(() => (this.snapshot()?.denied ?? []).map((d) => d.toUpperCase()));
  readonly warnings = computed(() => this.snapshot()?.warnings ?? []);
  readonly notes = computed(() => this.snapshot()?.notes ?? []);
  /** Ambientes com as esteiras abertas na tabela (nenhum de início: a linha já responde). */
  readonly openEnvs = signal<ReadonlySet<string>>(new Set());

  /** Pedido de coleta a mostrar: na fila/rodando sempre; falhou/expirou só se for mais novo que o retrato. */
  readonly refreshInfo = computed(() => {
    const r = this.state()?.refresh ?? null;
    const info = refreshStatusText(r);
    if (!info || info.busy) return info;
    const at = Date.parse(r?.requestedAt ?? '');
    const collected = Date.parse(this.collectedAt() ?? '');
    return Number.isFinite(collected) && Number.isFinite(at) && at < collected ? null : info;
  });
  readonly busy = computed(() => this.asking() || !!this.refreshInfo()?.busy);
  /** Sem executor: 409 no "Atualizar" ou o GET diz que o executor de quem lê está desligado. */
  readonly showManual = computed(() => this.noExecutor() || this.state()?.executorOnline === false);

  private stopLive?: () => void;
  private loadSub?: Subscription;
  private pollTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    const clock = setInterval(() => this.now.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(clock);
      clearTimeout(this.pollTimer);
      this.stopLive?.();
      this.loadSub?.unsubscribe();
    });

    this.api.config().subscribe({ next: (c) => this.config.set(c), error: () => undefined });

    effect(() => {
      const card = this.cardNumber();
      untracked(() => {
        this.stopLive?.();
        this.state.set(null);
        this.noExecutor.set(false);
        this.load(false);
        this.stopLive = card ? listenAws(this.ws, card, () => this.load(true)) : undefined;
      });
    });

    // Pedido ativo: relê de tempos em tempos até terminar (o evento "aws" chega com o retrato; isto cobre o estado do pedido).
    effect(() => {
      const busy = !!this.refreshInfo()?.busy;
      untracked(() => {
        clearTimeout(this.pollTimer);
        if (busy) this.pollTimer = setTimeout(() => this.load(true), ACTIVE_POLL_MS);
      });
    });
  }

  load(silent: boolean): void {
    const card = this.cardNumber();
    if (!card) return;
    if (!silent) this.loading.set(true);
    this.loadSub?.unsubscribe();
    this.loadSub = this.api.card(card).subscribe({
      next: (s) => {
        this.state.set(s ?? { snapshot: null });
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e: AwsDeployError) => {
        if (!silent || !this.state()) this.error.set(e.message);
        this.loading.set(false);
      }
    });
  }

  refresh(): void {
    const card = this.cardNumber();
    if (!card || this.busy()) return;
    this.asking.set(true);
    this.api.refresh(card).subscribe({
      next: (r) => {
        this.asking.set(false);
        this.noExecutor.set(false);
        this.state.update((s) => ({ ...(s ?? { snapshot: null }), refresh: r, executorOnline: true }));
      },
      error: (e: AwsDeployError) => {
        this.asking.set(false);
        if (e.noExecutor) {
          this.noExecutor.set(true);
          return;
        }
        this.snack.open(e.message, 'OK', { duration: 5000 });
      }
    });
  }

  copyCommand(): void {
    const text = this.command();
    navigator.clipboard?.writeText(text).then(
      () => this.snack.open('Comando copiado — cole no terminal da sua máquina (com a CLI da AWS)', 'OK', { duration: 3000 }),
      () => this.snack.open(text, 'OK', { duration: 8000 })
    );
  }

  toggleEnv(key: string): void {
    this.openEnvs.update((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  isOpen(key: string): boolean {
    return this.openEnvs().has(key);
  }

  /** Lista longa (monorepo): de início só o que pede atenção; os apps já implantados ficam atrás do "mostrar". */
  readonly allRows = signal<ReadonlySet<string>>(new Set());
  showAll(key: string): void {
    this.allRows.update((set) => new Set(set).add(key));
  }

  visibleRows(env: AwsEnvironment): AwsEnvPipeline[] {
    const rows = this.pipeRows(env);
    if (rows.length <= FOLD_OVER || this.allRows().has(env.key)) return rows;
    const pending = rows.filter((p) => !p.deployed);
    return pending.length ? pending : rows.slice(0, FOLD_OVER);
  }

  // ── Template ───────────────────────────────────────────────────────────────────────────────

  private readonly lookCache = new WeakMap<AwsEnvironment, ReturnType<typeof environmentLook>>();
  envLook(env: AwsEnvironment): ReturnType<typeof environmentLook> {
    let v = this.lookCache.get(env);
    if (!v) this.lookCache.set(env, (v = environmentLook(env)));
    return v;
  }

  private readonly rowsCache = new WeakMap<AwsEnvironment, AwsEnvPipeline[]>();
  pipeRows(env: AwsEnvironment): AwsEnvPipeline[] {
    let r = this.rowsCache.get(env);
    if (!r) this.rowsCache.set(env, (r = sortPipelines(env.pipelines ?? [])));
    return r;
  }

  /** Monorepo (várias esteiras com app): a coluna mostra o app em destaque. */
  hasApps(env: AwsEnvironment): boolean {
    return (env.pipelines ?? []).some((p) => !!p.app && p.app !== p.name) && (env.pipelines ?? []).length > 1;
  }

  lastDeploy(env: AwsEnvironment): string | null {
    return lastDeployAt(env);
  }

  readonly secondary = isSecondary;
  readonly app = appName;
  readonly code = codeLook;

  statusLook(p: AwsEnvPipeline): AwsLook {
    return pipelineStatusLook(p.status);
  }

  readonly short = shortSha;
  readonly line1 = firstLine;
  readonly duration = formatDuration;
  readonly date = formatShortDate;
  readonly fullDate = formatFullDate;

  ago(at: string | null | undefined): string {
    return relativeAgo(at, this.now());
  }

  /** Nome curto do repositório ("electradv/edv-solvace-apps" → "edv-solvace-apps"). */
  repoName(repo: string | null | undefined): string {
    return `${repo ?? ''}`.split('/').pop() ?? '';
  }
}
