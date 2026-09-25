import { TeamsService } from '../../../services/teams.service';
import {ChangeDetectorRef, Component, effect, HostListener, inject, OnDestroy, OnInit, untracked, ViewChild} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatInputModule } from '@angular/material/input';
import {MatTooltipModule} from '@angular/material/tooltip';
import {FormsModule} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {HttpClient} from '@angular/common/http';
import {ActivatedRoute} from '@angular/router';
import {MatDialog} from '@angular/material/dialog';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {LoadingBarModule, LoadingBarService} from '@ngx-loading-bar/core';
import {SelectButtonModule} from 'primeng/selectbutton';
import {InputGroupModule} from 'primeng/inputgroup';
import {InputGroupAddonModule} from 'primeng/inputgroupaddon';
import {ButtonModule} from 'primeng/button';
import {MenuModule} from 'primeng/menu';
import {InputNumberModule} from 'primeng/inputnumber';
import {LMarkdownEditorModule} from 'ngx-markdown-editor';
import {SplitButton} from 'primeng/splitbutton';
import {AutoCompleteModule} from 'primeng/autocomplete';
import {MenuItem, MenuItemCommandEvent} from 'primeng/api';
import {MatFormFieldModule} from '@angular/material/form-field';
import {UserService} from '../../../services/UserService.service';
import {CliipboardService} from '../../../services/cliipboard.service';
import {environment} from '../../../../environments/environment';
import {DialogTemplateComponent} from '../../../components/dialog-template/dialog-template.component';
import {DialogPrompt, DialogPromptData} from '../../../components/dialog-prompt/dialog-prompt';
import {StorageService} from '../../../services/storage.service';
import {GlobalService} from '../../../services/global.service';
import {Subscription, firstValueFrom} from 'rxjs';
import {tap} from 'rxjs/internal/operators/tap';
import {GdsService} from '../../../services/gds.service';
import {WsService} from '../../../services/ws.service';
import {JsonPipe} from '@angular/common';
import {AuthService} from '../../../services/auth.service';
import {CardTimelineComponent} from '../../../components/card-timeline/card-timeline.component';
import {CardAlertBarComponent} from '../../../components/card-alert-bar/card-alert-bar.component';
import {CardDetailsDialogComponent} from '../../../components/card-details-dialog/card-details-dialog.component';
import {HandoverDialogComponent} from '../../../components/handover-dialog/handover-dialog.component';
import {CardFull} from '../../../components/card-details-dialog/card-full.model';
import {marked} from 'marked';
import {CardPanelComponent} from '../../../components/card-panel/card-panel.component';
import {PrInfoCardComponent} from '../../../components/pr-info-card/pr-info-card.component';
import {PanelPopoverButtonComponent} from '../../../components/panel-popover-button/panel-popover-button.component';
import {GithubPrListComponent} from '../../../components/github-pr-list/github-pr-list.component';
import {UserIntegrationService} from '../../../services/user-integration.service';
import {MyIntegrationsDialogComponent} from '../../../components/my-integrations-dialog/my-integrations-dialog.component';
import {OpenPrDialogComponent, OpenPrDialogData} from '../../../components/open-pr-dialog/open-pr-dialog.component';
import {GithubPullRequest, PullRequestService} from '../../../services/pull-request.service';
import {CardPrStateService} from '../../../services/card-pr-state.service';
import {RepoOption} from '../../../interfaces/RepoOption';
import {DevOpsActionsMenuComponent} from '../../../components/devops-actions-menu/devops-actions-menu.component';
import {SummaryDialogComponent, SummaryDialogData} from '../../../components/summary-dialog/summary-dialog.component';

/** Evento e grupo do tempo real da configuração de PR (em sincronia com o backend). */
const PULLREQUEST_CONFIG_GROUP = 'pullrequest-config';
const PULLREQUEST_CONFIG_EVENT = 'pullRequestConfigUpdated';

/**
 * Tempo real do card aberto (PullRequestRealTimeEvents no backend): registro salvo e PRs do
 * GitHub abertos/atualizados/com status novo — pela tela, por outro usuário ou pela skill gerar-prmake.
 */
const PULLREQUEST_CARD_EVENT = 'pullRequestCardUpdated';
const pullRequestCardGroup = (card: string) => `pullrequest:${card.trim()}`;

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
  providers: [HttpClient],
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatInputModule,
    MatDividerModule,
    MatTooltipModule,
    FormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    LoadingBarModule,
    SelectButtonModule,
    InputGroupModule,
    InputGroupAddonModule,
    ButtonModule,
    MenuModule,
    InputNumberModule,
    SplitButton,
    JsonPipe,
    AutoCompleteModule,
    MatFormFieldModule,
    CardTimelineComponent,
    CardAlertBarComponent,
    CardPanelComponent,
    PrInfoCardComponent,
    PanelPopoverButtonComponent,
    GithubPrListComponent,
    DevOpsActionsMenuComponent
  ]
})
export class RegisterComponent implements OnInit, OnDestroy {

  @ViewChild(CardTimelineComponent) timeline?: CardTimelineComponent;

  /** Descrição/root cause compartilhados com modal, popovers e IA (fonte da verdade dos editores). */
  readonly prState = inject(CardPrStateService);
  /** Integrações de uso pessoal (feature 0002): com pendência, a tela fica bloqueada. */
  readonly integrations = inject(UserIntegrationService);
  /** Pedido de aprovação no Teams (0007): o botão da lista de PRs depende deste status. */
  private teams = inject(TeamsService);
  private prService = inject(PullRequestService);

