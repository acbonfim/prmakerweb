import { Injectable, computed, inject, signal } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ExecutionQueueService } from '../../services/execution-queue.service';
import { StorageService } from '../../services/storage.service';
import { UserIntegration, UserIntegrationService } from '../../services/user-integration.service';
import { ExecutionDoctorCheck, ExecutionWorker } from '../execution-plan/execution-queue.model';
import { GuidedTourService } from '../guided-tour/guided-tour.service';
import { TourDefinition } from '../guided-tour/tour.model';

/** Suba quando o guia mudar de um jeito que quem já viu deva ver de novo (abre sozinho outra vez se não estiver pronto). */
export const SETUP_GUIDE_VERSION = 1;

export type SetupStepId = 'integrations' | 'claude' | 'skills' | 'databases' | 'executor';

/** done = pronto · pending = falta (obrigatório) · recommended = falta, mas é opcional · manual = sem como verificar daqui. */
export type SetupStepState = 'done' | 'pending' | 'recommended' | 'manual';

export interface SetupStepStatus {
  id: SetupStepId;
  state: SetupStepState;
  required: boolean;
  /** Resumo do que falta ou de onde veio a confirmação. */
  detail: string;
  /** Confirmado pelo diagnóstico de uma máquina (e não marcado à mão). */
  verified: boolean;
}

interface SetupProgress {
  /** Versão do guia já aberta sozinha para este usuário. */
  seen?: number;
  /** Já mostrou o balão "fica tudo no seu menu". */
  menuTour?: number;
  /** Etapas que a pessoa marcou como feitas (sem executor não há como verificar). */
  manual?: Partial<Record<SetupStepId, boolean>>;
}

/** Balão do menu do usuário mostrado na primeira vez que o guia fecha. */
export const SETUP_MENU_TOUR: TourDefinition = {
  id: 'setup-menu',
  version: 1,
  title: 'Onde fica a configuração',
  doneText: 'Entendi',
  steps: [{
    id: 'user-menu', anchor: 'user-menu', group: 'Começo', since: 1, phase: 'entry', side: 'bottom', align: 'end',
    title: 'Tudo fica no seu menu',
    body: 'Aqui estão <b>Minhas integrações</b>, <b>Skills do Claude</b>, <b>Meus executores</b> e <b>Primeiros passos</b> — ' +
      'para voltar a este guia e ver o que ainda falta.'
  }]
};

const CHECK = {
  claude: 'Claude Code',
  login: 'Login do Claude Code',
  skills: 'Skills do PRMake',
  apiKey: 'api-key do usuário',
  dbAccess: 'Acesso aos bancos (SQL Server)'
};

/**
 * 0083: "Primeiros passos no PRMake" — o que falta para a pessoa analisar cards (integrações pessoais, Claude Code,
 * skills, bancos, executor), com o status de verdade: integrações pelo `configured` de cada plugin e a máquina pelo
 * diagnóstico (doctor) do executor. Abre sozinho no primeiro acesso de quem ainda não está pronto.
 */
@Injectable({ providedIn: 'root' })
export class SetupGuideService {
  private readonly integrationService = inject(UserIntegrationService);
  private readonly queue = inject(ExecutionQueueService);
  private readonly dialog = inject(MatDialog);
  private readonly tours = inject(GuidedTourService);
  private readonly router = inject(Router);
  private readonly userId = (inject(StorageService).getAccess()?.user?.externalId ?? 'anon').toLowerCase();

  readonly integrations = signal<UserIntegration[]>([]);
  readonly workers = signal<ExecutionWorker[]>([]);
  readonly loaded = signal(false);
  readonly loading = signal(false);
  readonly integrationsError = signal(false);
  readonly manual = signal<Partial<Record<SetupStepId, boolean>>>(this.read().manual ?? {});

  private autoChecked = false;
  private ref?: MatDialogRef<unknown>;

  /** A máquina que mais diz sobre a configuração: ativa, online e com diagnóstico mais recente. */
  readonly worker = computed<ExecutionWorker | null>(() => {
    const list = this.workers().filter((w) => w.status !== 'revoked');
    const score = (w: ExecutionWorker) => (w.online ? 2 : 0) + (w.status === 'active' ? 1 : 0);
    return [...list].sort((a, b) => score(b) - score(a) || (b.doctorAt ?? b.lastSeenAt ?? '').localeCompare(a.doctorAt ?? a.lastSeenAt ?? ''))[0] ?? null;
  });

