import { ChangeDetectorRef, Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { HttpClient } from '@angular/common/http';
import { marked } from 'marked';
import { firstValueFrom } from 'rxjs';
import { SafeHtmlPipe } from 'primeng/menu';
import { environment } from '../../../environments/environment';
import { CliipboardService } from '../../services/cliipboard.service';
import { GdsService } from '../../services/gds.service';

/**
 * Modal de Passagem de Conhecimento (handover) de um card.
 * - Sem handover salvo: sugere gerar.
 * - Com handover salvo: mostra um resumo ilustrativo (markdown renderizado + cabeçalho),
 *   permite copiar o formulário preenchido (markdown) e gerar novamente.
 *
 * A geração cruza os dados que já temos em memória (card do DevOps + histórico + comentários,
 * Pull Request salvo e linha do tempo), busca o layout mais atual no plugin (TemplatePassagemConhecimento)
 * e envia para o provider de IA configurado (endpoint AI/generate).
 */
@Component({
  selector: 'app-handover-dialog',
  standalone: true,
  templateUrl: './handover-dialog.component.html',
  styleUrl: './handover-dialog.component.css',
  providers: [HttpClient],
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSlideToggleModule,
    SafeHtmlPipe,
  ],
})
export class HandoverDialogComponent implements OnInit {
  readonly data = inject<any>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<HandoverDialogComponent>);
  private http = inject(HttpClient);
  private clipboard = inject(CliipboardService);
  private gds = inject(GdsService);
  private cdr = inject(ChangeDetectorRef);

  private urlBase = environment.apiUrl;

  loading = signal(true); // carregando handover existente
  generating = signal(false); // gerando via IA
  contentMarkdown = signal<string>(''); // markdown salvo (formulário preenchido)
  contentHtml = signal<string>(''); // markdown renderizado
  generatedAt = signal<string | null>(null);
  isPublic = signal<boolean>(true); // acesso pelo link público habilitado
  savingVisibility = signal<boolean>(false);

  get cardNumber(): string {
    return this.data?.cardNumber != null ? this.data.cardNumber.toString() : '';
  }

  get cardTitle(): string {
    return this.data?.cardFull?.fields?.['System.Title'] ?? '';
  }

  get hasHandover(): boolean {
    return !!this.contentMarkdown();
  }

  ngOnInit() {
    marked.setOptions({ gfm: true, breaks: true });
    this.loadExisting();
  }

  private loadExisting() {
    this.loading.set(true);
    this.http
      .get<any>(`${this.urlBase}Handover/GetByCardNumber?cardNumber=${encodeURIComponent(this.cardNumber)}`)
      .subscribe({
        next: (res) => {
          if (res && res.content) {
            this.applyContent(res.content, res.updatedAt || res.createdAt);
            this.isPublic.set(res.isPublic !== false);
          }
          this.loading.set(false);
          this.cdr.detectChanges();
        },
        error: () => {
          this.loading.set(false);
          this.cdr.detectChanges();
        },
      });
  }

  private applyContent(markdown: string, at?: string | null) {
    this.contentMarkdown.set(markdown);
    this.contentHtml.set(marked.parse(markdown) as string);
    this.generatedAt.set(at ?? null);
  }

  async generate() {
    if (this.generating()) return;
    this.generating.set(true);
    this.cdr.detectChanges();

    try {
      const template = await this.fetchTemplate();
      const prompt = this.buildPrompt(template);
      const raw = await this.callAi(prompt);
      const content = raw
        .replace(/^```markdown\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();

      const saved = await firstValueFrom(
        this.http.post<any>(`${this.urlBase}Handover`, {
          cardNumber: this.cardNumber,
          content,
          repositoryId: this.data?.repositoryId ?? null,
        }),
      );

      this.applyContent(content, saved?.updatedAt || saved?.createdAt);
    } catch (e) {
      console.error('Erro ao gerar handover', e);
    } finally {
      this.generating.set(false);
      this.cdr.detectChanges();
    }
  }

  private async fetchTemplate(): Promise<string> {
    // 3.1 — sempre busca o layout mais atual no plugin (AI Configurations = id 3).
    const res: any = await firstValueFrom(this.gds.getAllById(3));
    return res?.configurations?.TemplatePassagemConhecimento ?? '';
  }

  private async callAi(prompt: string): Promise<string> {
    const body = JSON.stringify(prompt);
    const res: any = await firstValueFrom(
      this.http.post(`${this.urlBase}AI/generate`, body, {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    let content = res?.content || res?.text || res;
    if (typeof content === 'object' && content?.content) content = content.content;
    return (content ?? '').toString();
  }

  private buildPrompt(template: string): string {
    const cf = this.data?.cardFull ?? {};
    const pr = this.data?.pullRequest ?? {};
    const timeline = this.data?.timeline ?? [];

    const context = {
      card: {
        numero: this.cardNumber,
        titulo: this.cardTitle,
        url: cf.url,
        campos: cf.fields,
        comentarios: cf.comments,
        historicoDeAlteracoes: cf.history,
        alertas: cf.alerts,
      },
      pullRequestSalvo: {
        descricao: pr.description,
        rootCause: pr.rootCause,
        branch: `${pr.branchPrefix ?? ''}${pr.branchName ?? ''}`,
        repositorio: this.data?.repositoryId,
      },
      linhaDoTempo: (timeline as any[]).map((t) => ({
        quando: t.createdAt,
        quem: t.userName,
        registro: t.description,
      })),
    };

    return `Você é um assistente que preenche um formulário de PASSAGEM DE CONHECIMENTO (handover) de um card de bug, para que o próximo turno dê continuidade ao tratamento sem perder contexto.

Preencha EXATAMENTE o layout abaixo, mantendo todos os títulos e a estrutura, substituindo os espaços em branco pelas informações reais, cruzando TODOS os dados fornecidos (card do DevOps, histórico de alterações, comentários, Pull Request salvo e linha do tempo). Onde não houver informação, escreva "—".

Regras:
- Responda em português.
- Saída em MARKDOWN, contendo APENAS o formulário preenchido, sem nenhum texto antes ou depois e sem blocos de código (\`\`\`).
- Seja objetivo e técnico; priorize o que ajuda o próximo turno a continuar (o que já foi investigado, onde está o problema, o que foi descartado, causa provável e próximo passo).

LAYOUT A PREENCHER:
${template}

DADOS DISPONÍVEIS (JSON):
${JSON.stringify(context, null, 2)}
`;
  }

  copy() {
    this.clipboard.copyFullDescriptionToClipboard(this.contentMarkdown());
  }

  /** Copia o link público (somente leitura) desta passagem de conhecimento. */
  copyPublicLink() {
    const link = `${window.location.origin}/handover/${encodeURIComponent(this.cardNumber)}`;
    this.clipboard.copyFullDescriptionToClipboard(link);
  }

  /** Habilita/desabilita o acesso pelo link público e persiste a alteração. */
  setVisibility(isPublic: boolean) {
    if (this.savingVisibility()) return;
    const previous = this.isPublic();
    this.isPublic.set(isPublic);
    this.savingVisibility.set(true);
    this.cdr.detectChanges();

    this.http
      .put<any>(`${this.urlBase}Handover/${encodeURIComponent(this.cardNumber)}/visibility`, { isPublic })
      .subscribe({
        next: () => {
          this.savingVisibility.set(false);
          this.cdr.detectChanges();
        },
        error: () => {
          // Reverte visualmente se a persistência falhar.
          this.isPublic.set(previous);
          this.savingVisibility.set(false);
          this.cdr.detectChanges();
        },
      });
  }

  close() {
    this.dialogRef.close();
  }
}
