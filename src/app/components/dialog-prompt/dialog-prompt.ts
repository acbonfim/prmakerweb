import {
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  OnInit,
  signal,
  ViewChild
} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogActions, MatDialogContent, MatDialogRef} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { CliipboardService } from '../../services/cliipboard.service';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';
import {HttpClient} from '@angular/common/http';
import {environment} from '../../../environments/environment';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {SafeHtmlPipe} from 'primeng/menu';
import {MatStepper, MatStepperModule} from '@angular/material/stepper';
import {STEPPER_GLOBAL_OPTIONS, StepperSelectionEvent} from '@angular/cdk/stepper';
import { marked } from 'marked';
import {GlobalService} from '../../services/global.service';
import {GdsService} from '../../services/gds.service';
import {firstValueFrom} from 'rxjs';
import {tap} from 'rxjs/internal/operators/tap';
import {MatAutocompleteModule} from '@angular/material/autocomplete';
import {MatTooltipModule} from '@angular/material/tooltip';
import {RepoCommitPickerComponent} from '../repo-commit-picker/repo-commit-picker.component';
import {RepoAutocompleteComponent} from '../repo-autocomplete/repo-autocomplete.component';
import {AiRepository, CardPrStateService, RepoCommitSelection} from '../../services/card-pr-state.service';
import {RepoOption} from '../../interfaces/RepoOption';
import {getCommitSha, getCommitTitle} from '../../helpers/commit';

/** Dados do dialog "Gerar com IA". */
export interface DialogPromptData {
  cardNumber: string | null;
  isAiGenerate: boolean;
  cardType?: string;
  /** Repositórios com PR aberto para o card (branch do PR mais recente de cada um). */
  repositories?: { repository: string; branch: string }[];
  /** Branch sugerida ao adicionar um repositório à mão. */
  defaultBranch?: string;
  /** Usado se a lista de repositórios do GitHub não puder ser carregada. */
  repositoryFallback?: RepoOption[];
}

@Component({
  selector: 'app-dialog-prompt',
  templateUrl: './dialog-prompt.html',
  styleUrl: './dialog-prompt.css',
  standalone: true,
  providers: [
    HttpClient,
    // Steps concluídos mostram o ícone de concluído (check), inclusive os editáveis.
    { provide: STEPPER_GLOBAL_OPTIONS, useValue: { displayDefaultIndicatorType: false } },
  ],
  imports: [
    MatDialogContent,
    MatDialogActions,
    MatButtonModule,
    FormsModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressSpinnerModule,
    SafeHtmlPipe,
    MatStepperModule,
    MatAutocompleteModule,
    ReactiveFormsModule,
    MatTooltipModule,
    RepoCommitPickerComponent,
    RepoAutocompleteComponent,
]
})
export class DialogPrompt implements OnInit {
  readonly data = inject<DialogPromptData>(MAT_DIALOG_DATA);
  readonly state = inject(CardPrStateService);
  readonly dialogRef = inject(MatDialogRef<DialogPrompt>);
  private _clipboardService = inject(CliipboardService);
  private _globalService = inject(GlobalService);

  showCardDetails = signal(false);
  currentStep = signal(0);
  isAzureLoading = signal(false);
  isGitHubLoading = signal(false);
  isCommitsLoading = signal(false);
  isAiLoading = signal(false);
  promptText = "";
  urlBase = environment.apiUrl;
  cardData: any;
  generatedText: string = "";
  generatedTextRaw: string = "";

  /** Repositórios do stepper vertical e o commit/diff escolhido em cada um (estado do card). */
  readonly repos = this.state.aiRepositories;
  readonly selections = this.state.aiSelections;
  readonly selectedDiffs = this.state.aiSelectedDiffs;
  readonly hasAnyDiff = computed(() => this.selectedDiffs().length > 0);
  readonly repoIds = computed(() => this.repos().map(r => r.repository));