  readonly steps = computed<SetupStepStatus[]>(() => [
    this.integrationsStep(),
    this.machineStep('claude', [CHECK.claude, CHECK.login], 'Claude Code instalado e logado'),
    this.machineStep('skills', [CHECK.skills, CHECK.apiKey], 'Skills instaladas e api-key válida'),
    this.databasesStep(),
    this.executorStep()
  ]);

  readonly requiredTotal = computed(() => this.steps().filter((s) => s.required).length);
  readonly requiredDone = computed(() => this.steps().filter((s) => s.required && s.state === 'done').length);
  readonly complete = computed(() => this.loaded() && this.requiredDone() === this.requiredTotal());

  step(id: SetupStepId): SetupStepStatus {
    return this.steps().find((s) => s.id === id)!;
  }

  /** Lê integrações e máquinas. Falha em uma não impede a outra. */
  async refresh(): Promise<void> {
    this.loading.set(true);
    const [integrations, workers] = await Promise.allSettled([
      this.integrationService.loadIntegrations(),
      firstValueFrom(this.queue.myWorkers())
    ]);
    if (integrations.status === 'fulfilled') this.integrations.set(integrations.value);
    this.integrationsError.set(integrations.status === 'rejected');
    if (workers.status === 'fulfilled') this.workers.set(workers.value ?? []);
    this.loaded.set(integrations.status === 'fulfilled');
    this.loading.set(false);
  }

  setManual(id: SetupStepId, value: boolean): void {
    const manual = { ...this.manual(), [id]: value };
    this.manual.set(manual);
    this.write({ ...this.read(), manual });
  }

  /**
   * Primeiro acesso: quem ainda não está pronto e não viu esta versão do guia recebe o guia aberto. Quem já está pronto
   * é marcado sem ver nada. Enquanto decide, segura os tours de tela (o da tela do card não abre por cima).
   */
  async maybeAutoOpen(): Promise<void> {
    if (this.autoChecked) return;
    this.autoChecked = true;
    const progress = this.read();
    if ((progress.seen ?? 0) >= SETUP_GUIDE_VERSION) return;
    this.tours.held.set(true);
    try {
      await this.refresh();
      if (!this.loaded()) return;
      if (this.complete()) {
        this.write({ ...this.read(), seen: SETUP_GUIDE_VERSION });
        return;
      }
      // Espera a tela assentar: nada de abrir por cima de outro diálogo ou de um tour (até ~1 min).
      for (let i = 0; i < 40 && (this.tours.running() || this.dialogOpen()); i++) await new Promise((r) => setTimeout(r, 1500));
      if (this.tours.running() || this.dialogOpen()) return;
      this.open();
    } finally {
      this.tours.held.set(false);
    }
  }

  async open(): Promise<void> {
    if (this.ref) return;
    this.write({ ...this.read(), seen: SETUP_GUIDE_VERSION });
    const { SetupGuideDialogComponent } = await import('./setup-guide-dialog.component');
    this.ref = this.dialog.open(SetupGuideDialogComponent, {
      width: '860px',
      maxWidth: '96vw',
      maxHeight: '92vh',
      panelClass: 'custom-dialog-container',
      autoFocus: false
    });
    this.ref.afterClosed().subscribe((result) => {
      this.ref = undefined;
      if (result === 'card') {
        void this.router.navigate(['/auth/workbench']);
        return;
      }
      this.showMenuOnce();
    });
  }

  /** Na primeira vez que o guia fecha: balão no menu do usuário (onde ficam as telas de configuração). */
  private showMenuOnce(): void {
    const progress = this.read();
    if ((progress.menuTour ?? 0) >= SETUP_MENU_TOUR.version) return;
    setTimeout(() => {
      if (this.tours.running() || this.dialogOpen() || !document.querySelector('[data-tour="user-menu"]')) return;
      this.write({ ...this.read(), menuTour: SETUP_MENU_TOUR.version });
      this.tours.start(SETUP_MENU_TOUR, { hasCard: () => false });
    }, 350);
  }

  // ── Etapas ────────────────────────────────────────────────────────────────────────────────────

