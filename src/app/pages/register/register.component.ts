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
import {DialogTemplateComponent} from '../../components/dialog-template/dialog-template.component';
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
import {UserService} from '../../services/UserService.service';
import {SplitButton} from 'primeng/splitbutton';
import {MenuItem, MenuItemCommandEvent} from 'primeng/api';
import { DialogPrompt } from '../../components/dialog-prompt/dialog-prompt';
import { CliipboardService } from '../../services/cliipboard.service';
import {environment} from '../../../environments/environment';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
  providers: [HttpClient],
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
class RegisterComponent implements OnInit {

  environment = 'dev';
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
  isMobile = false;

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

  constructor(
    private http: HttpClient,
    private loadingBar: LoadingBarService,
    private userService: UserService
  ) { }

  ngOnInit() {
    this.getTemplateByEnvironment();
    this.checkIfMobile();
    this.initializeMobileButtons();

    this.userService.selectedUser$.subscribe(user => {
      if (user) {
        console.log(user)
        this.userSelected = user.value.id;
        this.generateFullDescriptionHandler();
      }
    });
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
    this.environment = 'dev';
    this.template = null;
    this.pullRequest = {};
    this.cardNumber = null;
    this.fullDescription = null;
    this.link = "https://github.com/electradv/edv-solvace/compare/my-environment...hotfix/";
  }

  savePullRequest() {
    this.isPullRequestLoading = true;
    this.loadingBar.start();
    let cardNumber = this.cardNumber ? this.cardNumber.toString() : "0";
    let pullRequestModel = {
      description: this.pullRequest.description,
      cardNumber: cardNumber,
      userId: this.userSelected,
      formId: this.template.id,
      rootCause: this.pullRequest.rootCause,
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

  getTemplateByEnvironment() {
    this.isTemplateLoading = true;
    this.loadingBar.start();
    this.http.get(`${this.urlBase}Form/GetByEnvironment?enrironmentName=${this.environment.toUpperCase()}`).subscribe(
      (template:any) => {
        this.template = template;
        this.isTemplateLoading = false;
        this.generateFullDescriptionHandler();
        this.loadingBar.stop();
      }
    );
  }

  getPullRequestByEnvironmentAndUserAndCardNumber() {
    this.isPullRequestLoading = true;
    this.loadingBar.start();
    this.http.get(`${this.urlBase}PullRequest/GetByEnvironmentNameAndCardNumber?environmentName=${this.environment}&cardNumber=${this.cardNumber}&userId=${this.userSelected}`).subscribe(
      (response:any) => {
        this.pullRequest = response;
        this.isPullRequestLoading = false;
        this.loadingBar.stop();
        this.generateFullDescriptionHandler();
      },
      error => {
        this.isPullRequestLoading = false;
        this.loadingBar.stop();
    }
    );
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
        environmentName: this.environment.toUpperCase(),
      },
      width: '1200px',
      height: '80vh',
      maxWidth: '90vw',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container'
    });
  }

  openDialogPrompt() {
    const dialogRef = this.dialog.open(DialogPrompt, {
      data: {
        cardNumber: this.cardNumber
      },
      width: '1200px',
      height: '80vh',
      maxWidth: '90vw',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container'
    });
  }

  copyFullDescriptionToClipboard() {

    if (!this.fullDescription) {
      this._snackBar.open('Nenhuma descrição completa para copiar', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"})
      return;
    }

    this._clipboardService.copyFullDescriptionToClipboard(this.fullDescription!);

  }



  generateFullDescriptionHandler() {
    if(this.pullRequest.description && this.pullRequest.description.length == 0) {
      this.pullRequest.description = null;
    }
    if(this.cardNumber == null || this.userSelected == null) return;
    if(this.pullRequest.description == null) return;
    if(this.template == null) return;

    this.setFullDescription();
  }



  setFullDescription(){
    this.fullDescription = this.template.description;

    const prDescription = this.pullRequest.description;
    let prTemplate = this.template.description;

    const newDescription = prTemplate.replace(/\[ \]/g, '[x]');

    this.fullDescription = newDescription.replace("Descreva as alterações feitas neste PR", `${prDescription.toString().trim()}\n\nAB#${this.cardNumber} ${this.environment.toUpperCase()}`);
    this.makeUrlLink();
  }

  makeUrlLink() {
    if(this.cardNumber == null || this.userSelected == null) return;
    this.link = `https://github.com/electradv/edv-solvace/compare/my-environment...hotfix/${this.cardNumber}`;
    this.link = this.link.replace("my-environment",this.convertEnvironmentIdToBranchName(this.environment.toLowerCase()));
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
    url.searchParams.set('title', `AB#${this.cardNumber} ${this.environment.toUpperCase()}`);
    url.searchParams.set('body', this.fullDescription!);

    window.open(url, '_blank');
  }
  onBranchChange() {
    this.template = null;
    this.getTemplateByEnvironment();

  }

  protected readonly Number = Number;
}

export default RegisterComponent