  cardFull: CardFull | null = null;
  isCardDetailsLoading = false;

  environmentName = 'development';
  template:any = null;
  pullRequest:any = {};
  urlBase = environment.apiUrl;
  isTemplateLoading = false;
  isPullRequestLoading = false;
  // Enquanto as configurações (branches p/ PR e repositórios) do plugin não chegam,
  // mostramos skeletons no mesmo estilo shimmer da linha do tempo.
  isConfigLoading = true;
  readonly dialog = inject(MatDialog);
  private configurationService = inject(GdsService);
  userSelected: any = null;
  cardNumber: null | string = null;
  fullDescription = null;
  mobileButtons: MenuItem[] = [];
  copyCustomButtons: MenuItem[] = [];
  isMobile = false;
  isAzureLoading: boolean = false;

  // Defaults do modal "Abrir PR" (branch/repositório/destino não ficam mais na tela — spec 2).
  // Guardam a última escolha feita no modal.
  branchPrefix: string = 'hotfix/';
  branchName: string = '';

  // Metadados do PR encontrado (quem abriu, quando abriu, última atualização).
  // null quando não há registro salvo — nesse caso o card de infos não aparece.
  /**
   * Bloqueia a tela enquanto houver integração pessoal pendente (GitHub/Azure com o token do
   * usuário). Status desconhecido (falha ao consultar) não bloqueia: o backend também barra (403).
   */
  get integrationsBlocked(): boolean {
    return this.integrations.status()?.ready === false;
  }

  openMyIntegrations() {
    this.dialog.open(MyIntegrationsDialogComponent, {
      width: '640px',
      maxWidth: '94vw',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container'
    });
  }

  /** A busca do registro do card falhou (a barra aparece mesmo assim, com o aviso). */
  prLoadError = false;

  /** Grupo de tempo real do card em tela (null quando nenhum card foi buscado). */
  private currentCardGroup: string | null = null;
  private resyncSub?: Subscription;

  /** Rótulo do autor na barra do card conforme o estado da busca. */
  get infoAuthorLabel(): string {
    if (this.prLoadError) return 'Não foi possível carregar o card salvo';
    if (this.prInfo && !this.prInfo.openedAt) return 'Card ainda não salvo';
    return 'Aberto por';
  }

  prInfo: {
    openedAt: string | null;
    updatedAt: string | null;
    userName: string;
    userPhoto: string | null;
  } | null = null;

  repositoryOptions: RepoOption[] = [];
  // Objeto selecionado, ou o texto digitado enquanto nenhuma opção foi escolhida.
  selectedRepositoryObj: RepoOption | string | null = null;

  justifyOptions = [
    {
      label: 'DEV',
      value: 'dev'
    }
  ]

  cardTypeOptions = [
    {
      label: 'Bug',
      value: 'bug'
    },
    {
      label: 'User Story',
      value: 'us'
    }
  ]
  configurations: any = {};




  /**
   * Habilita o botão "Limpar" assim que o usuário preencher/carregar qualquer coisa:
   * número do card, branch, descrição, root cause, descrição montada, detalhes do card
   * (DevOps) ou linha do tempo.
   */
  get hasAnythingToClear(): boolean {
    const hasText = (v: any) => typeof v === 'string' && v.trim().length > 0;
    return !!(
      this.cardNumber ||
      hasText(this.branchName) ||
      hasText(this.pullRequest?.description) ||
      hasText(this.pullRequest?.rootCause) ||
      this.fullDescription ||
      this.cardFull
    );
  }

  /**
   * Há alguma não conformidade no card carregado do DevOps? (qualquer alerta de
   * preenchimento pendente). Usado para piscar o cabeçalho e chamar a atenção.
   */
  get hasCardNonConformity(): boolean {
    const a = this.cardFull?.alerts;
    if (!a) return false;
    return !!(
      a.missingRootCause ||
      a.missingResolutionType ||
      a.missingGeneralClassification ||
      a.missingClassification ||
      a.remainingNotZero
    );
  }

  @HostListener('window:resize')
  onResize() {
    this.checkIfMobile();
  }

  private checkIfMobile() {
    this.isMobile = window.innerWidth <= 768;
  }

  private initializeMobileButtons() {
    this.mobileButtons = [
      {
        label: 'Copiar',
        icon: 'pi pi-copy',
        command: (event: MenuItemCommandEvent) => {
          this.copyFullDescriptionToClipboard();
        }
      },
      {
        label: 'Abrir PR',
        icon: 'pi pi-github',
        command: (event: MenuItemCommandEvent) => {
          this.openPrDialog();
        }
      },
      {
        label: 'Limpar',
        icon: 'pi pi-times',
        command: (event: MenuItemCommandEvent) => {
          this.clearAll();
        }
      },
      {
        label: 'Ações DevOps',
        disabled: true,
        icon: 'pi pi-cloud-upload',
      },
      {
        label: 'Gerar com IA',
        icon: 'pi pi-bullseye',
        disabled: true,
      },
    ];
  }

  updateMobileButtonsState() {
    this.mobileButtons.forEach(button => {
      if (button.label === 'Copiar') {
        button.disabled = this.isPullRequestLoading || this.fullDescription === null;
      } else if (button.label === 'Abrir PR') {
        button.disabled = !this.canOpenPr;
      } else if (button.label === 'Limpar') {
        button.disabled = this.isPullRequestLoading || !this.hasAnythingToClear;
      }
    });
  }




  private _snackBar = inject(MatSnackBar);
  private _clipboardService = inject(CliipboardService);
  private _globalService = inject(GlobalService);
  private route = inject(ActivatedRoute);

