import {Component, inject, OnInit} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatInputModule } from '@angular/material/input';
import {MatButtonToggle, MatButtonToggleGroup} from '@angular/material/button-toggle';
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
    MatButtonToggleGroup,
    MatButtonToggle,
    MatTooltipModule,
    FormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatAutocompleteModule,
    MatSnackBarModule,
    LoadingBarModule
  ]
})
class RegisterComponent implements OnInit {

  environment = 'dev';
  template:any = null;
  pullRequest:any = {};
  urlBase = "http://prformapi.runasp.net/api/";
  isTemplateLoading = false;
  isUserLoading = false;
  isPullRequestLoading = false;
  readonly dialog = inject(MatDialog);
  userSelected: any = null;
  users: any[] = [];
  cardNumber: null | string = null;
  fullDescription = null;
  link = "https://github.com/electradv/edv-solvace/compare/my-environment...hotfix/";

  private _snackBar = inject(MatSnackBar);

  displayUser = (userId: number): string => {
    const user = this.users.find(u => u.id === userId);
    return user ? user.name : '';
  }
  constructor(
    private http: HttpClient,
    private loadingBar: LoadingBarService
  ) { }

  ngOnInit() {
    this.getTemplateByEnvironment();
    this.getAllUsers();
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

  getAllUsers() {
    this.isUserLoading = true;
    this.loadingBar.start();
    this.http.get(`${this.urlBase}User/GetUsers`).subscribe(
      (result:any) => {
        this.users = result;
        this.isUserLoading = false;
        this.loadingBar.stop();
      }
    );
  }

  openDialogTemplate() {
    const dialogRef = this.dialog.open(DialogTemplateComponent, {
      data: this.template,
      width: '800px',
    });
  }

  openDialogFullDescription() {
    const dialogRef = this.dialog.open(DialogTemplateComponent, {
      data: {
        id: 1,
        description: this.fullDescription,
        environmentName: this.environment.toUpperCase(),
      },
      width: '800px',
    });
  }

  copyFullDescriptionToClipboard() {
    if (!this.fullDescription) {
      this._snackBar.open('Nenhuma descrição completa para copiar', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"})
      return;
    }

    navigator.clipboard.writeText(this.fullDescription)
      .then(() => {
        this._snackBar.open('Descrição completa copiada para a área de transferência', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"})
      });
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
