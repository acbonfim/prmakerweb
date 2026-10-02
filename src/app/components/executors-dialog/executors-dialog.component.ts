import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin } from 'rxjs';
import { ExecutionQueueService } from '../../services/execution-queue.service';
import { CliipboardService } from '../../services/cliipboard.service';
import { StorageService } from '../../services/storage.service';
import { WsService } from '../../services/ws.service';
import { planApiError } from '../../services/execution-plan.service';
import { TokenUsageComponent } from '../token-usage/token-usage.component';
import { TokenUsage } from '../../services/token-pricing.service';
import { formatUsd } from '../../services/ai-usage.service';
import {
  AGENT_INSTALL_COMMAND,
  EXECUTION_WORKERS_EVENT,
  ExecutionRequest,
  ExecutionUsageReport,
  ExecutionUsageReportRow,
  ExecutionUserSettings,
  ExecutionWorker,
  REQUEST_SOURCE_LABEL,
  REQUEST_STATUS_LABEL
} from '../execution-plan/execution-queue.model';

const POLL_MS = 30_000;

/**
 * "Meus executores" (feature 0039): as máquinas do usuário com o executor do PRMake (online/offline, versões, o que
 * está rodando, problemas do doctor), pausar/retomar/revogar, concorrência, orçamento diário, a regra automática do
 * Azure DevOps e o histórico dos pedidos.
 */