  constructor(
    private http: HttpClient,
    private loadingBar: LoadingBarService,
    private storageService: StorageService,
    private cdr: ChangeDetectorRef,
    private ws: WsService,
    private authService: AuthService,
  ) {
    // Edições feitas nos painéis (aqui, no modal ou nos popovers) chegam pelo estado
    // compartilhado; espelha no modelo local usado por salvar/copiar/abrir PR.
    effect(() => {
      const description = this.prState.description();
      const rootCause = this.prState.rootCause();
      untracked(() => this.onSharedContentChange(description, rootCause));
    });
  }

  private onSharedContentChange(description: string | null, rootCause: string | null) {
    const current = this.pullRequest ?? {};
    if ((current.description ?? null) === description && (current.rootCause ?? null) === rootCause) return;

    this.pullRequest.description = description ?? undefined;
    this.pullRequest.rootCause = rootCause ?? undefined;
    this.generateFullDescriptionHandler();
    this.cdr.detectChanges();
  }

  async ngOnInit() {
    try {
      await Promise.all([
        firstValueFrom(this.getPullRequestConfigurations()),
      ]);

      // Agora que as configs chegaram, prossegue
      //this.getTemplateByEnvironment();
      this.checkIfMobile();
      this.initializeMobileButtons();
      this.initializeCustomCopyButtons();

      this.userSelected = this.storageService.getAccess().user;
      console.log(this.userSelected);
      this.initAiGeneratedListener();
      this.initializeBranchConfigurations();
      this.initRealtimeConfig();

      // Status das integrações pessoais antes de buscar: com pendência a tela fica bloqueada
      // e não adianta disparar a busca (as chamadas ao GitHub/Azure dariam 403).
      if (!this.integrations.status()) await this.integrations.loadStatus();
      // Teams é opcional (0007): não bloqueia a tela, só habilita o "Pedir aprovação".
      void this.teams.loadStatus();

      // Card vindo por querystring (ex.: atalho "últimos cards" da home): já preenche
      // o número e dispara a busca, o mesmo comportamento do botão "Buscar".
      if (!this.integrationsBlocked) this.autoSearchFromQueryParams();

    } catch (error) {
      console.error('Falha ao inicializar configurações', error);
    } finally {
      // App é zoneless: sem detectChanges o skeleton ficaria preso mesmo com os dados prontos.
      this.isConfigLoading = false;
      this.cdr.detectChanges();
    }


  }

  ngOnDestroy(): void {
    this.ws.removeFromGroup(PULLREQUEST_CONFIG_GROUP);
    this.ws.off(PULLREQUEST_CONFIG_EVENT, this.onPullRequestConfigUpdated);
    this.switchCardGroup(null);
    this.ws.off(PULLREQUEST_CARD_EVENT, this.onCardUpdated);
    this.resyncSub?.unsubscribe();
  }

  /** Troca a inscrição de tempo real para o card em tela. */
  private switchCardGroup(card: string | null): void {
    const group = card ? pullRequestCardGroup(card) : null;
    if (group === this.currentCardGroup) return;
    if (this.currentCardGroup) this.ws.removeFromGroup(this.currentCardGroup);
    if (group) this.ws.addToGroup(group);
    this.currentCardGroup = group;
  }

  /**
   * Evento de tempo real do card em tela. Registro salvo → recarrega descrição/RC/autor
   * (ou avisa, se houver edição local não salva); PRs → recarrega a lista (sem ir ao GitHub).
   */
  private onCardUpdated = (payload: any): void => {
    const card = this.cardNumber?.toString();
    if (!card || payload?.cardNumber !== card.trim()) return;

    if (payload.action === 'register-saved') {
      this.reloadRegisterFromServer();
    } else if (payload.action === 'summary-saved') {
      this.applyServerSummary();
    } else {
      this.reloadGithubPrs();
    }
  };

  /** Recarrega os PRs do card do banco (o status já foi atualizado por quem emitiu o evento). */
  private reloadGithubPrs(): void {
    const card = this.cardNumber?.toString();
    if (!card) return;
    this.prService.listGithubPrs(card, false).subscribe({
      next: (prs) => {
        if (this.prState.cardNumber() === card) this.prState.setGithubPrs(prs ?? []);
      },
      error: (e) => console.error('Falha ao recarregar os PRs do card', e),
    });
  }

