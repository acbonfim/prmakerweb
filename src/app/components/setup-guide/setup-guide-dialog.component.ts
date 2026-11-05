import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GlobalService } from '../../services/global.service';
import { UserIntegration } from '../../services/user-integration.service';
import { AGENT_INSTALL_COMMAND } from '../execution-plan/execution-queue.model';
import { ExecutorsDialogComponent } from '../executors-dialog/executors-dialog.component';
import { MyIntegrationsDialogComponent, MyIntegrationsDialogData } from '../my-integrations-dialog/my-integrations-dialog.component';
import { SkillsDialogComponent } from '../skills-dialog/skills-dialog.component';
import { IntegrationGuide, devOpsContext, devOpsProfileGuide, fieldValue, guideFor } from './integration-guides';
import { SetupGuideService, SetupStepId, SetupStepStatus } from './setup-guide.service';

type Os = 'unix' | 'windows';
type Section = SetupStepId | 'card';

interface IntegrationRow {
  key: string;
  guide: IntegrationGuide;
  integration?: UserIntegration;
  /** Por que não precisa (ex.: provedor de IA escolhido é outro). */
  skipReason?: string;
}

const POLL_MS = 30_000;
/** Ordem do passo a passo: primeiro o que bloqueia, depois o opcional. */
const ORDER = ['AzureDevOps Configurations', 'devops-profile', 'Github Configurations', 'AI Configurations', 'Claude Plugin', 'Gemini Plugin', 'Teams Configurations'];

/**
 * 0083: "Primeiros passos no PRMake" — o caminho completo para o Claude analisar os cards pela tela: integrações
 * pessoais (com o passo a passo de cada token/chave), Claude Code, skills, bancos e executor. Cada etapa mostra o status
 * real (integrações pelo plugin; máquina pelo diagnóstico do executor) e abre a tela de configuração no ponto certo.
 */
