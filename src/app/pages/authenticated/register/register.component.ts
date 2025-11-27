import {Component, HostListener, inject, OnInit} from '@angular/core';
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
import {MenuItem, MenuItemCommandEvent} from 'primeng/api';
import {UserService} from '../../../services/UserService.service';
import {CliipboardService} from '../../../services/cliipboard.service';
import {environment} from '../../../../environments/environment';
import {DialogTemplateComponent} from '../../../components/dialog-template/dialog-template.component';
import {DialogPrompt} from '../../../components/dialog-prompt/dialog-prompt';
import {StorageService} from '../../../services/storage.service';
import {GlobalService} from '../../../services/global.service';

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
    SplitButton
  ]
})
export class RegisterComponent implements OnInit {

  environmentName = 'dev';
  template:any = null;
  pullRequest:any = {};
  urlBase = environment.apiUrl;
  isTemplateLoading = false;
  isPullRequestLoading = false;
  readonly dialog = inject(MatDialog);
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

  justifyOptions = [
    {
      label: 'DEV',
      value: 'dev'
    },
    {
      label: 'QA',
      value: 'qa'
    },
    {
      label: 'RV',
      value: 'rv'
    },
    {
      label: 'HV',
      value: 'hv'
    },
    {
      label: 'RC',
      value: 'rc'
    },
  ]




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
      if (button.label === 'Copiar' || button.label === 'Abrir PR' || button.label === 'Limpar') {
        button.disabled = this.isPullRequestLoading || this.fullDescription === null;
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
  ) { }

  ngOnInit() {
    this.getTemplateByEnvironment();
    this.checkIfMobile();
    this.initializeMobileButtons();
    this.initializeCustomCopyButtons();

    this.userSelected = this.storageService.getAccess().user;
    console.log(this.userSelected);
    this.initAiGeneratedListener();
  }

  initAiGeneratedListener() {
    this._globalService.onAiGenerated.subscribe((data: any) => {
      if(data) {
        this.pullRequest.description = data.pullRequestDescriptionAiGenerated;
        this.pullRequest.rootCause = data.rootCauseAnalysisAiGenerated;
        this.generateFullDescriptionHandler();
      }
    })
  }

  processTextForEditor(text: string): string {
    if (!text) return '';

    return text
      .replace(/\\n/g, '\n')  // Converter \n literais em quebras de linha
      .replace(/\n\n/g, '</p><p>')  // Parágrafos duplos
      .replace(/\n/g, '<br>')       // Quebras de linha simples
      .replace(/^/, '<p>')          // Início do parágrafo
      .replace(/$/, '</p>');        // Fim do parágrafo
  }

  processMarkdown(text: string): string {
    if (!text) return '';

    return text
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^\* (.*$)/gim, '<li>$1</li>')
      .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }

  onEditorTextChange(event: any) {
    let processedText = this.processTextForEditor(event.textValue || '');
    processedText = this.processMarkdown(processedText);
    this.pullRequest.rootCause = processedText;
    this.generateFullDescriptionHandler();
  }

  clearAll() {
    this.environmentName = 'dev';
    this.template = null;
    this.pullRequest = {};
    this.cardNumber = null;
    this.fullDescription = null;
    this.branchPrefix = 'hotfix/';
    this.branchName = '';
    this.link = "https://github.com/electradv/edv-solvace/compare/my-environment...hotfix/";
  }

  savePullRequest() {
    this.isPullRequestLoading = true;
    this.loadingBar.start();
    let cardNumber = this.cardNumber ? this.cardNumber.toString() : "0";
    let pullRequestModel = {
      description: this.pullRequest.description,
      cardNumber: cardNumber,
      userId: this.userSelected.externalId,
      formId: this.template.id,
      rootCause: this.pullRequest.rootCause,
      branchPrefix: this.branchPrefix,
      branchName: this.branchName,
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

    let model = {
      rootCause: this.pullRequest.rootCause,
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
    const dialogRef = this.dialog.open(DialogPrompt, {
      data: {
        cardNumber: this.cardNumber,
        isAiGenerate: true,
      },
      width: '1200px',
      height: '80vh',
      maxWidth: '90vw',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container'
    });
  }


    getPullRequestByCardNumber()
    {
      this.isPullRequestLoading = true;
      this.loadingBar.start();
      this.http.get(`${this.urlBase}PullRequest/GetByCardNumber?cardNumber=${this.cardNumber}`).subscribe(
        (response: any) => {

          this.isPullRequestLoading = false;
          this.loadingBar.stop();

          if(response) {
            this.pullRequest = response;
            this.branchName = response.branchName;
            this.branchPrefix = response.branchPrefix;
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
    if(this.template == null) return;

    this.setFullDescription();
  }



  setFullDescription(){

    //this.fullDescription = this.template.description;

    //const prDescription = this.pullRequest.description;
    //let prTemplate = this.template.description;

    //const newDescription = prTemplate.replace(/\[ \]/g, '[x]');

    //this.fullDescription = newDescription.replace("Descreva as alterações feitas neste PR", `${prDescription.toString().trim()}\n\nAB#${this.cardNumber} ${this.environmentName.toUpperCase()}`);

    this.fullDescription = this.pullRequest.description;

    this.makeUrlLink();
  }

  makeUrlLink() {
    if(this.cardNumber == null) return;
    this.link = `https://github.com/electradv/edv-solvace/compare/my-environment...${this.branchPrefix}${this.branchName}`;
    this.link = this.link.replace("my-environment",this.convertEnvironmentIdToBranchName(this.environmentName.toLowerCase()));
  }

  convertEnvironmentIdToBranchName(id: string): string {
    switch (id) {
      case 'hv':
        return 'hotfix-version';
      case 'dev':
        return 'development';
      case 'qa':
        return 'qa';
      case 'rv':
        return 'release-version';
      case 'rc':
        return 'release-candidate';
      default:
        return 'development';
    }
  }

  openGithubPullRequestPage() {
    this.generateFullDescriptionHandler();
    this.makeUrlLink();
    let url = new URL(this.link);
    url.searchParams.set('expand', '1');
    url.searchParams.set('title', `AB#${this.cardNumber} ${this.environmentName.toUpperCase()}`);
    url.searchParams.set('body', this.fullDescription!);

    window.open(url, '_blank');
  }
  onBranchChange() {
    this.template = null;
    this.getTemplateByEnvironment();

  }

  protected readonly Number = Number;


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
  }
}

export default RegisterComponent