  /**
   * O registro do card foi salvo em outro lugar (outro usuário, skill gerar-prmake…). Sem edição
   * local pendente, recarrega em silêncio; com edição pendente, pergunta antes de descartar.
   */
  private reloadRegisterFromServer(): void {
    // Durante a busca/salvamento desta própria tela o eco do evento é ignorado.
    if (this.isPullRequestLoading || !this.cardNumber) return;

    const saved = this.prState.register();
    const dirty =
      (this.prState.description() ?? '') !== (saved?.description ?? '') ||
      (this.prState.rootCause() ?? '') !== (saved?.rootCause ?? '');

    if (!dirty) {
      this.applyServerRegister();
      return;
    }

    const ref = this._snackBar.open('Este card foi atualizado em outro lugar. Suas alterações não salvas serão perdidas se recarregar.',
      'Recarregar', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top", duration: 15000});
    ref.onAction().subscribe(() => this.applyServerRegister());
  }

  /** Resumo não técnico salvo (0011): atualiza só o resumo, sem mexer em descrição/RC em edição. */
  private applyServerSummary(): void {
    const card = this.cardNumber?.toString();
    if (!card) return;
    this.prService.getByCardNumber(card).subscribe({
      next: (response: any) => {
        if (!response || this.cardNumber?.toString() !== card) return;
        this.applySummary(response);
      },
      error: (e) => console.error('Falha ao recarregar o resumo do card', e),
    });
  }

  private applySummary(register: any): void {
    this.pullRequest.id = register.id ?? this.pullRequest.id;
    this.pullRequest.summary = register.summary ?? null;
    this.pullRequest.summaryCommentId = register.summaryCommentId ?? null;
    this.pullRequest.summaryUpdatedAt = register.summaryUpdatedAt ?? null;
    this.pullRequest.summaryPublishedAt = register.summaryPublishedAt ?? null;
    this.cdr.detectChanges();
  }

  private applyServerRegister(): void {
    const card = this.cardNumber?.toString();
    if (!card) return;
    this.prService.getByCardNumber(card).subscribe({
      next: (response) => {
        if (!response || this.cardNumber?.toString() !== card) return;
        this.pullRequest = response;
        this.prLoadError = false;
        this.loadPrAuthorInfo(response);
        this.prState.loadRegister(card, response);
        this.generateFullDescriptionHandler();
        this.cdr.detectChanges();
      },
      error: (e) => console.error('Falha ao recarregar o card', e),
    });
  }

  /**
   * Lê o card (e opcionalmente o repositório) da querystring e reproduz o clique em "Buscar":
   * preenche o número, seleciona o repositório correspondente quando informado e carrega
   * PR, detalhes do DevOps e linha do tempo daquele card.
   */
  private autoSearchFromQueryParams(): void {
    const params = this.route.snapshot.queryParamMap;
    const card = params.get('card');
    if (!card) return;

    const repositoryId = params.get('repositoryId');
    if (repositoryId) {
      const match = this.repositoryOptions.find(r => r.value === repositoryId);
      if (match) this.selectedRepositoryObj = match;
    }

    this.cardNumber = card;
    this.onCardNumberChange();
    this.cdr.detectChanges();

    // setTimeout garante que os @ViewChild (ex.: linha do tempo) já estejam resolvidos
    // antes de disparar a busca — o mesmo caminho do botão "Buscar".
    setTimeout(() => this.getPullRequestByCardNumber());
  }

  /** Atualização em tempo real: repositórios/branches mudam para todos na tela de PR. */
  private initRealtimeConfig(): void {
    this.ws.startConnection();
    this.ws.addToGroup(PULLREQUEST_CONFIG_GROUP);
    this.ws.on(PULLREQUEST_CONFIG_EVENT, this.onPullRequestConfigUpdated);
    this.ws.on(PULLREQUEST_CARD_EVENT, this.onCardUpdated);
    this.resyncSub = this.ws._resynced.subscribe(this.onRealtimeResynced);
  }

  /**
   * A conexão de tempo real voltou depois de cair: os eventos da queda se perderam, então recarrega
   * o que eles atualizariam (configurações, registro — respeitando edição não salva — e PRs).
   */
  private onRealtimeResynced = (): void => {
    this.onPullRequestConfigUpdated();
    if (this.cardNumber) {
      this.reloadRegisterFromServer();
      this.reloadGithubPrs();
    }
  };

  private onPullRequestConfigUpdated = (): void => {
    firstValueFrom(this.getPullRequestConfigurations())
      .then(() => this.reapplyPullRequestConfigurations())
      .catch((e) => console.error('Falha ao atualizar configurações em tempo real', e));
  };

  /** Re-aplica repositórios/branches preservando a seleção atual do usuário quando possível. */
  private reapplyPullRequestConfigurations(): void {
    const prevRepoValue = typeof this.selectedRepositoryObj === 'string'
      ? this.selectedRepositoryObj
      : this.selectedRepositoryObj?.value ?? null;
    const prevEnv = this.environmentName;

    const activeBranchsStr = this.configurations.PullRequest?.ActiveBranchs;
    if (activeBranchsStr) {
      try {
        const rawBranches = eval(activeBranchsStr);
        this.justifyOptions = rawBranches.map((branch: any) => ({
          label: branch.label,
          value: branch.branchName
        }));
        if (prevEnv && this.justifyOptions.length > 0 &&
            !this.justifyOptions.some((o: any) => o.value === prevEnv)) {
          this.environmentName = this.justifyOptions[0].value;
        }
      } catch (error) {
        console.error('Erro ao processar ActiveBranchs:', error);
      }
    }

    const activeRepositoriesStr = this.configurations.PullRequest?.ActiveRepositories;
    if (activeRepositoriesStr) {
      try {
        this.repositoryOptions = JSON.parse(activeRepositoriesStr);
        const stillThere = prevRepoValue
          ? this.repositoryOptions.find(r => r.value === prevRepoValue)
          : undefined;
        this.selectedRepositoryObj =
          stillThere ?? (this.repositoryOptions.length > 0 ? this.repositoryOptions[0] : null);
      } catch (error) {
        console.error('Erro ao processar ActiveRepositories:', error);
      }
    }

    this.cdr.detectChanges();
  }

  initializeBranchConfigurations(){
    const activeBranchsStr = this.configurations.PullRequest.ActiveBranchs;
    if (activeBranchsStr) {
      try {
        const rawBranches = eval(activeBranchsStr);
        this.justifyOptions = rawBranches.map((branch: any) => ({
          label: branch.label,
          value: branch.branchName
        }));
        this.cdr.detectChanges();
      } catch (error) {
        console.error('Erro ao processar ActiveBranchs:', error);
      }
    }

    const activeRepositoriesStr = this.configurations.PullRequest.ActiveRepositories;
    if (activeRepositoriesStr) {
      try {
        this.repositoryOptions = JSON.parse(activeRepositoriesStr);
        if (this.repositoryOptions.length > 0) {
          this.selectedRepositoryObj = this.repositoryOptions[0];
        }
        this.cdr.detectChanges();
      } catch (error) {
        console.error('Erro ao processar ActiveRepositories:', error);
      }
    }
  }

  getPullRequestConfigurations(){
    return this.configurationService.getAllById(9).pipe(
      tap((response: any) => {
        this.configurations.PullRequest = response.configurations;
      })
    );
  }

  initAiGeneratedListener() {
    this._globalService.onAiGenerated.subscribe((data: any) => {
      if(data) {
        this.pullRequest.description = data.pullRequestDescriptionAiGenerated;
        this.pullRequest.rootCause = data.rootCauseAnalysisAiGenerated;
        this.prState.setContent(this.pullRequest.description ?? null, this.pullRequest.rootCause ?? null);
        this.generateFullDescriptionHandler();
        this.cdr.detectChanges();
      }
    })
  }

  clearAll() {
    this.environmentName = 'development';
    this.template = null;
    this.pullRequest = {};
    this.prState.reset();
    this.cardNumber = null;
    this.fullDescription = null;
    // Zera os detalhes do DevOps para também apagar as não conformidades (para o pisca do cabeçalho).
    this.cardFull = null;
    this.prInfo = null;
    this.prLoadError = false;
    this.switchCardGroup(null);
    this.branchPrefix = 'hotfix/';
    this.branchName = '';
    this.selectedRepositoryObj = this.repositoryOptions.length > 0 ? this.repositoryOptions[0] : null;
    this.cardType = '';
  }

  /**
   * Salva o registro do card (spec 1.5): sem exigir descrição/root cause e sem branch/repositório,
   * que agora pertencem a cada PR do GitHub. null mantém o valor salvo; vazio limpa.
   */
  savePullRequest() {
    if (!this.cardNumber) return;
    this.isPullRequestLoading = true;
    this.loadingBar.start();

    this.prService.saveCard({
      cardNumber: this.cardNumber.toString(),
      userId: this.userSelected.externalId,
      formId: 1,
      description: this.prState.description(),
      rootCause: this.prState.rootCause(),
    }).subscribe({
      next: (saved) => {
        this._snackBar.open('Card salvo com sucesso!', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"});
        // Atualiza autor/datas da barra com o que acabou de ser gravado e marca o conteúdo
        // atual como "salvo" (base para detectar edição pendente nos eventos de tempo real).
        this.prLoadError = false;
        this.loadPrAuthorInfo(saved);
        this.prState.register.set({ ...saved, githubPullRequests: this.prState.githubPrs() });
        // Card recém-criado passa a ter id (libera o resumo não técnico sem buscar de novo — 0011).
        const s: any = saved;
        this.pullRequest = {
          ...this.pullRequest,
          id: s.id,
          summary: s.summary ?? this.pullRequest.summary ?? null,
          summaryCommentId: s.summaryCommentId ?? this.pullRequest.summaryCommentId ?? null,
          summaryUpdatedAt: s.summaryUpdatedAt ?? this.pullRequest.summaryUpdatedAt ?? null,
          summaryPublishedAt: s.summaryPublishedAt ?? this.pullRequest.summaryPublishedAt ?? null,
        };
        this.isPullRequestLoading = false;
        this.loadingBar.stop();
        this.cdr.detectChanges();
      },
      error: (error) => {
        this._snackBar.open(error?.error?.error ?? 'Erro ao tentar salvar o card', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"});
        this.isPullRequestLoading = false;
        this.loadingBar.stop();
        this.cdr.detectChanges();
      }
    });
  }

  /**
   * Atualiza a lista de PRs do card com o status atual no GitHub (uma chamada; o backend
   * só consulta os PRs abertos, em paralelo, e devolve o persistido para MERGED/CLOSED).
   */
  refreshGithubPrs(force = false) {
    const cardNumber = this.cardNumber?.toString();
    if (!cardNumber) return;

    this.prState.githubPrsLoading.set(true);
    // force (botão ⟳): ignora o cache de 60 s do status no backend.
    this.prService.listGithubPrs(cardNumber, true, force).subscribe({
      next: (prs) => {
        // Descarta a resposta se o usuário já trocou de card.
        if (this.prState.cardNumber() === cardNumber) this.prState.setGithubPrs(prs ?? []);
        this.prState.githubPrsLoading.set(false);
      },
      error: () => this.prState.githubPrsLoading.set(false),
    });
  }

  /** "Abrir PR" disponível depois que o card foi buscado. */
  get canOpenPr(): boolean {
    return !!this.cardNumber && !!this.prInfo && !this.isPullRequestLoading;
  }

  /** Repositório padrão (último escolhido no modal / querystring / primeiro da configuração). */
  private get defaultRepositoryValue(): string | null {
    return typeof this.selectedRepositoryObj === 'string'
      ? this.selectedRepositoryObj
      : this.selectedRepositoryObj?.value ?? null;
  }

  /** PR do GitHub mais recente do card (a lista vem ordenada do mais novo para o mais antigo). */
  private get latestGithubPr(): GithubPullRequest | null {
    return this.prState.githubPrs()[0] ?? null;
  }

  /**
   * Abre o modal "Abrir PR" (spec 1.1). Com `pr`, abre em modo edição com os dados daquele PR (3.1).
   */
  openPrDialog(pr?: GithubPullRequest) {
    if (!this.cardNumber) return;

    // Registro LEGACY (sem PR no GitHub): abre em modo criação já com repositório/branch dele;
    // o backend promove o registro quando o PR é aberto.
    const legacy = pr?.status === 'LEGACY' ? pr : null;
    if (legacy) pr = undefined;

    const data: OpenPrDialogData = {
      cardNumber: this.cardNumber.toString(),
      cardType: this.cardType,
      userId: this.userSelected?.externalId,
      targetOptions: this.justifyOptions,
      defaultTarget: this.environmentName,
      defaultPrefix: legacy?.branchPrefix ?? this.branchPrefix,
      defaultBranchName: legacy?.branchName ?? (this.branchName || this.cardNumber.toString()),
      defaultRepository: legacy?.repositoryId ?? this.defaultRepositoryValue,
      repositoryFallback: this.repositoryOptions,
      pr: pr ?? null,
    };

    this.dialog.open(OpenPrDialogComponent, {
      data,
      width: '980px',
      maxWidth: '94vw',
      maxHeight: '92vh',
      panelClass: 'custom-dialog-container'
    }).afterClosed().subscribe((result?: GithubPullRequest) => {
      if (!result) return;
      // Lembra a última escolha como default do próximo PR.
      this.branchPrefix = result.branchPrefix;
      this.branchName = result.branchName;
      this.environmentName = result.targetBranch;
      this.selectedRepositoryObj =
        this.repositoryOptions.find(r => r.value === result.repositoryId) ?? { label: result.repositoryId, value: result.repositoryId };
      this.cdr.detectChanges();
    });
  }

  saveRootCauseToDevOps() {
    this.isAzureLoading = true;
    this.loadingBar.start();

    // O campo de Root Cause no DevOps é HTML. Como o usuário escreve em markdown,
    // convertemos para HTML antes de enviar para que o conteúdo fique formatado
    // (evita ter que alternar o campo para markdown manualmente no DevOps).
    const rootCauseMarkdown = this.pullRequest.rootCause ?? '';
    marked.setOptions({ gfm: true, breaks: true });
    const rootCauseHtml = rootCauseMarkdown
      ? (marked.parse(rootCauseMarkdown) as string)
      : '';

    let model = {
      rootCause: rootCauseHtml,
    };

    this.http.post(`${this.urlBase}Azure/card/${this.cardNumber}/rootcause`, model).subscribe(
      x => {
        if(x)
          this._snackBar.open('RCA salvo com sucesso!', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"})

        this.isAzureLoading = false
        this.loadingBar.stop();

        // Reexecuta a busca do card para atualizar as não conformidades (o RC salvo
        // no DevOps resolve a pendência de root cause).
        if (this.cardNumber) {
          this.getPullRequestByCardNumber();
        }
      }, error => {
        this._snackBar.open('Erro ao tentar salvar RCA no DevOps', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"})

        this.isAzureLoading = false
        this.loadingBar.stop();
      }
    )

  }

  getTemplateByEnvironment() {
    this.isTemplateLoading = true;
    this.loadingBar.start();
    this.http.get(`${this.urlBase}Form/GetByEnvironment?enrironmentName=${this.environmentName.toUpperCase()}`).subscribe(
      (template:any) => {
        this.template = template;
        this.isTemplateLoading = false;
        this.generateFullDescriptionHandler();
        this.loadingBar.stop();
      }
    );
  }

  generatePullRequestWithAi() {
    // Um step por repositório com PR aberto (branch do PR mais recente de cada repo — a lista
    // vem do mais novo para o mais antigo). Sem PR, sugere o repositório/branch padrão.
    const repositories: { repository: string; branch: string }[] = [];
    for (const pr of this.prState.githubPrs()) {
      if (!repositories.some(r => r.repository === pr.repositoryId)) {
        repositories.push({ repository: pr.repositoryId, branch: `${pr.branchPrefix}${pr.branchName}` });
      }
    }
    const defaultBranch = repositories[0]?.branch ?? `${this.branchPrefix}${this.branchName}`;
    if (repositories.length === 0 && this.defaultRepositoryValue) {
      repositories.push({ repository: this.defaultRepositoryValue, branch: defaultBranch });
    }

    const data: DialogPromptData = {
      cardNumber: this.cardNumber,
      isAiGenerate: true,
      cardType: this.cardType,
      repositories,
      defaultBranch,
      repositoryFallback: this.repositoryOptions,
    };

    const dialogRef = this.dialog.open(DialogPrompt, {
      data,
      width: '920px',
      height: '82vh',
      maxWidth: '94vw',
      maxHeight: '90vh',
      panelClass: ['custom-dialog-container', 'ai-dialog-panel']
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.cardType = result.toLowerCase();

        if(this.cardType == 'us') {
          this.branchPrefix = 'feature/';
        }
        this.cdr.detectChanges();
      }
    });
  }


    /** Uma ação do menu "Ações DevOps" alterou o card: recarrega os detalhes e as pendências (0011). */
    onDevOpsActionDone() {
      this.loadCardDetails();
    }

    /**
     * Resumo não técnico (0011): abre com o resumo salvo (ver/editar/salvar/publicar) ou no contexto
     * que vai para a IA (card, discussion, timeline, PRs, diffs), para gerar um novo.
     */
    openSummaryDialog(prompt: string) {
      if (!this.cardNumber || !this.cardFull) return;

      const data: SummaryDialogData = {
        cardNumber: this.cardNumber.toString(),
        card: this.cardFull,
        reproField: this.configurations?.Azure?.RetroStepsFieldName || 'Microsoft.VSTS.TCM.ReproSteps',
        description: this.prState.description() ?? this.pullRequest?.description ?? '',
        rootCause: this.prState.rootCause() ?? this.pullRequest?.rootCause ?? '',
        summary: this.pullRequest?.summary ?? null,
        summaryUpdatedAt: this.pullRequest?.summaryUpdatedAt ?? null,
        summaryPublishedAt: this.pullRequest?.summaryPublishedAt ?? null,
        published: !!this.pullRequest?.summaryCommentId,
        timeline: this.timeline?.entries() ?? [],
        githubPrs: this.prState.githubPrs(),
        prompt,
      };

      this.dialog.open(SummaryDialogComponent, {
        data,
        width: '1000px',
        height: '86vh',
        maxWidth: '94vw',
        maxHeight: '92vh',
        panelClass: 'custom-dialog-container'
      }).afterClosed().subscribe((saved: any) => {
        if (saved) this.applySummary(saved);
      });
    }

    loadCardDetails()
    {
      if (!this.cardNumber) {
        this.cardFull = null;
        return;
      }

      this.isCardDetailsLoading = true;
      this.cardFull = null;

      this.http.get<CardFull>(`${this.urlBase}Azure/card/${this.cardNumber}/full`).subscribe(
        (response: any) => {
          // O backend retorna 200 com { error } quando o card não existe no DevOps.
          // Nesse caso tratamos como "não encontrado" para desabilitar Detalhes/Handover.
          const found = !!response && !response.error && !!response.id;
          this.cardFull = found ? response : null;
          this.isCardDetailsLoading = false;
          this.cdr.detectChanges();
        },
        () => {
          this.cardFull = null;
          this.isCardDetailsLoading = false;
          this.cdr.detectChanges();
        });
    }

    openCardDetails()
    {
      if (!this.cardFull) return;

      this.dialog.open(CardDetailsDialogComponent, {
        data: { card: this.cardFull, cardNumber: this.cardNumber },
        width: '1000px',
        height: '80vh',
        maxWidth: '92vw',
        maxHeight: '90vh',
        panelClass: 'custom-dialog-container'
      });
    }

    openHandover() {
      const repositoryId = this.latestGithubPr?.repositoryId ?? this.defaultRepositoryValue;

      this.dialog.open(HandoverDialogComponent, {
        data: {
          cardNumber: this.cardNumber,
          cardFull: this.cardFull,
          pullRequest: this.pullRequest,
          timeline: this.timeline?.entries() ?? [],
          repositoryId,
        },
        width: '1000px',
        height: '85vh',
        maxWidth: '92vw',
        maxHeight: '90vh',
        panelClass: 'custom-dialog-container'
      });
    }

    /**
     * Monta o card de infos do PR (quem abriu, datas) e resolve nome + foto do autor
     * pelo UserId (externalId). CreatedBy não é confiável (não é preenchido no banco),
     * por isso o nome vem do serviço de usuários.
     */
    private loadPrAuthorInfo(response: any): void {
      const userId = response?.userId;
      this.prInfo = {
        openedAt: response?.createdAt ?? null,
        updatedAt: response?.updatedAt ?? null,
        userName: '',
        userPhoto: null,
      };

      if (!userId) {
        this.cdr.detectChanges();
        return;
      }

      this.authService.getPhotosByExternalIds([userId]).subscribe({
        next: (res: any) => {
          const list = res?.object ?? res?.Object ?? [];
          const u = list.find((x: any) =>
            (x.externalId || x.ExternalId || '').toLowerCase() === String(userId).toLowerCase()
          ) ?? list[0];
          if (u && this.prInfo) {
            this.prInfo.userName = u.fullName || u.FullName || '';
            this.prInfo.userPhoto = u.imageUrl || u.ImageUrl || null;
          }
          this.cdr.detectChanges();
        },
        error: () => this.cdr.detectChanges(),
      });
    }

    getPullRequestByCardNumber()
    {
      this.isPullRequestLoading = true;
      this.loadingBar.start();
      // Zera o conteúdo do PR anterior: se o novo card não tiver registro salvo,
      // Descrição/Root Cause não podem manter os dados do card antigo.
      this.prInfo = null;
      this.prLoadError = false;
      this.pullRequest = {};
      this.prState.loadRegister(this.cardNumber?.toString() ?? null, null);
      this.fullDescription = null;

      // Tempo real do card: atualizações feitas em outro lugar (outro usuário, skill gerar-prmake).
      this.switchCardGroup(this.cardNumber?.toString() ?? null);

      // Carrega a linha do tempo e os detalhes do card (DevOps) em paralelo à busca do PR.
      this.timeline?.load(this.cardNumber ?? undefined);
      this.loadCardDetails();

      this.http.get(`${this.urlBase}PullRequest/GetByCardNumber?cardNumber=${this.cardNumber}`).subscribe(
        (response: any) => {

          this.isPullRequestLoading = false;
          this.loadingBar.stop();
          // Zoneless: garante que o skeleton dos painéis saia mesmo quando não há PR salvo.
          this.cdr.detectChanges();

          if(response) {
            this.pullRequest = response;
            // Defaults do modal "Abrir PR": vêm do PR do GitHub mais recente do card.
            this.branchName = response.branchName;
            this.branchPrefix = response.branchPrefix;
            if (response.repositoryId) {
              this.selectedRepositoryObj = this.repositoryOptions.find(r => r.value === response.repositoryId)
                ?? { label: response.repositoryId, value: response.repositoryId };
            }

            this.loadPrAuthorInfo(response);
            this.prState.loadRegister(this.cardNumber?.toString() ?? null, response);
            this.cdr.detectChanges();
            // A lista veio com o status persistido; atualiza no GitHub em segundo plano.
            if (response.githubPullRequests?.length) this.refreshGithubPrs();

            this.generateFullDescriptionHandler();
          } else {
            // Card ainda não salvo: mostra o card de infos vazio para liberar popovers e "Abrir PR".
            this.prInfo = { openedAt: null, updatedAt: null, userName: '', userPhoto: null };
            this.cdr.detectChanges();
          }

        },
        error => {
          this.isPullRequestLoading = false;
          this.loadingBar.stop();
          // A barra (com Descrição/Root Cause/Abrir PR) aparece mesmo assim; o aviso deixa claro
          // que o conteúdo salvo não foi carregado. Salvar envia null no que não foi editado,
          // o que mantém o valor salvo no backend.
          this.prLoadError = true;
          this.prInfo = { openedAt: null, updatedAt: null, userName: '', userPhoto: null };
          const detail = error?.error?.error ?? error?.status ?? '';
          this._snackBar.open(`Não foi possível carregar os dados salvos do card${detail ? ` (${detail})` : ''}`, 'Ok',
            {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"});
          this.cdr.detectChanges();
        });
    }



  openDialogTemplate() {
    const dialogRef = this.dialog.open(DialogTemplateComponent, {
      data: this.template,
      width: '1200px',
      height: '80vh',
      maxWidth: '90vw',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container'
    });
  }

  openDialogPrompt(isAiGenerate: boolean = false) {
    const dialogRef = this.dialog.open(DialogPrompt, {
      data: {
        cardNumber: this.cardNumber,
        isAiGenerate: isAiGenerate,
      },
      width: '1200px',
      height: '80vh',
      maxWidth: '90vw',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container'
    });
  }


  copyFullDescriptionToClipboard(itemToCopy: string = "full") {

    if (!this.fullDescription) {
      this._snackBar.open('Nenhuma descrição completa para copiar', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"})
      return;
    }

    let contentToCopy: string = '';

    switch (itemToCopy) {
      case 'full':
        contentToCopy = this.fullDescription;
        this._snackBar.open('Descrição completa copiada!', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"});
        break;

      case 'description':
        if (!this.pullRequest.description) {
          this._snackBar.open('Nenhuma descrição para copiar', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"});
          return;
        }
        contentToCopy = `${this.pullRequest.description.toString().trim()}`;
        this._snackBar.open('Descrição copiada!', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"});
        break;

      case 'rootCause':
        if (!this.pullRequest.rootCause) {
          this._snackBar.open('Nenhum Root Cause para copiar', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"});
          return;
        }
        contentToCopy = this.pullRequest.rootCause;
        this._snackBar.open('Root Cause copiado!', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"});
        break;

      case 'template':
        if (!this.template || !this.template.description) {
          this._snackBar.open('Nenhum template para copiar', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"});
          return;
        }
        contentToCopy = this.template.description;
        this._snackBar.open('Template copiado!', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"});
        break;

      default:
        contentToCopy = this.fullDescription;
        this._snackBar.open('Descrição completa copiada!', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"});
        break;
    }

    this._clipboardService.copyFullDescriptionToClipboard(contentToCopy);

  }



  generateFullDescriptionHandler() {
    if(this.pullRequest.description && this.pullRequest.description.length == 0) {
      this.pullRequest.description = null;
    }
    if(this.cardNumber == null) return;
    if(this.pullRequest.description == null) return;

    this.setFullDescription();
    this.cdr.detectChanges();
  }



  setFullDescription(){

    //this.fullDescription = this.template.description;

    //const prDescription = this.pullRequest.description;
    //let prTemplate = this.template.description;

    //const newDescription = prTemplate.replace(/\[ \]/g, '[x]');

    //this.fullDescription = newDescription.replace("Descreva as alterações feitas neste PR", `${prDescription.toString().trim()}\n\nAB#${this.cardNumber} ${this.environmentName.toUpperCase()}`);

    this.fullDescription = this.pullRequest.description;

    this.cdr.detectChanges();
  }

  onBranchChange() {
    this.template = null;
    this.getTemplateByEnvironment();
  }

  protected readonly Number = Number;
  cardType: any = 'bug';


  private initializeCustomCopyButtons() {
    this.copyCustomButtons = [
      {
        label: 'Apenas descrição',
        icon: 'pi pi-copy',
        command: (event: MenuItemCommandEvent) => {
          this.copyFullDescriptionToClipboard("description");
        }
      },
      {
        label: 'Root Cause',
        icon: 'pi pi-copy',
        command: (event: MenuItemCommandEvent) => {
          this.copyFullDescriptionToClipboard("rootCause");
        }
      },
      {
        label: 'Template',
        icon: 'pi pi-copy',
        command: (event: MenuItemCommandEvent) => {
          this.copyFullDescriptionToClipboard("template");
        }
      }
    ];
  }

  onCardNumberChange() {
    this.branchName = this.cardNumber!.toString();
    // Ao trocar o número do card, os detalhes do DevOps carregados anteriormente ficam
    // obsoletos: invalida para que o Handover só volte a ser liberado após um novo "Buscar"
    // que encontre o card no DevOps.
    this.cardFull = null;
  }
}

export default RegisterComponent