@Component({
  selector: 'app-setup-guide-dialog',
  standalone: true,
  imports: [NgTemplateOutlet, MatButtonModule, MatButtonToggleModule, MatCheckboxModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="sg">
      <header class="sg__head">
        <mat-icon class="sg__lead">rocket_launch</mat-icon>
        <div class="sg__titles">
          <span class="sg__title">Primeiros passos no PRMake</span>
          <span class="sg__sub">O que falta para o Claude analisar os seus cards pela tela — uns 15 minutos, uma vez só.</span>
        </div>
        <button mat-icon-button (click)="ref.close()" aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>

      <div class="sg__progress" role="status">
        <div class="sg__bar" aria-hidden="true"><span [style.width.%]="percent()"></span></div>
        <span class="sg__progress-text">
          @if (setup.complete()) {
            <mat-icon class="ok">check_circle</mat-icon> Tudo pronto: o PRMake já pode analisar os seus cards.
          } @else {
            {{ setup.requiredDone() }} de {{ setup.requiredTotal() }} etapas obrigatórias prontas
          }
        </span>
        <button mat-button class="sg__refresh" (click)="refresh()" [disabled]="setup.loading()" matTooltip="Ler o status de novo (integrações e máquinas)">
          @if (setup.loading()) { <mat-spinner diameter="16"></mat-spinner> } @else { <mat-icon>refresh</mat-icon> }
          Verificar
        </button>
      </div>

      <div class="sg__body">
        <div class="sg__need">
          <b>Tenha em mãos:</b> acesso ao Azure DevOps{{ org() ? ' (' + org() + ')' : '' }}, conta do GitHub{{ owner() ? ' na organização ' + owner() : '' }},
          a conta do Claude Code, uma chave de API de IA (Anthropic ou Google), a VPN e um computador que possa ficar ligado.
        </div>

        <!-- 1. Integrações -->
        <section class="st" [class.st--open]="open() === 'integrations'">
          <button type="button" class="st__head" (click)="toggle('integrations')" [attr.aria-expanded]="open() === 'integrations'">
            <ng-container *ngTemplateOutlet="num; context: { n: 1, s: status('integrations') }"></ng-container>
            <span class="st__titles">
              <span class="st__title">Minhas integrações — tokens e chaves pessoais</span>
              <span class="st__detail">{{ status('integrations').detail }}</span>
            </span>
            <ng-container *ngTemplateOutlet="chip; context: { s: status('integrations') }"></ng-container>
            <mat-icon class="st__chevron">expand_more</mat-icon>
          </button>
          @if (open() === 'integrations') {
            <div class="st__body">
              <p>Cada pessoa usa as próprias credenciais: o PRMake lê e move o card no DevOps e abre os PRs no GitHub <b>em seu nome</b>.
                Gere cada token pelo passo a passo e cole em <b>Minhas integrações</b>.</p>
              @if (setup.integrationsError()) {
                <p class="err"><mat-icon>error_outline</mat-icon> Não consegui ler as suas integrações. Tente "Verificar" ou abra Minhas integrações.</p>
              }
              @for (row of rows(); track row.key) {
                <article class="it" [class.it--open]="guideOpen() === row.key">
                  <div class="it__head">
                    <mat-icon class="it__icon">{{ row.guide.icon }}</mat-icon>
                    <span class="it__titles">
                      <span class="it__title">{{ row.guide.title }}</span>
                      @if (row.integration) { <span class="it__plugin">{{ row.integration.description }}</span> }
                    </span>
                    @if (row.integration; as i) {
                      @if (i.configured) { <span class="chip chip--ok"><mat-icon>check_circle</mat-icon>Configurado</span> }
                      @else if (row.skipReason) { <span class="chip chip--muted" [matTooltip]="row.skipReason">Não precisa</span> }
                      @else if (i.optional) { <span class="chip chip--opt"><mat-icon>radio_button_unchecked</mat-icon>Opcional</span> }
                      @else { <span class="chip chip--pending"><mat-icon>warning</mat-icon>Pendente</span> }
                    } @else {
                      <span class="chip chip--muted">Consulta</span>
                    }
                    <button mat-button class="it__how" (click)="toggleGuide(row.key)" [attr.aria-expanded]="guideOpen() === row.key">
                      <mat-icon>{{ guideOpen() === row.key ? 'expand_less' : 'help_outline' }}</mat-icon>{{ row.integration ? 'Como obter' : 'Ver' }}
                    </button>
                    @if (row.integration) {
                      <button mat-stroked-button class="it__fill" (click)="fill(row.integration)">
                        <mat-icon>edit</mat-icon>{{ row.integration.configured ? 'Revisar' : 'Preencher' }}
                      </button>
                    }
                  </div>
                  @if (guideOpen() === row.key) {
                    <div class="gd">
                      <p class="gd__why" [innerHTML]="row.guide.why"></p>
                      @if (row.skipReason) { <p class="gd__skip"><mat-icon>info</mat-icon>{{ row.skipReason }}</p> }
                      <ol class="gd__steps">
                        @for (s of row.guide.steps; track $index) { <li [innerHTML]="s"></li> }
                      </ol>
                      @if (row.guide.note) { <p class="gd__note"><mat-icon>shield</mat-icon><span [innerHTML]="row.guide.note"></span></p> }
                      @if (row.guide.links.length) {
                        <div class="gd__links">
                          @for (l of row.guide.links; track l.url) {
                            <a mat-stroked-button [href]="l.url" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon>{{ l.label }}</a>
                          }
                        </div>
                      }
                    </div>
                  }
                </article>
              }
              <div class="st__actions">
                <button mat-flat-button color="primary" (click)="fill()"><mat-icon>hub</mat-icon>Abrir Minhas integrações</button>
              </div>
            </div>
          }
        </section>

        <!-- 2. Claude Code -->
        <section class="st" [class.st--open]="open() === 'claude'">
          <button type="button" class="st__head" (click)="toggle('claude')" [attr.aria-expanded]="open() === 'claude'">
            <ng-container *ngTemplateOutlet="num; context: { n: 2, s: status('claude') }"></ng-container>
            <span class="st__titles">
              <span class="st__title">Claude Code na sua máquina</span>
              <span class="st__detail">{{ status('claude').detail }}</span>
            </span>
            <ng-container *ngTemplateOutlet="chip; context: { s: status('claude') }"></ng-container>
            <mat-icon class="st__chevron">expand_more</mat-icon>
          </button>
          @if (open() === 'claude') {
            <div class="st__body">
              <p>Quem analisa os cards é o Claude Code rodando no <b>seu computador</b>, com a sua conta do Claude (a assinatura do
                Claude Code — não é a chave de API da etapa 1).</p>
              <mat-button-toggle-group class="os" [value]="os()" (change)="os.set($event.value)" hideSingleSelectionIndicator>
                <mat-button-toggle value="unix"><mat-icon>laptop_mac</mat-icon> macOS / Linux</mat-button-toggle>
                <mat-button-toggle value="windows"><mat-icon>desktop_windows</mat-icon> Windows</mat-button-toggle>
              </mat-button-toggle-group>
              <ol class="gd__steps">
                <li>{{ os() === 'windows' ? 'No PowerShell:' : 'No terminal:' }}
                  <ng-container *ngTemplateOutlet="cmd; context: { c: claudeInstall() }"></ng-container></li>
                <li>Abra um terminal novo, rode <code>claude</code> e faça o login com a sua conta (comando <code>/login</code>).</li>
                @if (os() === 'windows') {
                  <li>O Claude Code no Windows usa o <b>Git Bash</b>: se não tiver o Git for Windows, o instalador das skills (etapa 3) instala.</li>
                }
              </ol>
              <div class="gd__links">
                <a mat-stroked-button href="https://code.claude.com/docs/en/setup" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon>Instalação (docs)</a>
                <a mat-stroked-button href="https://claude.com/product/claude-code" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon>Claude Code</a>
              </div>
              <ng-container *ngTemplateOutlet="manualBox; context: { id: 'claude', text: 'Já instalei e fiz login' }"></ng-container>
            </div>
          }
        </section>

        <!-- 3. Skills -->
        <section class="st" [class.st--open]="open() === 'skills'">
          <button type="button" class="st__head" (click)="toggle('skills')" [attr.aria-expanded]="open() === 'skills'">
            <ng-container *ngTemplateOutlet="num; context: { n: 3, s: status('skills') }"></ng-container>
            <span class="st__titles">
              <span class="st__title">Skills do PRMake no Claude Code</span>
              <span class="st__detail">{{ status('skills').detail }}</span>
            </span>
            <ng-container *ngTemplateOutlet="chip; context: { s: status('skills') }"></ng-container>
            <mat-icon class="st__chevron">expand_more</mat-icon>
          </button>
          @if (open() === 'skills') {
            <div class="st__body">
              <p>As skills (<code>analisar-bug</code>, <code>gerar-prmake</code>, <code>base-solvace</code>…) ensinam o Claude a trabalhar com o
                PRMake. Um comando instala tudo — com a sua <b>API Key</b> pessoal — e registra o MCP do PRMake; depois elas se atualizam sozinhas.</p>
              <ol class="gd__steps">
                <li>Abra <b>Skills do Claude</b> e clique em <b>Gerar API Key e montar o comando</b>.</li>
                <li>Escolha o sistema, copie o comando e rode {{ os() === 'windows' ? 'no PowerShell' : 'no terminal' }}.</li>
                <li>Feche e abra o Claude Code. Para conferir: <ng-container *ngTemplateOutlet="cmd; context: { c: doctorCommand }"></ng-container></li>
              </ol>
              <div class="st__actions">
                <button mat-flat-button color="primary" (click)="openSkills()"><mat-icon>smart_toy</mat-icon>Abrir Skills do Claude</button>
              </div>
              <ng-container *ngTemplateOutlet="manualBox; context: { id: 'skills', text: 'Já instalei as skills' }"></ng-container>
            </div>
          }
        </section>

        <!-- 4. Bancos -->
        <section class="st" [class.st--open]="open() === 'databases'">
          <button type="button" class="st__head" (click)="toggle('databases')" [attr.aria-expanded]="open() === 'databases'">
            <ng-container *ngTemplateOutlet="num; context: { n: 4, s: status('databases') }"></ng-container>
            <span class="st__titles">
              <span class="st__title">Acesso de leitura aos bancos dos clientes</span>
              <span class="st__detail">{{ status('databases').detail }}</span>
            </span>
            <ng-container *ngTemplateOutlet="chip; context: { s: status('databases') }"></ng-container>
            <mat-icon class="st__chevron">expand_more</mat-icon>
          </button>
          @if (open() === 'databases') {
            <div class="st__body">
              <p>Muitos bugs dependem de dados do cliente. Sem acesso, a análise para em <b>"Aguardando você"</b> até você liberar.</p>
              <ol class="gd__steps">
                <li>Conecte a <b>VPN</b> (os servidores só respondem com ela).</li>
                <li>Peça ao gestor/infra, pelo canal oficial, um usuário <b>somente leitura</b>.</li>
                <li><b>No seu terminal</b> (não no chat do Claude) rode o comando abaixo: ele pergunta servidor, usuário e senha, grava só na sua máquina e testa.
                  <ng-container *ngTemplateOutlet="cmd; context: { c: dbCommand }"></ng-container></li>
              </ol>
              <p class="gd__note"><mat-icon>block</mat-icon><span><b>Nunca</b> cole senha no chat do Claude, em comentário do PRMake ou no Teams. Se colou, troque a senha.</span></p>
              <ng-container *ngTemplateOutlet="manualBox; context: { id: 'databases', text: 'Já configurei' }"></ng-container>
            </div>
          }
        </section>

        <!-- 5. Executor -->
        <section class="st" [class.st--open]="open() === 'executor'">
          <button type="button" class="st__head" (click)="toggle('executor')" [attr.aria-expanded]="open() === 'executor'">
            <ng-container *ngTemplateOutlet="num; context: { n: 5, s: status('executor') }"></ng-container>
            <span class="st__titles">
              <span class="st__title">Executor — o Claude rodando pela tela</span>
              <span class="st__detail">{{ status('executor').detail }}</span>
            </span>
            <ng-container *ngTemplateOutlet="chip; context: { s: status('executor') }"></ng-container>
            <mat-icon class="st__chevron">expand_more</mat-icon>
          </button>
          @if (open() === 'executor') {
            <div class="st__body">
              <p>O executor deixa a sua máquina pegar as análises pedidas pela tela (<b>Analisar com Claude</b>, respostas, <b>Continuar</b>)
                sem abrir o terminal. Ele também roda o <b>diagnóstico</b> que confirma as etapas 2 a 4 aqui.</p>
              <ol class="gd__steps">
                <li>Com as skills instaladas, rode {{ os() === 'windows' ? 'no Git Bash' : 'no terminal' }}:
                  <ng-container *ngTemplateOutlet="cmd; context: { c: agentCommand }"></ng-container></li>
                <li>Tenha os repositórios clonados (em qualquer pasta — o executor procura) e com permissão de <b>push</b> pelo seu git.
                  Mais de um clone do mesmo repositório? Escolha em Meus executores → Repositórios.</li>
                <li>Deixe a máquina ligada, com o Claude Code logado (e a VPN, para os bancos).</li>
              </ol>
              @if (setup.worker(); as w) {
                <div class="wk">
                  <span class="wk__dot" [class.wk__dot--on]="w.online && w.status === 'active'"></span>
                  <b>{{ w.name }}</b>
                  <span class="wk__meta">{{ w.status === 'paused' ? 'pausada' : w.online ? 'online' : 'offline' }}
                    {{ w.agentVersion ? ' · executor ' + w.agentVersion : '' }}{{ w.claudeVersion ? ' · Claude Code ' + w.claudeVersion : '' }}</span>
                </div>
                @if (problems().length) {
                  <ul class="dr">
                    @for (c of problems(); track c.name) {
                      <li [class.dr--warn]="c.severity === 'warning'">
                        <mat-icon>{{ c.severity === 'warning' ? 'warning' : 'error' }}</mat-icon>
                        <span><b>{{ c.name }}</b>{{ c.message ? ': ' + c.message : '' }}</span>
                      </li>
                    }
                  </ul>
                }
              }
              <div class="st__actions">
                <button mat-flat-button color="primary" (click)="openExecutors()"><mat-icon>dns</mat-icon>Abrir Meus executores</button>
              </div>
            </div>
          }
        </section>

        <!-- 6. Primeiro card -->
        <section class="st" [class.st--open]="open() === 'card'">
          <button type="button" class="st__head" (click)="toggle('card')" [attr.aria-expanded]="open() === 'card'">
            <span class="num" [class.num--done]="setup.complete()">@if (setup.complete()) { <mat-icon>flag</mat-icon> } @else { 6 }</span>
            <span class="st__titles">
              <span class="st__title">Analise o primeiro card</span>
              <span class="st__detail">{{ setup.complete() ? 'Tudo pronto — pode começar' : 'Depois das etapas obrigatórias' }}</span>
            </span>
            <mat-icon class="st__chevron">expand_more</mat-icon>
          </button>
          @if (open() === 'card') {
            <div class="st__body">
              <ol class="gd__steps">
                <li>Na tela do card, digite o número do card do DevOps e aperte <b>Enter</b>.</li>
                <li>Clique em <b>Analisar com Claude</b>: o plano aparece ao vivo, etapa por etapa.</li>
                <li>Quando uma etapa perguntar algo, <b>responda nela</b>. Dúvidas vão para o <b>Especialista do caso</b>.</li>
              </ol>
              <div class="st__actions">
                <button mat-flat-button color="primary" (click)="ref.close('card')"><mat-icon>arrow_forward</mat-icon>Ir para a tela do card</button>
              </div>
            </div>
          }
        </section>
      </div>

      <footer class="sg__foot">
        <span class="sg__hint">Para voltar aqui: menu do usuário → <b>Primeiros passos</b>.</span>
        <span class="sg__spacer"></span>
        <button mat-button (click)="ref.close()">Fechar</button>
      </footer>
    </div>

    <ng-template #num let-n="n" let-s="s">
      <span class="num" [class.num--done]="s.state === 'done'" [class.num--opt]="!s.required && s.state !== 'done'">
        @if (s.state === 'done') { <mat-icon>check</mat-icon> } @else { {{ n }} }
      </span>
    </ng-template>

    <ng-template #chip let-s="s">
      @switch (s.state) {
        @case ('done') { <span class="chip chip--ok" [matTooltip]="s.verified ? 'Confirmado' : 'Marcado por você'"><mat-icon>{{ s.verified ? 'check_circle' : 'task_alt' }}</mat-icon>Pronto</span> }
        @case ('recommended') { <span class="chip chip--opt"><mat-icon>radio_button_unchecked</mat-icon>Recomendado</span> }
        @case ('manual') { <span class="chip chip--muted"><mat-icon>schedule</mat-icon>A fazer</span> }
        @default { <span class="chip chip--pending"><mat-icon>warning</mat-icon>Pendente</span> }
      }
    </ng-template>

    <ng-template #cmd let-c="c">
      <div class="cmd">
        <code>{{ c }}</code>
        <button mat-icon-button (click)="copy(c)" matTooltip="Copiar"><mat-icon>content_copy</mat-icon></button>
      </div>
    </ng-template>

    <ng-template #manualBox let-id="id" let-text="text">
      @if (!status(id).verified) {
        <mat-checkbox class="manual" [checked]="isManual(id)" (change)="setup.setManual(id, $event.checked)">{{ text }}</mat-checkbox>
      }
    </ng-template>
  `,
  styles: [`
    .sg { display: flex; flex-direction: column; max-height: 90vh; color: var(--mat-sys-on-surface); background: var(--surface-1, #2a2a2a); }
    .sg__head { display: flex; align-items: center; gap: 10px; padding: 14px 10px 14px 20px; background: var(--surface-2, #323232); }
    .sg__lead { color: var(--mat-sys-primary); }
    .sg__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .sg__title { font-weight: 600; font-size: 16px; }
    .sg__sub { font-size: 12px; opacity: .65; }
    .sg__progress { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 10px 20px; border-bottom: 1px solid rgba(255,255,255,.06); }
    .sg__bar { flex: 1 1 160px; height: 6px; border-radius: 3px; background: rgba(255,255,255,.08); overflow: hidden; }
    .sg__bar span { display: block; height: 100%; background: var(--mat-sys-primary); transition: width .3s; }
    .sg__progress-text { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; }
    .sg__progress-text .ok { color: #3fb950; font-size: 18px; width: 18px; height: 18px; }
    .sg__refresh mat-spinner { display: inline-block; margin-right: 6px; }
    .sg__body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 20px 18px; display: flex; flex-direction: column; gap: 8px; }
    .sg__need { font-size: 12.5px; padding: 9px 12px; border-radius: 10px; background: rgba(142,108,240,.1); border: 1px solid rgba(196,167,255,.22); line-height: 1.5; }
    .sg__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 16px; background: var(--surface-2, #323232); }
    .sg__hint { font-size: 12px; opacity: .65; }
    .sg__spacer { flex: 1; }

    .st { border: 1px solid rgba(255,255,255,.08); border-radius: 12px; background: rgba(255,255,255,.02); }
    .st--open { border-color: rgba(196,167,255,.3); }
    .st__head { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: none; border: 0; color: inherit; text-align: left; cursor: pointer; font: inherit; border-radius: 12px; }
    .st__head:hover { background: rgba(255,255,255,.03); }
    .st__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .st__title { font-weight: 600; font-size: 13.5px; }
    .st__detail { font-size: 12px; opacity: .65; overflow: hidden; text-overflow: ellipsis; }
    .st__chevron { opacity: .6; transition: transform .2s; }
    .st--open .st__chevron { transform: rotate(180deg); }
    .st__body { padding: 0 14px 14px 52px; font-size: 13px; }
    .st__body > p { margin: 0 0 10px; line-height: 1.55; opacity: .85; }
    .st__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }

    .num { flex: none; width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700;
      background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); }
    .num .mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .num--done { background: #2ea043; color: #fff; }
    .num--opt { background: rgba(255,255,255,.12); color: inherit; }

    .chip { flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 11.5px; white-space: nowrap; }
    .chip .mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .chip--ok { color: #3fb950; background: rgba(63,185,80,.12); }
    .chip--pending { color: #d29922; background: rgba(210,153,34,.14); }
    .chip--opt { color: #8b949e; background: rgba(139,148,158,.14); }
    .chip--muted { color: #8b949e; background: rgba(139,148,158,.1); }

    .it { border-top: 1px solid rgba(255,255,255,.06); padding: 8px 0; }
    .it__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
    .it__icon { color: var(--mat-sys-primary); flex: none; }
    .it__titles { flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; }
    .it__title { font-weight: 600; font-size: 13px; }
    .it__plugin { font-size: 11.5px; opacity: .55; }
    .gd { margin: 8px 0 4px 34px; padding: 10px 12px; border-radius: 10px; background: rgba(0,0,0,.18); }
    .gd__why { margin: 0 0 6px; opacity: .85; }
    .gd__skip { display: flex; gap: 6px; align-items: center; margin: 0 0 6px; font-size: 12px; opacity: .75; }
    .gd__skip .mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .gd__steps { margin: 4px 0 8px; padding-left: 20px; line-height: 1.6; }
    .gd__steps li { margin-bottom: 4px; }
    .gd__note { display: flex; gap: 6px; align-items: flex-start; margin: 4px 0 8px; font-size: 12px; padding: 6px 10px; border-radius: 8px;
      background: rgba(210,153,34,.08); border: 1px solid rgba(210,153,34,.25); }
    .gd__note .mat-icon { flex: none; color: #d29922; font-size: 16px; width: 16px; height: 16px; margin-top: 1px; }
    .gd__links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .gd__links .mat-icon { font-size: 16px; width: 16px; height: 16px; }
    :host ::ng-deep .gd a:not(.mat-mdc-button-base), :host ::ng-deep .gd__steps a { color: var(--mat-sys-primary); }
    code { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 11.5px; background: rgba(255,255,255,.07); padding: 0 4px; border-radius: 4px; color: #e6edf3; }
    :host ::ng-deep .gd code, :host ::ng-deep .gd__steps code { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 11.5px; background: rgba(255,255,255,.07); padding: 0 4px; border-radius: 4px; color: #e6edf3; }

    .cmd { display: flex; align-items: center; gap: 6px; margin: 6px 0 2px; padding: 4px 4px 4px 12px; border-radius: 8px; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.08); }
    .cmd code { flex: 1; min-width: 0; background: none; padding: 0; word-break: break-all; white-space: pre-wrap; color: #c9d1d9; font-size: 12px; }
    .os { margin: 0 0 8px; font-size: 12.5px; }
    .os .mat-icon { font-size: 17px; width: 17px; height: 17px; vertical-align: -3px; margin-right: 4px; }
    .manual { display: block; margin-top: 6px; font-size: 12.5px; }
    .err { display: flex; gap: 6px; align-items: center; color: var(--mat-sys-error, #f2b8b5); }

    .wk { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; font-size: 12.5px; }
    .wk__dot { width: 9px; height: 9px; border-radius: 50%; background: #8b949e; }
    .wk__dot--on { background: #3fb950; }
    .wk__meta { opacity: .65; }
    .dr { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
    .dr li { display: flex; gap: 6px; align-items: flex-start; }
    .dr .mat-icon { flex: none; font-size: 16px; width: 16px; height: 16px; color: #f85149; }
    .dr--warn .mat-icon { color: #d29922; }

    @media (max-width: 600px) {
      .st__body { padding-left: 14px; }
      .gd { margin-left: 0; }
      .st__head .chip { display: none; }
    }
  `]
})
export class SetupGuideDialogComponent implements OnInit, OnDestroy {
  readonly setup = inject(SetupGuideService);
  readonly ref = inject(MatDialogRef<SetupGuideDialogComponent, 'card' | undefined>);
  private readonly dialog = inject(MatDialog);
  private readonly global = inject(GlobalService);

  readonly open = signal<Section | null>(null);
  readonly guideOpen = signal<string | null>(null);
  readonly os = signal<Os>(/win/i.test(navigator.userAgent) ? 'windows' : 'unix');

  readonly agentCommand = AGENT_INSTALL_COMMAND;
  readonly doctorCommand = 'bash ~/.claude/skills/.prmake/prmake-skills.sh doctor';
  readonly dbCommand = 'bash ~/.claude/skills/.prmake/prmake-skills.sh db-credentials';
  readonly claudeInstall = computed(() => this.os() === 'windows'
    ? 'irm https://claude.ai/install.ps1 | iex'
    : 'curl -fsSL https://claude.ai/install.sh | bash');

  readonly org = computed(() => devOpsContext(this.setup.integrations()).org);
  readonly owner = computed(() => fieldValue(this.setup.integrations().find((i) => i.description === 'Github Configurations'), 'Owner'));
  readonly percent = computed(() => {
    const total = this.setup.requiredTotal();
    return total ? Math.round((this.setup.requiredDone() / total) * 100) : 0;
  });

  /** Integrações na ordem do passo a passo, com "Seus dados no Azure DevOps" logo depois do PAT. */
  readonly rows = computed<IntegrationRow[]>(() => {
    const list = this.setup.integrations();
    const provider = fieldValue(list.find((i) => i.description === 'AI Configurations'), 'Provider').toLowerCase();
    const rows: IntegrationRow[] = list.map((i) => ({
      key: i.description,
      integration: i,
      guide: guideFor(i, list),
      skipReason: this.skipReason(i, provider)
    }));
    if (list.some((i) => i.description === 'AzureDevOps Configurations')) {
      rows.push({ key: 'devops-profile', guide: devOpsProfileGuide(list) });
    }
    const rank = (key: string) => {
      const index = ORDER.indexOf(key);
      return index < 0 ? ORDER.length : index;
    };
    return rows.sort((a, b) => rank(a.key) - rank(b.key));
  });

  /** Problemas do diagnóstico da máquina (erros primeiro). */
  readonly problems = computed(() => (this.setup.worker()?.doctor ?? [])
    .filter((c) => !c.ok)
    .sort((a, b) => (a.severity === 'warning' ? 1 : 0) - (b.severity === 'warning' ? 1 : 0)));

  private timer?: ReturnType<typeof setInterval>;

  async ngOnInit(): Promise<void> {
    if (!this.setup.loaded()) await this.setup.refresh();
    this.openFirstPending();
    this.timer = setInterval(() => { if (!this.setup.loading()) void this.setup.refresh(); }, POLL_MS);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  status(id: SetupStepId): SetupStepStatus {
    return this.setup.step(id);
  }

  isManual(id: SetupStepId): boolean {
    return !!this.setup.manual()[id];
  }

  toggle(section: Section): void {
    this.open.set(this.open() === section ? null : section);
  }

  toggleGuide(key: string): void {
    this.guideOpen.set(this.guideOpen() === key ? null : key);
  }

  async refresh(): Promise<void> {
    await this.setup.refresh();
  }

  copy(text: string): void {
    this.global.copyToClipBoard(text);
  }

  /** Abre Minhas integrações (na integração escolhida) e relê o status ao fechar. */
  fill(integration?: UserIntegration): void {
    const data: MyIntegrationsDialogData = { focus: integration?.description };
    this.dialog.open(MyIntegrationsDialogComponent, {
      width: '640px', maxWidth: '94vw', maxHeight: '90vh', panelClass: 'custom-dialog-container', data
    }).afterClosed().subscribe(() => void this.setup.refresh());
  }

  openSkills(): void {
    this.dialog.open(SkillsDialogComponent, {
      width: '680px', maxWidth: '94vw', maxHeight: '92vh', panelClass: 'custom-dialog-container', autoFocus: false
    }).afterClosed().subscribe(() => void this.setup.refresh());
  }

  openExecutors(): void {
    this.dialog.open(ExecutorsDialogComponent, {
      width: '760px', maxWidth: '96vw', maxHeight: '92vh', panelClass: 'custom-dialog-container', autoFocus: false
    }).afterClosed().subscribe(() => void this.setup.refresh());
  }

  private openFirstPending(): void {
    const first = this.setup.steps().find((s) => s.required && s.state !== 'done');
    this.open.set(first?.id ?? 'card');
    // Nas integrações, já abre o passo a passo da primeira pendente.
    if (first?.id === 'integrations') {
      const pending = this.rows().find((r) => r.integration && !r.integration.configured && !r.integration.optional);
      if (pending) this.guideOpen.set(pending.key);
    }
  }

  /** O provedor de IA escolhido é outro: a chave deste não é usada. */
  private skipReason(i: UserIntegration, provider: string): string | undefined {
    if (i.configured || !provider) return undefined;
    const name = i.description.toLowerCase();
    const isProvider = name.startsWith('claude ') || name.startsWith('gemini ') || name.startsWith('openai') || name.startsWith('copilot');
    if (!isProvider || name.startsWith(provider)) return undefined;
    return `O seu provedor de IA é ${provider[0].toUpperCase()}${provider.slice(1)} — esta chave só é usada se trocar.`;
  }
}
