import {Component, EventEmitter, inject, OnInit, Output, output, signal, ViewChild} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogActions, MatDialogContent, MatDialogRef} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { CliipboardService } from '../../services/cliipboard.service';
import { FormsModule } from '@angular/forms';
import {MatInput, MatLabel} from '@angular/material/input';
import { MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';
import {HttpClient} from '@angular/common/http';
import {environment} from '../../../environments/environment';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {SafeHtmlPipe} from 'primeng/menu';
import {MatStepper, MatStepperModule} from '@angular/material/stepper';
import { GitDiffViewerComponent } from "../git-diff-viewer/git-diff-viewer";
import { marked } from 'marked';
import {GlobalService} from '../../services/global.service';
import {GdsService} from '../../services/gds.service';
import {firstValueFrom} from 'rxjs';
import {tap} from 'rxjs/internal/operators/tap';

@Component({
  selector: 'app-dialog-prompt',
  templateUrl: './dialog-prompt.html',
  styleUrl: './dialog-prompt.css',
  standalone: true,
  providers: [HttpClient],
  imports: [
    MatDialogContent,
    MatDialogActions,
    MatButtonModule,
    FormsModule,
    MatLabel,
    MatFormFieldModule,
    MatInput,
    MatIconModule,
    MatProgressSpinnerModule,
    SafeHtmlPipe,
    MatStepperModule,
    GitDiffViewerComponent,

]
})
export class DialogPrompt implements OnInit {
  readonly data = inject<any>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<DialogPrompt>);
  private _clipboardService = inject(CliipboardService);
  private _globalService = inject(GlobalService);

  showCardDetails = signal(false);
  isAzureLoading = signal(false);
  isGitHubLoading = signal(false);
  isAiLoading = signal(false);
  promptText = "";
  urlBase = environment.apiUrl;
  cardData: any;
  commitId: string = "";
  githubCommitDiff: any;
  generatedText: string = "";
  generatedTextRaw: string = "";
  private pullRequestDescriptionAiGenerated: string = "";
  private rootCauseAnalysisAiGenerated: string = "";
  private configurationService = inject(GdsService);

  @ViewChild('stepper') stepper!: MatStepper;
  private configurations: any = {};


  constructor(private http: HttpClient) {
    marked.setOptions({
      breaks: true,
      gfm: true
    });
  }

  async ngOnInit() {
    this.isAzureLoading.set(true);

    try {
      await Promise.all([
        firstValueFrom(this.getDevOpsConfigurations()),
        firstValueFrom(this.getAiConfigurations())
      ]);

      // Agora que as configs chegaram, prossegue
      if (this.data.isAiGenerate) {
        this.getCardById();
      } else {
        this.isAzureLoading.set(false);
      }
    } catch (error) {
      this.isAzureLoading.set(false);
      console.error('Falha ao inicializar configurações', error);
    }
  }

  next() {
    if (this.stepper) {
      this.stepper.next();
    }
  }

  back() {
    if (this.stepper) {
      this.stepper.previous();
    }
  }

  canProceedFromStep2(): boolean {
    return this.reproSteps.length > 0;
  }

  get reproSteps(): string {
    let fieldRetroSteps = 'Microsoft.VSTS.TCM.ReproSteps';
    let fieldTitle = 'System.Title';

    if(this.configurations.Azure && this.configurations.Azure.RetroStepsFieldName)
      fieldRetroSteps = this.configurations.Azure.RetroStepsFieldName;

    if(this.configurations.Azure && this.configurations.Azure.TitleFieldName)
      fieldTitle = this.configurations.Azure.TitleFieldName;

    if (this.cardData && this.cardData.fields && this.cardData.fields['System.WorkItemType'] !== 'User Story') {
      return this.cardData.fields[fieldRetroSteps];
    }else if (this.cardData && this.cardData.fields && this.cardData.fields['System.WorkItemType'] == 'User Story'){
      return this.cardData.fields[fieldTitle];
    }

    return "";
  }

  extractSectionsFromGeneratedText(generatedText: string): void {
    const rcaMatch = generatedText.match(/<RCA>([\s\S]*?)<\s*\/\s*RCA>/i);
    const rootCauseAnalysis = rcaMatch ? rcaMatch[1].trim() : '';

    let pullRequestDescription = '';
    if (rcaMatch) {
      pullRequestDescription = generatedText.substring(0, rcaMatch.index).trim();
    } else {
      pullRequestDescription = generatedText;
    }


    this.pullRequestDescriptionAiGenerated = pullRequestDescription;
    this.rootCauseAnalysisAiGenerated = rootCauseAnalysis;

    console.log("this.pullRequestDescriptionAiGenerated",this.pullRequestDescriptionAiGenerated)
    console.log("this.rootCauseAnalysisAiGenerated",this.rootCauseAnalysisAiGenerated)

    let data = {
      pullRequestDescriptionAiGenerated: this.pullRequestDescriptionAiGenerated,
      rootCauseAnalysisAiGenerated: this.rootCauseAnalysisAiGenerated
    }
    this._globalService.onAiGeneratedEmit(data);
  }

  getCardById(){
    if(!this.data.cardNumber) return;

    this.isAzureLoading.set(true);

      this.http.get(`${this.urlBase}Azure/card/${this.data.cardNumber}`).subscribe(
        (response: any) => {
          this.isAzureLoading.set(false);
          if (response) {
            this.cardData = response;
            this.showCardDetails.set(true);
            setTimeout(() => {
                this.next()
              }, 3000
            );
          }
        },
        error => {
          this.isAzureLoading.set(false);
          console.error('Error fetching card:', error);
        });

  }

  getAiConfigurations(){
    return this.configurationService.getAllById(3).pipe(
      tap((response: any) => {
        this.configurations.AI = response.configurations;
      })
    );
  }

  getDevOpsConfigurations(){
    return this.configurationService.getAllById(8).pipe(
      tap((response: any) => {
        this.configurations.Azure = response.configurations;
      })
    );
  }

  getGitHubCommitDiff(){
    if(!this.commitId) return;

    this.isGitHubLoading.set(true);

    this.http.get(`${this.urlBase}GitHub/commit/${this.commitId}/diff`).subscribe(
      (response: any) => {
        this.isGitHubLoading.set(false);
        if (response) {
          this.githubCommitDiff = response;
          this.gerarPrompt();
          setTimeout(() => {
              this.next()
            }, 3000
          );
        }
      },
      error => {
        this.isGitHubLoading.set(false);
        console.error('Error fetching card:', error);
      });

  }


  generateWithAI(){
    if(!this.promptText) return;

    this.isAiLoading.set(true);

    const body = JSON.stringify(this.promptText);

    this.http.post(`${this.urlBase}AI/generate`, body, {
      headers: {
        'Content-Type': 'application/json'
      }
    }).subscribe(
      (response: any) => {
        this.isAiLoading.set(false);
        if (response) {
          let content = response.content || response.text || response;

          if (typeof content === 'object' && content.content) {
            content = content.content;
          }

          content = content.replace(/^```markdown\s*/i, '').replace(/```\s*$/, '').trim();

          this.generatedTextRaw = content;

          this.generatedText = marked.parse(content) as string;

          this.extractSectionsFromGeneratedText(content);
        }
      },
      error => {
        this.isAiLoading.set(false);
        console.error('Error generating AI content:', error);
      });

  }

  gerarPrompt() {
    if(!this.githubCommitDiff || !this.data.cardNumber || !this.reproSteps) return;

    let prompt = `
    Eu como desenvolvedor de software, solicito que crie um texto de descrição para Pull Request com base nos seguintes dados:

    CardNumber (Ticket): {cardNumber},
    Reclamação inicial: {description},
    Arquivos alterados (DIFF DO GIT): {githubCommitDiff}

    Todo o texto gerado precisa ser em ingles, e conter uma sessão para Root Cause Analysis (RCA), detalhando o que causou o problema e como ele foi resolvido.

    Modelo do PR:

    Problem Description: XXX
    Solution: XXX
    Changes Made: XXX
    Files Modified: XXX
    Ticket: {cardNumber}

    Modelo do RCA:

    Main Cause: XXX
    Contributing Factors: XXX
    Impact: XXX
    Applied Solution: XXX
    Action/Prevention Plan: XXX
    Modified files/Modified code/Altered data in the database: X,X,X
    Ticket: {cardNumber}

    Regras gerais:

    Texto completamente em ingles, não pode ter nada em portugues
    Formatação do texto deve ser em MARKDOWN
    Sessão para Pull Request
    Sessão para RCA
    Os titulos devem ter formatação em negrito, e precisa pular linha entre um titulo e outro
    Não adicione nenhum texto informando que você gerou esse texto, apenas o texto gerado direto ao ponto
    Seguir os modelos acima
    A sessão para RCA deve ser chaveada no seguinte padrao:

    <RCA>
    {TEXTO DO RCA AQUI}
    < /RCA>
    `;

    if(this.configurations.AI && this.configurations.AI.PromptBug) {
      if (this.cardData && this.cardData.fields && this.cardData.fields['System.WorkItemType'] === 'User Story'){
        prompt = this.configurations.AI.PromptUS;
      } else {
        prompt = this.configurations.AI.PromptBug;
      }

    }

    prompt = prompt.replace('{githubCommitDiff}', JSON.stringify(this.githubCommitDiff, null, 2));
    prompt = prompt.replace('{cardNumber}', this.data.cardNumber);
    prompt = prompt.replace('{description}', this.reproSteps);
      this.promptText = prompt;

    this.generateWithAI();

  }

  copyPromptToClipboard() {
    const textToCopy = this.generatedTextRaw || this.promptText;
    this._clipboardService.copyFullDescriptionToClipboard(textToCopy);
  }


}