  private integrationsStep(): SetupStepStatus {
    const list = this.integrations();
    const required = list.filter((i) => !i.optional);
    const missing = required.filter((i) => !i.configured);
    if (!this.loaded()) {
      return { id: 'integrations', state: 'pending', required: true, verified: false,
        detail: this.integrationsError() ? 'Não consegui ler as suas integrações agora.' : 'Verificando…' };
    }
    if (missing.length) {
      return { id: 'integrations', state: 'pending', required: true, verified: true,
        detail: `Falta${missing.length === 1 ? '' : 'm'}: ${missing.map((i) => i.description).join(', ')}` };
    }
    const optional = list.filter((i) => i.optional);
    const optionalDone = optional.filter((i) => i.configured).length;
    return { id: 'integrations', state: 'done', required: true, verified: true,
      detail: `Obrigatórias prontas${optional.length ? ` · opcionais ${optionalDone}/${optional.length}` : ''}` };
  }

  /** Etapa da máquina: confirmada pelo doctor do executor; sem executor, só marcada à mão. */
  private machineStep(id: SetupStepId, checks: string[], okText: string): SetupStepStatus {
    const doctor = this.worker()?.doctor ?? [];
    const found = checks.map((name) => doctor.find((c) => c.name === name)).filter((c): c is ExecutionDoctorCheck => !!c);
    if (found.length === checks.length) {
      const bad = found.filter((c) => !c.ok);
      if (!bad.length) return { id, state: 'done', required: true, verified: true, detail: `${okText} (diagnóstico de ${this.worker()!.name})` };
      return { id, state: 'pending', required: true, verified: true, detail: bad.map((c) => `${c.name}: ${c.message ?? 'falhou'}`).join(' · ') };
    }
    if (this.manual()[id]) return { id, state: 'done', required: true, verified: false, detail: 'Marcado por você — o executor confirma quando for instalado' };
    return { id, state: 'manual', required: true, verified: false, detail: 'Depois de instalar, marque como feito (o executor confirma sozinho)' };
  }

  private databasesStep(): SetupStepStatus {
    const doctor = this.worker()?.doctor ?? [];
    const banks = doctor.filter((c) => c.name.startsWith('Banco '));
    const access = doctor.find((c) => c.name === CHECK.dbAccess);
    if (banks.some((c) => c.ok)) {
      return { id: 'databases', state: 'done', required: false, verified: true,
        detail: `Acessível: ${banks.filter((c) => c.ok).map((c) => c.name.replace('Banco ', '')).join(', ')}` };
    }
    if (access && !access.ok) return { id: 'databases', state: 'recommended', required: false, verified: true, detail: 'Sem credenciais dos bancos nesta máquina' };
    if (banks.length) return { id: 'databases', state: 'recommended', required: false, verified: true, detail: 'Bancos sem acesso — VPN conectada?' };
    if (this.manual().databases) return { id: 'databases', state: 'done', required: false, verified: false, detail: 'Marcado por você' };
    return { id: 'databases', state: 'recommended', required: false, verified: false, detail: 'Recomendado: sem isso a análise para quando precisa de dados' };
  }

  private executorStep(): SetupStepStatus {
    const w = this.worker();
    if (!w) return { id: 'executor', state: 'pending', required: true, verified: true, detail: 'Nenhuma máquina registrada' };
    if (w.status === 'paused') return { id: 'executor', state: 'pending', required: true, verified: true, detail: `${w.name} está pausada` };
    if (!w.online) return { id: 'executor', state: 'pending', required: true, verified: true, detail: `${w.name} está offline — a máquina está ligada?` };
    const errors = (w.doctor ?? []).filter((c) => !c.ok && c.severity !== 'warning');
    if (errors.length) {
      return { id: 'executor', state: 'pending', required: true, verified: true,
        detail: `${w.name} online, ${errors.length} problema${errors.length === 1 ? '' : 's'} no diagnóstico` };
    }
    return { id: 'executor', state: 'done', required: true, verified: true, detail: `${w.name} online${w.agentVersion ? ` · executor ${w.agentVersion}` : ''}` };
  }

  // ── Interno ───────────────────────────────────────────────────────────────────────────────────

  private dialogOpen(): boolean {
    return !!document.querySelector('.cdk-overlay-container .mat-mdc-dialog-container');
  }

  private key(): string {
    return `prmake.setup.${this.userId}`;
  }

  private read(): SetupProgress {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key()) ?? 'null');
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  private write(progress: SetupProgress): void {
    try { localStorage.setItem(this.key(), JSON.stringify(progress)); } catch { /* sem storage: só não lembra */ }
  }
}
