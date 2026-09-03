import {ChangeDetectorRef, Component, HostListener, inject, OnDestroy, OnInit, ViewChild} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatInputModule } from '@angular/material/input';
import {MatTooltipModule} from '@angular/material/tooltip';
import {FormsModule} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {HttpClient} from '@angular/common/http';
import {MatDialog} from '@angular/material/dialog';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatAutocompleteModule} from '@angular/material/autocomplete';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {LoadingBarModule, LoadingBarService} from '@ngx-loading-bar/core';
import {EditorModule} from 'primeng/editor';
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
import {UserService} from '../../../services/UserService.service';
import {CliipboardService} from '../../../services/cliipboard.service';
import {environment} from '../../../../environments/environment';
import {DialogTemplateComponent} from '../../../components/dialog-template/dialog-template.component';
import {DialogPrompt} from '../../../components/dialog-prompt/dialog-prompt';
import {StorageService} from '../../../services/storage.service';
import {GlobalService} from '../../../services/global.service';
import {firstValueFrom} from 'rxjs';
import {tap} from 'rxjs/internal/operators/tap';
import {GdsService} from '../../../services/gds.service';
import {WsService} from '../../../services/ws.service';
import {JsonPipe} from '@angular/common';
import {CardTimelineComponent} from '../../../components/card-timeline/card-timeline.component';
import {CardPanelComponent} from '../../../components/card-panel/card-panel.component';
import {CardAlertBarComponent} from '../../../components/card-alert-bar/card-alert-bar.component';
import {CardDetailsDialogComponent} from '../../../components/card-details-dialog/card-details-dialog.component';
import {HandoverDialogComponent} from '../../../components/handover-dialog/handover-dialog.component';
import {CardFull} from '../../../components/card-details-dialog/card-full.model';
import {marked} from 'marked';
import TurndownService from 'turndown';

/** Evento e grupo do tempo real da configuração de PR (em sincronia com o backend). */
const PULLREQUEST_CONFIG_GROUP = 'pullrequest-config';
const PULLREQUEST_CONFIG_EVENT = 'pullRequestConfigUpdated';

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
    MatAutocompleteModule,
    MatSnackBarModule,
    LoadingBarModule,
    EditorModule,
    SelectButtonModule,
    InputGroupModule,
    InputGroupAddonModule,
    ButtonModule,
    MenuModule,
    InputNumberModule,
    SplitButton,
    JsonPipe,
    AutoCompleteModule,
    CardTimelineComponent,
    CardPanelComponent,
    CardAlertBarComponent
  ]
})
export class RegisterComponent implements OnInit, OnDestroy {

  @ViewChild(CardTimelineComponent) timeline?: CardTimelineComponent;

  cardFull: CardFull | null = null;
  isCardDetailsLoading = false;