@Component({
  selector: 'app-executors-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule, MatSlideToggleModule, MatTooltipModule, TokenUsageComponent],
  template: `
    <div class="ex">
      <div class="ex__header">
        <mat-icon class="ex__lead">dns</mat-icon>
        <div class="ex__titles">
          <span class="ex__title">Meus executores</span>
          <span class="ex__sub">Máquinas que rodam a análise do Claude pela tela do PRMake, sem abrir o terminal.</span>
        </div>
        <button mat-icon-button (click)="close()" aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </div>

      <div class="ex__body">
        <section class="ex__section">
          <div class="ex__section-title">Instalar nesta máquina</div>
          <p>Com as skills do PRMake já instaladas (menu <strong>Skills do Claude</strong>), rode no terminal — no Windows, no Git Bash:</p>
          <div class="ex__cmd">
            <code>{{ installCommand }}</code>
            <button mat-icon-button (click)="copy(installCommand)" matTooltip="Copiar"><mat-icon>content_copy</mat-icon></button>
          </div>
          <p class="ex__note">Baixa o executor{{ latestVersion() ? ' v' + latestVersion() : '' }}, registra a máquina (com a sua api-key das
            skills), liga o serviço que sobe junto com o seu usuário (macOS, Windows ou Linux) e roda o diagnóstico. A máquina precisa
            estar ligada, com o Claude Code logado; o executor se atualiza sozinho. Status: <code>~/.prmake-agent/bin/prmake-agent status</code></p>
        </section>

        <section class="ex__section">
          <div class="ex__section-title">Máquinas</div>
          @if (loading()) {
            <div class="ex__state"><mat-spinner diameter="22"></mat-spinner></div>
          } @else if (!workers().length) {
            <div class="ex__state">Nenhuma máquina registrada ainda.</div>
          }
          @for (w of workers(); track w.id) {
            <div class="ex__worker" [class.ex__worker--off]="!w.online">
              <div class="ex__worker-head">
                <span class="ex__dot" [class.ex__dot--on]="w.online && w.status === 'active'" [class.ex__dot--paused]="w.status === 'paused'"
                      [matTooltip]="w.status === 'paused' ? 'Pausado' : w.online ? 'Online' : 'Offline'"></span>
                <span class="ex__worker-name">{{ w.name }}</span>
                <span class="ex__worker-meta">{{ w.status === 'paused' ? 'pausado' : w.online ? 'online' : 'offline' }}
                  · último sinal {{ ago(w.lastSeenAt) }}</span>
                <span class="ex__spacer"></span>
                <label class="ex__conc" matTooltip="Quantos cards esta máquina roda ao mesmo tempo">
                  <span>Simultâneos</span>
                  <select [ngModel]="w.maxConcurrency" (ngModelChange)="setConcurrency(w, $event)" [disabled]="busy() === w.id">
                    <option [ngValue]="1">1</option><option [ngValue]="2">2</option><option [ngValue]="3">3</option>
                  </select>
                </label>
                @if (w.status === 'paused') {
                  <button mat-icon-button (click)="resume(w)" [disabled]="busy() === w.id" matTooltip="Retomar (volta a pegar pedidos)"><mat-icon>play_arrow</mat-icon></button>
                } @else {
                  <button mat-icon-button (click)="pause(w)" [disabled]="busy() === w.id" matTooltip="Pausar (para de pegar pedidos novos)"><mat-icon>pause</mat-icon></button>
                }
                <button mat-icon-button (click)="revoke(w)" [disabled]="busy() === w.id" matTooltip="Revogar (a credencial desta máquina deixa de valer)"><mat-icon>link_off</mat-icon></button>
              </div>
              <div class="ex__worker-info">
                <span>{{ w.host }}{{ w.os ? ' · ' + w.os : '' }}</span>
                <span>executor {{ w.agentVersion || '?' }}
                  @if (outdated(w)) { <strong class="ex__warn">(desatualizado — publicado {{ w.latestAgentVersion }})</strong> }
                </span>
                @if (w.claudeVersion) { <span>Claude Code {{ w.claudeVersion }}</span> }
                @if (w.skillsVersion) { <span>skills {{ w.skillsVersion }}</span> }
                <span>rodando {{ w.running }}/{{ w.maxConcurrency }}</span>
                @if (w.throttledUntil) {
                  <strong class="ex__warn" matTooltip="A conta do Claude desta máquina bateu o limite de uso; os pedidos esperam o reset sem gastar tentativa">
                    limite da conta do Claude até {{ time(w.throttledUntil) }}</strong>
                }
                @if (w.workspace) { <span [title]="w.workspace">pasta {{ w.workspace }}</span> }
              </div>
              <div class="ex__doctor-row">
              @if (w.doctor?.length) {
                <button type="button" class="ex__doctor-toggle" [class.ex__doctor-toggle--bad]="w.doctorProblems > 0" (click)="toggleDoctor(w.id)">
                  <mat-icon>{{ w.doctorProblems ? 'report' : 'verified' }}</mat-icon>
                  {{ w.doctorProblems ? w.doctorProblems + (w.doctorProblems === 1 ? ' problema' : ' problemas') + ' no diagnóstico' : 'Diagnóstico ok' }}
                  · {{ ago(w.doctorAt) }}
                </button>
              }
                @if (w.doctorPending) {
                  <span class="ex__doctor-pending"><mat-spinner diameter="12"></mat-spinner>
                    diagnóstico pedido — {{ w.online ? 'a máquina roda em até 1 min' : 'roda quando a máquina voltar' }}</span>
                } @else if (w.status !== 'revoked') {
                  <button type="button" class="ex__doctor-run" (click)="requestDoctor(w)" [disabled]="busy() === w.id"
                          matTooltip="A máquina roda o diagnóstico de novo agora (Claude Code, login, MCP, skills, repositórios, bancos)">
                    <mat-icon>refresh</mat-icon> Rodar diagnóstico
                  </button>
                }
              </div>
              @if (w.doctor?.length) {
                @if (openDoctor() === w.id) {
                  <ul class="ex__doctor">
                    @for (c of w.doctor; track c.name) {
                      <li [class.ex__doctor--bad]="!c.ok && c.severity !== 'warning'" [class.ex__doctor--warn]="!c.ok && c.severity === 'warning'">
                        <mat-icon>{{ c.ok ? 'check_circle' : c.severity === 'warning' ? 'warning' : 'error' }}</mat-icon>
                        <span><strong>{{ c.name }}</strong>{{ c.message ? ': ' + c.message : '' }}</span>
                      </li>
                    }
                  </ul>
                }
              }
            </div>
          }
        </section>

        <section class="ex__section">
          <div class="ex__section-title">Orçamento e regra automática</div>
          @if (settings(); as st) {
            <div class="ex__row">
              <label class="ex__field">
                <span>Orçamento por dia (US$)</span>
                <input type="number" min="0" step="1" [(ngModel)]="budget" placeholder="sem limite" />
              </label>
              <span class="ex__note">Gasto hoje: US$ {{ st.spentTodayUsd.toFixed(2) }}. Estourou: os pedidos ficam na fila até você liberar ("Rodar mesmo assim").</span>
            </div>
            <mat-slide-toggle [(ngModel)]="autoEnabled">Pedir a análise sozinho quando um card meu entrar na regra do Azure DevOps</mat-slide-toggle>
            @if (autoEnabled) {
              <div class="ex__grid">
                <label class="ex__field"><span>Tipos de item</span><input [(ngModel)]="autoTypes" placeholder="Bug, Issue" /></label>
                <label class="ex__field"><span>Estados</span><input [(ngModel)]="autoStates" placeholder="Active, New" /></label>
                <label class="ex__field"><span>Áreas (opcional)</span><input [(ngModel)]="autoAreas" placeholder="Projeto\\Suporte" /></label>
                <label class="ex__field"><span>Atribuído a</span><input [(ngModel)]="autoAssigned" placeholder="@Me ou seu e-mail no DevOps" /></label>
                <label class="ex__field"><span>Máximo por dia</span><input type="number" min="1" max="50" [(ngModel)]="autoMax" /></label>
              </div>
              <p class="ex__note">Avaliada a cada 5 min enquanto uma máquina sua está online. Cards que já têm plano ou pedido nos últimos 30 dias
                não entram de novo. <strong>&#64;Me</strong> é o dono do PAT do Azure DevOps — se a integração for compartilhada, use o seu e-mail.
                @if (st.autoLastCheckAt) { Última avaliação: {{ ago(st.autoLastCheckAt) }}. }
              </p>
              @if (st.autoLastError) { <p class="ex__error">Último erro: {{ st.autoLastError }}</p> }
            }
            <div class="ex__actions">
              <button mat-flat-button color="primary" (click)="saveSettings()" [disabled]="busy() === 'settings'">Salvar</button>
            </div>
          }
        </section>

        <section class="ex__section">
          <div class="ex__section-title ex__row-title">
            <span>Consumo por plano — MCP × script</span>
            <span class="ex__spacer"></span>
            <select [ngModel]="usageDays()" (ngModelChange)="usageDays.set($event); loadUsage()" aria-label="Período">
              <option [ngValue]="7">7 dias</option><option [ngValue]="30">30 dias</option><option [ngValue]="90">90 dias</option>
            </select>
            @if (isAdmin) {
              <mat-slide-toggle [ngModel]="usageAll()" (ngModelChange)="usageAll.set($event); loadUsage()">todos</mat-slide-toggle>
            }
          </div>
          @if (usage(); as u) {
            @if (!usageHasData()) {
              <div class="ex__state">Sem planos com custo registrado no período. O custo vai quando a skill conclui o plano.</div>
            } @else {
              <table class="ex__usage">
                <thead><tr><th></th><th>Planos</th><th>Turnos</th><th>Entrada</th><th>Saída</th><th>Total</th><th>MCP / script</th><th>Base / buscas</th></tr></thead>
                <tbody>
                  @for (r of usageRows(); track r.channel + r.phase) {
                    <tr [class.ex__usage-sub]="r.phase !== 'all'">
                      <td>{{ r.phase === 'all' ? (r.channel === 'mcp' ? 'Com MCP' : 'Sem MCP') : (r.phase === 'analysis' ? '· análise' : '· correção') }}</td>
                      <td>{{ r.plans }}</td>
                      <td>{{ r.plans ? r.avgTurns : '—' }}</td>
                      <td>{{ r.plans ? tokens(r.avgInputTokens) : '—' }}</td>
                      <td>{{ r.plans ? tokens(r.avgOutputTokens) : '—' }}</td>
                      <td>@if (r.plans) { <app-token-usage [usage]="reportUsage(r)" xPosition="before" /> } @else { — }</td>
                      <td>{{ r.plans ? r.avgMcpCalls + ' / ' + r.avgScriptCalls : '—' }}</td>
                      <td>{{ r.plans && r.avgKbCalls != null ? r.avgKbCalls + ' / ' + r.avgSearchCalls : '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              @if (usageDiff(); as d) { <p class="ex__note">{{ d }}</p> }
              <p class="ex__note">Médias por plano. "Com MCP" = a maioria das chamadas ao PRMake pelas ferramentas MCP. Entrada = nova +
                cache lido (o contexto relido a cada resposta, com desconto) + cache escrito — toque no total para ver as partes e o custo.
                A correção não soma o que a mesma sessão gastou na análise. "Base / buscas" = consultas à Base Solvace × buscas no código
                (grep/find) — a base vem primeiro e encurta a investigação.</p>
            }
          }
        </section>

        <section class="ex__section">
          <div class="ex__section-title">Últimos pedidos</div>
          @if (!history().length) {
            <div class="ex__state">Nenhum pedido ainda.</div>
          }
          @for (r of history(); track r.id) {
            <div class="ex__req">
              <span class="ex__req-status ex__req-status--{{ r.status }}">{{ statusLabel[r.status] }}</span>
              <span class="ex__req-card">#{{ r.cardNumber }}</span>
              <span class="ex__req-text">{{ r.kind === 'analyze' ? 'análise' : 'continuar' }} · {{ sourceLabel[r.source] || r.source }}
                @if (r.workerName) { · {{ r.workerName }} }
                · {{ ago(r.createdAt) }}
                @if (requestUsage(r); as u) { · <app-token-usage [usage]="u" xPosition="before" /> }
                @if (r.lastError && (r.status === 'failed' || r.status === 'expired')) { <span class="ex__error"> — {{ r.lastError }}</span> }
                @else if (r.waitReason && r.status === 'queued') { <span class="ex__note"> — {{ r.waitReason }}</span> }
              </span>
            </div>
          }
        </section>
      </div>
    </div>
  `,
  styles: [`
    .ex { display: flex; flex-direction: column; max-height: 90vh; color: var(--mat-sys-on-surface); }
    .ex__header { display: flex; align-items: center; gap: 10px; padding: 14px 10px 14px 20px; background: var(--surface-2, #323232);
      border-bottom: 1px solid rgba(255,255,255,.06); }
    .ex__lead { color: var(--mat-sys-primary); }
    .ex__titles { flex: 1; display: flex; flex-direction: column; }
    .ex__title { font-weight: 600; font-size: 16px; }
    .ex__sub, .ex__note { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .ex__body { overflow-y: auto; padding: 8px 20px 20px; }
    .ex__section { padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,.06); font-size: 13px; }
    .ex__section-title { font-weight: 600; margin-bottom: 8px; }
    .ex__section p { margin: 6px 0; line-height: 1.45; }
    .ex__cmd { display: flex; align-items: center; gap: 6px; padding: 4px 4px 4px 12px; border-radius: 8px; background: rgba(0,0,0,.3); }
    .ex__cmd code { flex: 1; font-family: 'Courier New', monospace; font-size: 12px; overflow-x: auto; white-space: nowrap; }
    code { font-family: 'Courier New', monospace; }
    .ex__state { padding: 10px 0; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); display: flex; justify-content: center; }
    .ex__worker { padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,.04); margin-bottom: 8px; }
    .ex__worker--off { opacity: .8; }
    .ex__worker-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ex__worker-name { font-weight: 600; }
    .ex__worker-meta { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .ex__spacer { flex: 1; }
    .ex__dot { width: 10px; height: 10px; border-radius: 50%; background: #8b949e; flex: none; }
    .ex__dot--on { background: #3fb950; box-shadow: 0 0 0 3px rgba(63,185,80,.2); }
    .ex__dot--paused { background: #d29922; }
    .ex__conc { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    .ex__conc select, .ex__field input { padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,.14);
      background: var(--surface-input, #1f1f1f); color: var(--mat-sys-on-surface); font-size: 13px; }
    .ex__worker-info { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; font-size: 12px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent); }
    .ex__worker-info span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ex__warn { color: #d29922; }
    .ex__doctor-toggle { margin-top: 8px; display: inline-flex; align-items: center; gap: 6px; border: none; background: none; padding: 0;
      color: #3fb950; font: inherit; font-size: 12px; cursor: pointer; }
    .ex__doctor-toggle .mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ex__doctor-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .ex__doctor-run { margin-top: 8px; display: inline-flex; align-items: center; gap: 4px; border: none; background: none; padding: 0;
      color: var(--mat-sys-primary); font: inherit; font-size: 12px; cursor: pointer; }
    .ex__doctor-run .mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ex__doctor-pending { margin-top: 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 12px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent); }
    .ex__doctor-toggle--bad { color: #f0716a; }
    .ex__doctor { list-style: none; margin: 6px 0 0; padding: 0; font-size: 12px; }
    .ex__doctor li { display: flex; gap: 6px; align-items: flex-start; padding: 2px 0; }
    .ex__doctor .mat-icon { font-size: 15px; width: 15px; height: 15px; color: #3fb950; flex: none; }
    .ex__doctor--bad .mat-icon { color: #f0716a; }
    .ex__doctor--warn .mat-icon { color: #d29922; }
    .ex__row { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
    .ex__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin: 10px 0 4px; }
    .ex__field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
    .ex__actions { display: flex; justify-content: flex-end; margin-top: 8px; }
    .ex__error { color: #f0716a; font-size: 12px; }
    .ex__row-title { display: flex; align-items: center; gap: 10px; }
    .ex__row-title select { padding: 3px 6px; border-radius: 6px; border: 1px solid rgba(255,255,255,.14);
      background: var(--surface-input, #1f1f1f); color: var(--mat-sys-on-surface); font-size: 12px; }
    .ex__usage { width: 100%; border-collapse: collapse; font-size: 12px; }
    .ex__usage th { text-align: right; font-weight: 500; padding: 4px 6px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .ex__usage td { text-align: right; padding: 4px 6px; border-top: 1px solid rgba(255,255,255,.05); }
    .ex__usage th:first-child, .ex__usage td:first-child { text-align: left; }
    .ex__usage-sub td { color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent); }
    .ex__req { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; font-size: 12px; border-bottom: 1px dashed rgba(255,255,255,.05); }
    .ex__req-card { font-weight: 600; }
    .ex__req-text { flex: 1; min-width: 0; }
    .ex__req-status { flex: none; padding: 1px 8px; border-radius: 10px; font-size: 11px; background: rgba(255,255,255,.08); }
    .ex__req-status--running, .ex__req-status--claimed { background: color-mix(in srgb, var(--mat-sys-primary) 25%, transparent); }
    .ex__req-status--queued { background: rgba(210,153,34,.25); }
    .ex__req-status--done { background: rgba(63,185,80,.2); }
    .ex__req-status--failed, .ex__req-status--expired { background: rgba(240,113,106,.2); }
  `]
})
export class ExecutorsDialogComponent implements OnInit, OnDestroy {
  private api = inject(ExecutionQueueService);
  private ref = inject(MatDialogRef<ExecutorsDialogComponent>);
  private clipboard = inject(CliipboardService);
  private snackBar = inject(MatSnackBar);
  private ws = inject(WsService);
  private userId: string | null = inject(StorageService).getAccess()?.user?.externalId ?? null;