  /** Repositório escolhido no autocomplete "Adicionar repositório". */
  readonly repoToAdd = signal<RepoOption | string | null>(null);
  readonly repoToAddValue = computed(() => {
    const value = this.repoToAdd();
    if (!value) return null;
    if (typeof value !== 'string') return value.value;
    const text = value.trim().toLowerCase();
    return this.state.repositories().find(r => r.value.toLowerCase() === text || r.label.toLowerCase() === text)?.value ?? null;
  });
  readonly canAddRepo = computed(() => {
    const value = this.repoToAddValue();
    return !!value && !this.repoIds().includes(value);
  });
  private pullRequestDescriptionAiGenerated: string = "";
  private rootCauseAnalysisAiGenerated: string = "";
  private configurationService = inject(GdsService);

  @ViewChild('stepper') stepper!: MatStepper;
  private configurations: any = {};


  constructor(private http: HttpClient, private cdr: ChangeDetectorRef,) {
    marked.setOptions({
      breaks: true,
      gfm: true
    });
  }

  async ngOnInit() {
    try {
      await Promise.all([
        firstValueFrom(this.getDevOpsConfigurations()),
        firstValueFrom(this.getAiConfigurations())
      ]);

      if (this.data.isAiGenerate) {
        // O card já foi carregado na tela de register: buscamos os dados apenas
        // em segundo plano (para montar o prompt), sem um passo visível.
        this.getCardById();
        this.initRepositories();
      }
    } catch (error) {
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

  onStepChange(event: StepperSelectionEvent) {
    this.currentStep.set(event.selectedIndex);
  }

  /**
   * Repositórios do stepper: os que têm PR aberto para o card + os já adicionados à mão
   * numa abertura anterior do dialog (mantidos no estado enquanto o card não muda).
   */
  private initRepositories() {
    const merged: AiRepository[] = [...this.repos()];
    for (const r of this.data.repositories ?? []) {
      if (!merged.some(m => m.repository === r.repository)) merged.push({ ...r });
    }
    this.state.setAiRepositories(merged);
    this.state.loadRepositories(this.data.repositoryFallback ?? []);
  }

  selectionFor(repository: string): RepoCommitSelection | null {
    return this.selections()[repository] ?? null;
  }

  isRepoDone(repository: string): boolean {
    return !!this.selections()[repository]?.diff;
  }

  addRepository() {
    const repository = this.repoToAddValue();
    if (!repository || this.repoIds().includes(repository)) return;
    this.state.setAiRepositories([
      ...this.repos(),
      { repository, branch: this.data.defaultBranch ?? '', manual: true },
    ]);
    this.repoToAdd.set(null);
  }

  removeRepository(repository: string) {
    this.state.setAiRepositories(this.repos().filter(r => r.repository !== repository));
    this.state.setAiSelection(repository, null);
  }

  onRepoBranchChange(repository: string, branch: string) {
    this.state.setAiRepositories(this.repos().map(r => r.repository === repository ? { ...r, branch } : r));
  }

  onRepoSelection(repository: string, selection: RepoCommitSelection | null) {
    this.state.setAiSelection(repository, selection);
  }

  goToGenerateWithAI() {
    this.gerarPrompt();
    this.next();
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
      return this.cardData.fields["System.Description"];
    }

    return "";
  }

  extractSectionsFromGeneratedText(generatedText: string): void {
    const rcaMatch = generatedText.match(/<RCA>([\s\S]*?)<\s*\/\s*RCA>/i);
    const rootCauseAnalysis = rcaMatch ? rcaMatch[1].trim() : 'no need';

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
            // Marca que os dados do card estão prontos (habilita "Gerar com IA").
            this.showCardDetails.set(true);
            this.cdr.detectChanges();
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

  onClose(){
    let cardType = this.cardData && this.cardData.fields && this.cardData.fields['System.WorkItemType'] === 'User Story' ? 'US' : 'BUG';
    this.dialogRef.close(cardType);
  };

  gerarPrompt() {
    if(!this.hasAnyDiff() || !this.data.cardNumber || !this.reproSteps) return;

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

    // Um diff por repositório (o bug pode envolver front, back, legado…). A F6 compacta este bloco.
    const diffs = this.selectedDiffs().map(s => ({
      repository: s.repository,
      branch: s.branch,
      commit: getCommitSha(s.commit),
      message: getCommitTitle(s.commit),
      diff: s.diff,
    }));
    prompt = prompt.replace('{githubCommitDiff}', JSON.stringify(diffs, null, 2));
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