  // Conteúdo HTML dos editores WYSIWYG (a fonte da verdade continua em markdown).
  descriptionHtml = '';
  rootCauseHtml = '';
  private turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-'
  });

  environmentName = 'development';
  template:any = null;
  pullRequest:any = {};
  urlBase = environment.apiUrl;
  isTemplateLoading = false;
  isPullRequestLoading = false;
  readonly dialog = inject(MatDialog);
  private configurationService = inject(GdsService);
  userSelected: any = null;
  cardNumber: null | string = null;
  fullDescription = null;
  link = "https://github.com/electradv/edv-solvace/compare/my-environment...hotfix/";
  mobileButtons: MenuItem[] = [];
  copyCustomButtons: MenuItem[] = [];
  isMobile = false;
  isAzureLoading: boolean = false;

  branchPrefix: string = 'hotfix/';
  isEditingPrefix: boolean = false;
  branchName: string = '';

  repositoryOptions: { label: string; value: string; id?: number }[] = [];
  selectedRepositoryObj: { label: string; value: string; id?: number } | null = null;
  filteredRepositories: { label: string; value: string; id?: number }[] = [];

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
      hasText(this.descriptionHtml) ||
      hasText(this.rootCauseHtml) ||
      this.fullDescription ||
      this.cardFull
    );
  }

  onPrefixDoubleClick() {
    this.isEditingPrefix = true;
  }

  onPrefixBlur() {
    this.isEditingPrefix = false;
    if (!this.branchPrefix || this.branchPrefix.trim() === '') {
      this.branchPrefix = 'hotfix/';
    } else if (!this.branchPrefix.endsWith('/')) {
      this.branchPrefix = this.branchPrefix + '/';
    }
    this.makeUrlLink();
  }

  onPrefixChange() {
    this.makeUrlLink();
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
          this.openGithubPullRequestPage();
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
        label: 'Salvar RC no DevOps',
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
      if (button.label === 'Copiar' || button.label === 'Abrir PR') {
        button.disabled = this.isPullRequestLoading || this.fullDescription === null;
      } else if (button.label === 'Limpar') {
        button.disabled = this.isPullRequestLoading || !this.hasAnythingToClear;
      }
    });
  }




  private _snackBar = inject(MatSnackBar);
  private _clipboardService = inject(CliipboardService);
  private _globalService = inject(GlobalService);

  constructor(
    private http: HttpClient,
    private loadingBar: LoadingBarService,
    private storageService: StorageService,
    private cdr: ChangeDetectorRef,
    private ws: WsService,
  ) {
    // Tachado (~~texto~~) não é tratado pelo turndown por padrão — mapeamos manualmente
    // para manter o markdown limpo ao converter o HTML do editor de volta.
    this.turndown.addRule('strikethrough', {
      filter: ['del', 's', 'strike'] as any,
      replacement: (content: string) => `~~${content}~~`,
    });
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

    } catch (error) {
      console.error('Falha ao inicializar configurações', error);
    }


  }

  ngOnDestroy(): void {
    this.ws.removeFromGroup(PULLREQUEST_CONFIG_GROUP);
    this.ws.off(PULLREQUEST_CONFIG_EVENT, this.onPullRequestConfigUpdated);
  }

  /** Atualização em tempo real: repositórios/branches mudam para todos na tela de PR. */
  private initRealtimeConfig(): void {
    this.ws.startConnection();
    this.ws.addToGroup(PULLREQUEST_CONFIG_GROUP);
    this.ws.on(PULLREQUEST_CONFIG_EVENT, this.onPullRequestConfigUpdated);
  }

  private onPullRequestConfigUpdated = (): void => {
    firstValueFrom(this.getPullRequestConfigurations())
      .then(() => this.reapplyPullRequestConfigurations())
      .catch((e) => console.error('Falha ao atualizar configurações em tempo real', e));
  };

  /** Re-aplica repositórios/branches preservando a seleção atual do usuário quando possível. */
  private reapplyPullRequestConfigurations(): void {
    const prevRepoValue = this.selectedRepositoryObj?.value ?? null;
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
        this.filteredRepositories = [...this.repositoryOptions];
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
        this.filteredRepositories = [...this.repositoryOptions];
        if (this.repositoryOptions.length > 0) {
          this.selectedRepositoryObj = this.repositoryOptions[0];
        }
        this.cdr.detectChanges();
      } catch (error) {
        console.error('Erro ao processar ActiveRepositories:', error);
      }
    }
  }

  filterRepositories(event: { query: string }) {
    const q = event.query.toLowerCase();
    this.filteredRepositories = this.repositoryOptions.filter(r =>
      r.label.toLowerCase().includes(q)
    );
  }

  onRepositorySelect() {
    this.makeUrlLink();
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
        this.syncEditorsFromModel();
        this.generateFullDescriptionHandler();
        this.cdr.detectChanges();
      }
    })
  }

  /**
   * Converte markdown (a fonte da verdade — salvo no banco / enviado ao GitHub) em HTML
   * para exibir formatado nos editores WYSIWYG.
   */
  private mdToHtml(markdown: string | null | undefined): string {
    if (!markdown) return '';
    marked.setOptions({ gfm: true, breaks: true });
    return (marked.parse(markdown) as string) ?? '';
  }

  /**
   * Popula os editores a partir do markdown do modelo. Chamar apenas em cargas externas
   * (geração por IA, busca do card, limpar) — nunca durante a digitação, para não
   * reposicionar o cursor do editor.
   */
  private syncEditorsFromModel() {
    this.descriptionHtml = this.mdToHtml(this.pullRequest?.description);
    this.rootCauseHtml = this.mdToHtml(this.pullRequest?.rootCause);
    this.cdr.detectChanges();
  }

  /** Edição no editor de Descrição: converte o HTML de volta para markdown antes de salvar/enviar. */
  onDescriptionEditorChange(event: any) {
    const html = event?.htmlValue ?? '';
    this.pullRequest.description = html ? this.turndown.turndown(html) : '';
    this.generateFullDescriptionHandler();
  }

  /** Edição no editor de Root Cause: converte o HTML de volta para markdown antes de salvar/enviar. */
  onRootCauseEditorChange(event: any) {
    const html = event?.htmlValue ?? '';
    this.pullRequest.rootCause = html ? this.turndown.turndown(html) : '';
    this.generateFullDescriptionHandler();
  }

  clearAll() {
    this.environmentName = 'development';
    this.template = null;
    this.pullRequest = {};
    this.descriptionHtml = '';
    this.rootCauseHtml = '';
    this.cardNumber = null;
    this.fullDescription = null;
    this.branchPrefix = 'hotfix/';
    this.branchName = '';
    this.selectedRepositoryObj = this.repositoryOptions.length > 0 ? this.repositoryOptions[0] : null;
    const repo = this.selectedRepositoryObj?.value ?? 'edv-solvace-apps';
    this.link = `https://github.com/electradv/${repo}/compare/my-environment...hotfix/`;
    this.cardType = '';
  }

  savePullRequest() {
    this.isPullRequestLoading = true;
    this.loadingBar.start();
    const repo =
      typeof this.selectedRepositoryObj === 'string'
        ? this.selectedRepositoryObj
        : this.selectedRepositoryObj?.value ?? 'edv-solvace';

    let cardNumber = this.cardNumber ? this.cardNumber.toString() : "0";
    let pullRequestModel = {
      description: this.pullRequest.description,
      cardNumber: cardNumber,
      userId: this.userSelected.externalId,
      formId: 1,
      rootCause: this.pullRequest.rootCause,
      branchPrefix: this.branchPrefix,
      branchName: this.branchName,
      repositoryId: repo,
    };

    this.http.post(`${this.urlBase}PullRequest`, pullRequestModel).subscribe(
      x => {
        if(x)
          this._snackBar.open('Pull Request salvo com sucesso!', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"})

        this.isPullRequestLoading = false
        this.loadingBar.stop();
      }, error => {
        this._snackBar.open('Erro ao tentar salvar o Pull Request', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"})

        this.isPullRequestLoading = false
        this.loadingBar.stop();
      }
    )

    console.log(pullRequestModel);
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
    const repo =
      typeof this.selectedRepositoryObj === 'string'
        ? this.selectedRepositoryObj
        : this.selectedRepositoryObj?.value ?? 'edv-solvace';

    const fullBranch = `${this.branchPrefix}${this.branchName}`;

    const dialogRef = this.dialog.open(DialogPrompt, {
      data: {
        cardNumber: this.cardNumber,
        isAiGenerate: true,
        cardType: this.cardType,
        repository: repo,
        branch: fullBranch,
      },
      width: '1200px',
      height: '90vh',
      maxWidth: '90vw',
      maxHeight: '100vh',
      panelClass: 'custom-dialog-container'
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


    loadCardDetails()
    {
      if (!this.cardNumber) {
        this.cardFull = null;
        return;
      }

      this.isCardDetailsLoading = true;
      this.cardFull = null;

      this.http.get<CardFull>(`${this.urlBase}Azure/card/${this.cardNumber}/full`).subscribe(
        (response) => {
          this.cardFull = response ?? null;
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
      const repositoryId =
        typeof this.selectedRepositoryObj === 'string'
          ? this.selectedRepositoryObj
          : this.selectedRepositoryObj?.value ?? null;

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

    getPullRequestByCardNumber()
    {
      this.isPullRequestLoading = true;
      this.loadingBar.start();

      const repositoryId =
        typeof this.selectedRepositoryObj === 'string'
          ? this.selectedRepositoryObj
          : this.selectedRepositoryObj?.value ?? 'edv-solvace';

      const repoParam = repositoryId != null ? `&repositoryId=${repositoryId}` : '';
      // Carrega a linha do tempo e os detalhes do card (DevOps) em paralelo à busca do PR.
      this.timeline?.load(this.cardNumber ?? undefined);
      this.loadCardDetails();

      this.http.get(`${this.urlBase}PullRequest/GetByCardNumber?cardNumber=${this.cardNumber}${repoParam}`).subscribe(
        (response: any) => {

          this.isPullRequestLoading = false;
          this.loadingBar.stop();

          if(response) {
            this.pullRequest = response;
            this.branchName = response.branchName;
            this.branchPrefix = response.branchPrefix;

            this.syncEditorsFromModel();
            this.cdr.detectChanges();

            this.generateFullDescriptionHandler();
          }

        },
        error => {
          this.isPullRequestLoading = false;
          this.loadingBar.stop();
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

  openDialogFullDescription() {
    const dialogRef = this.dialog.open(DialogTemplateComponent, {
      data: {
        id: 1,
        description: this.fullDescription,
        environmentName: this.environmentName.toUpperCase(),
      },
      width: '1200px',
      height: '80vh',
      maxWidth: '90vw',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container'
    });
  }

  openDialogRCA() {
    const dialogRef = this.dialog.open(DialogTemplateComponent, {
      data: {
        id: 1,
        description: this.pullRequest.rootCause,
        environmentName: this.environmentName.toUpperCase(),
      },
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

    this.makeUrlLink();

    this.cdr.detectChanges();
  }

  makeUrlLink() {
    if(this.cardNumber == null) return;
    const repo =
      typeof this.selectedRepositoryObj === 'string'
        ? this.selectedRepositoryObj
        : this.selectedRepositoryObj?.value ?? 'edv-solvace';
    this.link = `https://github.com/electradv/${repo}/compare/my-environment...${this.branchPrefix}${this.branchName}`;
    this.link = this.link.replace("my-environment", this.environmentName.toLowerCase());

    this.cdr.detectChanges();
  }

  openGithubPullRequestPage() {
    this.generateFullDescriptionHandler();
    this.makeUrlLink();
    let url = new URL(this.link);
    url.searchParams.set('expand', '1');
    url.searchParams.set('title', `AB#${this.cardNumber} ${this.getBranchLabelByBranch(this.environmentName).toUpperCase()}`);
    url.searchParams.set('body', this.fullDescription!);

    window.open(url, '_blank');
  }
  onBranchChange() {
    this.template = null;
    this.getTemplateByEnvironment();
  }

  getBranchLabelByBranch(branch: string) {
    const branchLabel = this.justifyOptions.find(option => option.value === branch);
    return branchLabel ? branchLabel.label : branch;
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