  readonly installCommand = AGENT_INSTALL_COMMAND;
  readonly statusLabel = REQUEST_STATUS_LABEL;
  readonly sourceLabel = REQUEST_SOURCE_LABEL;

  readonly loading = signal(true);
  readonly workers = signal<ExecutionWorker[]>([]);
  readonly history = signal<ExecutionRequest[]>([]);
  readonly settings = signal<ExecutionUserSettings | null>(null);
  readonly latestVersion = signal<string | null>(null);
  readonly busy = signal<string | null>(null);
  readonly openDoctor = signal<string | null>(null);
  readonly now = signal(Date.now());
  readonly usage = signal<ExecutionUsageReport | null>(null);
  readonly usageDays = signal(30);
  readonly usageAll = signal(false);
  readonly isAdmin = this.readIsAdmin();

  budget: number | null = null;
  autoEnabled = false;
  autoTypes = '';
  autoStates = '';
  autoAreas = '';
  autoAssigned = '@Me';
  autoMax = 5;

  private poll?: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;

  /** Só quando a versão publicada é MAIS NOVA que a da máquina (1.0.10 > 1.0.9). */
  readonly outdated = (w: ExecutionWorker) => {
    if (!w.latestAgentVersion || !w.agentVersion) return false;
    const a = w.latestAgentVersion.split('.').map(Number), b = w.agentVersion.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d !== 0) return d > 0;
    }
    return false;
  };

  ngOnInit(): void {
    this.load(true);
    this.loadUsage();
    this.api.agent().subscribe({ next: (a) => this.latestVersion.set(a.version ?? null), error: () => {} });
    this.ws.on(EXECUTION_WORKERS_EVENT, this.onChanged);
    this.poll = setInterval(() => { this.now.set(Date.now()); if (!document.hidden) this.load(false); }, POLL_MS);
  }

  ngOnDestroy(): void {
    clearInterval(this.poll);
    clearTimeout(this.debounce);
    this.ws.off(EXECUTION_WORKERS_EVENT, this.onChanged);
  }

  loadUsage(): void {
    this.api.usageReport(this.usageDays(), this.usageAll()).subscribe({ next: (u) => this.usage.set(u), error: () => this.usage.set(null) });
  }

  /** Média do grupo com as partes da entrada (0044) — popover do total. */
  reportUsage(r: ExecutionUsageReportRow): TokenUsage {
    const hasParts = r.avgCacheReadTokens != null;
    const group = r.phase === 'all' ? (r.channel === 'mcp' ? 'Com MCP' : 'Sem MCP') : `${r.channel === 'mcp' ? 'Com MCP' : 'Sem MCP'} · ${r.phase === 'analysis' ? 'análise' : 'correção'}`;
    return {
      freshInput: hasParts ? r.avgFreshInputTokens : null,
      cacheRead: hasParts ? r.avgCacheReadTokens : null,
      cacheWrite: hasParts ? r.avgCacheWriteTokens : null,
      input: r.avgInputTokens,
      output: r.avgOutputTokens,
      model: r.model,
      average: true,
      title: `Média por plano — ${group}`,
      subtitle: `${r.plans} ${r.plans === 1 ? 'plano' : 'planos'} · ${r.avgTurns} respostas em média`,
    };
  }

  /** Consumo do pedido (0044): custo do pedido (não o acumulado da sessão) e as partes, quando o executor manda. */
  requestUsage(r: ExecutionRequest): TokenUsage | null {
    if (!r.inputTokens && !r.outputTokens && r.costUsd == null) return null;
    const hasParts = r.cacheReadTokens != null;
    return {
      freshInput: hasParts ? r.freshInputTokens : null,
      cacheRead: hasParts ? r.cacheReadTokens : null,
      cacheWrite: hasParts ? r.cacheWriteTokens : null,
      input: r.inputTokens,
      output: r.outputTokens,
      model: r.model,
      reportedCostUsd: r.costUsd,
      reportedBy: 'Claude Code',
      turns: r.turns,
      title: `Pedido #${r.cardNumber} — ${r.kind === 'analyze' ? 'análise' : 'continuar'}`,
      subtitle: r.finishedAt ? `terminou ${this.ago(r.finishedAt)}` : null,
      notes: [
        r.sessionCostUsd != null && r.costUsd != null && r.sessionCostUsd > r.costUsd + 0.005
          ? `A sessão é retomada a cada "continuar": acumulado dela até aqui ${formatUsd(r.sessionCostUsd)} — este pedido custou só a diferença.`
          : null,
        hasParts ? null : 'Executor antigo: só a entrada total (as partes chegam no executor 1.0.3).',
      ],
    };
  }

  usageRows(): ExecutionUsageReportRow[] {
    return this.usage()?.rows ?? [];
  }

  usageHasData(): boolean {
    return this.usageRows().some((r) => r.phase === 'all' && r.plans > 0);
  }

  /** "Com MCP, X% menos tokens de entrada por plano" — só com os dois grupos preenchidos. */
  usageDiff(): string | null {
    const mcp = this.usageRows().find((r) => r.channel === 'mcp' && r.phase === 'all');
    const script = this.usageRows().find((r) => r.channel === 'script' && r.phase === 'all');
    if (!mcp?.plans || !script?.plans || !script.avgInputTokens) return null;
    const pct = Math.round((1 - mcp.avgInputTokens / script.avgInputTokens) * 100);
    const base = `Com MCP: ${Math.abs(pct)}% ${pct >= 0 ? 'menos' : 'mais'} tokens de entrada por plano`;
    return `${base} (${mcp.plans} × ${script.plans} planos — compare casos parecidos antes de concluir).`;
  }

  tokens(n: number): string {
    return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1000 ? `${Math.round(n / 1000)} mil` : `${Math.round(n)}`;
  }

  time(value: string): string {
    const d = new Date(value);
    const sameDay = d.toDateString() === new Date().toDateString();
    return d.toLocaleString('pt-BR', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  private readIsAdmin(): boolean {
    try {
      const token = inject(StorageService).getItem('apiKey');
      const payload = JSON.parse(atob(`${token}`.split('.')[1]));
      const raw = payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] ?? payload['role'];
      return (Array.isArray(raw) ? raw : [raw]).includes('admin');
    } catch {
      return false;
    }
  }

  private onChanged = (payload: { userId?: string }) => {
    if (payload?.userId && this.userId && payload.userId !== this.userId) return;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.load(false), 800);
  };

  private load(withSettings: boolean): void {
    forkJoin({ workers: this.api.myWorkers(), history: this.api.myRequests() }).subscribe({
      next: ({ workers, history }) => {
        this.loading.set(false);
        this.workers.set(workers);
        this.history.set(history.slice(0, 25));
        this.now.set(Date.now());
      },
      error: () => this.loading.set(false)
    });
    if (withSettings) {
      this.api.settings().subscribe({ next: (s) => this.applySettings(s), error: () => {} });
    }
  }

  private applySettings(s: ExecutionUserSettings): void {
    this.settings.set(s);
    this.budget = s.dailyBudgetUsd ?? null;
    this.autoEnabled = s.autoAnalyzeEnabled;
    this.autoTypes = s.autoWorkItemTypes.join(', ');
    this.autoStates = s.autoStates.join(', ');
    this.autoAreas = s.autoAreaPaths.join(', ');
    this.autoAssigned = s.autoAssignedTo || '@Me';
    this.autoMax = s.autoMaxPerDay || 5;
  }

  saveSettings(): void {
    const list = (v: string) => v.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
    this.busy.set('settings');
    this.api.saveSettings({
      dailyBudgetUsd: this.budget === null || `${this.budget}` === '' ? null : Number(this.budget),
      autoAnalyzeEnabled: this.autoEnabled,
      autoWorkItemTypes: list(this.autoTypes),
      autoStates: list(this.autoStates),
      autoAreaPaths: list(this.autoAreas),
      autoAssignedTo: this.autoAssigned.trim() || '@Me',
      autoMaxPerDay: Number(this.autoMax) || 5
    }).subscribe({
      next: (s) => { this.busy.set(null); this.applySettings(s); this.snackBar.open('Configurações salvas.', 'Ok', { duration: 4000 }); },
      error: (err) => { this.busy.set(null); this.snackBar.open(planApiError(err, 'Não foi possível salvar.'), 'Fechar', { duration: 8000 }); }
    });
  }

  setConcurrency(w: ExecutionWorker, value: number): void {
    this.mutate(w, this.api.configureWorker(w.id, { maxConcurrency: value }));
  }

  pause(w: ExecutionWorker): void { this.mutate(w, this.api.pauseWorker(w.id)); }
  requestDoctor(w: ExecutionWorker): void { this.mutate(w, this.api.requestDoctor(w.id)); }
  resume(w: ExecutionWorker): void { this.mutate(w, this.api.resumeWorker(w.id)); }

  revoke(w: ExecutionWorker): void {
    if (!confirm(`Revogar a máquina "${w.name}"? A credencial dela deixa de valer e o que estiver rodando volta para a fila. Para usar de novo: prmake-agent register.`)) return;
    this.busy.set(w.id);
    this.api.revokeWorker(w.id).subscribe({
      next: () => { this.busy.set(null); this.workers.set(this.workers().filter((x) => x.id !== w.id)); },
      error: (err) => { this.busy.set(null); this.snackBar.open(planApiError(err, 'Não foi possível revogar.'), 'Fechar', { duration: 8000 }); }
    });
  }

  private mutate(w: ExecutionWorker, request: ReturnType<ExecutionQueueService['pauseWorker']>): void {
    this.busy.set(w.id);
    request.subscribe({
      next: (updated) => { this.busy.set(null); this.workers.set(this.workers().map((x) => (x.id === updated.id ? updated : x))); },
      error: (err) => { this.busy.set(null); this.snackBar.open(planApiError(err, 'Não foi possível alterar a máquina.'), 'Fechar', { duration: 8000 }); this.load(false); }
    });
  }

  toggleDoctor(id: string): void {
    this.openDoctor.set(this.openDoctor() === id ? null : id);
  }

  copy(text: string): void {
    this.clipboard.copyFullDescriptionToClipboard(text);
  }

  ago(value?: string | null): string {
    if (!value) return '—';
    const diff = Math.max(0, this.now() - Date.parse(value));
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h} h`;
    return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  close(): void {
    this.ref.close();
  }
}
