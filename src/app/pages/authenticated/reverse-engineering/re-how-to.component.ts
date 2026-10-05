import { Component, computed, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ReCopyCommandComponent } from './re-copy-command.component';
import { REVERSE_DOCS, ReverseModule } from '../../../services/reverse-engineering.service';

/**
 * "Como gerar" (0052): o passo a passo para rodar a engenharia reversa do módulo no Claude Code da máquina do usuário —
 * pré-requisitos, onde abrir o Claude, o comando de cada documento (copiar), como acompanhar e quem aprova.
 */
@Component({
  selector: 'app-re-how-to',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, ReCopyCommandComponent],
  template: `
    <section class="how">
      <h3><mat-icon>terminal</mat-icon>Como gerar a engenharia reversa de {{ module().displayName || module().name }}</h3>
      <ol class="how__steps">
        <li>
          <b>Prepare a máquina (uma vez)</b> — skills do PRMake instaladas e o mapa dos repositórios atualizado:
          <div class="cmd"><code>{{ installCmd }}</code><button type="button" (click)="copy(installCmd)" matTooltip="Copiar"><mat-icon>content_copy</mat-icon></button></div>
          <div class="cmd"><code>{{ reposCmd }}</code><button type="button" (click)="copy(reposCmd)" matTooltip="Copiar"><mat-icon>content_copy</mat-icon></button></div>
        </li>
        <li>
          <b>Abra o Claude Code na pasta do código do módulo</b>:
          <ul class="how__sources">
            @for (s of module().sources; track s.repository + (s.path ?? '')) {
              <li><code>{{ s.repository }}{{ s.path ? '/' + s.path : '' }}</code> <span class="muted">({{ roleLabel(s.role) }})</span></li>
            } @empty {
              <li class="warn">Fontes ainda não cadastradas — um aprovador cadastra em <b>Fontes e apelidos</b> (abaixo).</li>
            }
          </ul>
          @if (!module().configured) { <div class="muted">Fontes sugeridas pelo projeto — confirme antes de gerar.</div> }
          @if (isLegacy()) {
            <div class="warn">Legado: o <code>edv-solvace</code> inteiro não é o módulo — a fonte precisa da subpasta (ex.:
              <code>solvace-asp/systems/&lt;sigla&gt;</code> e <code>solvace-core/&lt;módulo&gt;</code>; veja "Onde está" na Base Solvace).</div>
          }
          @if (module().projectKind === 'revamp') {
            <div class="muted">Revamp: o back (<code>revamp-…</code>) e o front (<code>edv-solvace-apps/projects/…</code>) entram juntos — o Claude lê os dois.</div>
          }
        </li>
        <li>
          <b>Rode o comando do documento</b> (um por vez, ou todos em sequência):
          <div class="how__cmds">
            @for (d of docs; track d.key) {
              <div class="cmd">
                <mat-icon class="cmd__icon">{{ d.icon }}</mat-icon><span class="cmd__label">{{ d.short }}</span>
                <code>/engenharia-reversa {{ module().key }} {{ d.key }}</code>
                <button type="button" (click)="copy('/engenharia-reversa ' + module().key + ' ' + d.key)" matTooltip="Copiar"><mat-icon>content_copy</mat-icon></button>
              </div>
            }
            <div class="cmd cmd--all">
              <mat-icon class="cmd__icon">playlist_play</mat-icon><span class="cmd__label">Todos</span>
              <code>/engenharia-reversa {{ module().key }} tudo</code>
              <button type="button" (click)="copy('/engenharia-reversa ' + module().key + ' tudo')" matTooltip="Copiar"><mat-icon>content_copy</mat-icon></button>
            </div>
          </div>
          <div class="muted"><b>Visão prática</b> (para quem usa o sistema: como chegar, como fazer, perguntas práticas) — só depois que os demais exigidos forem
            aprovados e publicados; é escrita só do que foi publicado.</div>
          <div class="muted"><b>Já publicado?</b> "melhorar" vê o que mudou no código e no banco desde a versão publicada e aplica as sugestões das
            análises e a nota do revisor. Ordem recomendada no "tudo": arquitetura → UI/UX → funcional → visão → spec. arquitetura → spec. design.</div>
          <!-- 0056: todo comando com o botão de copiar -->
          <div class="how__cmds">
            @for (d of docs; track d.key) {
              <app-copy-command [command]="'/engenharia-reversa ' + module().key + ' melhorar ' + d.key" [label]="'Melhorar ' + d.short" icon="auto_fix_high" [block]="true" />
            }
          </div>
          <details class="how__redo">
            <summary class="muted">Refazer do zero (mantém os IDs)</summary>
            @for (d of docs; track d.key) {
              <app-copy-command [command]="'/engenharia-reversa ' + module().key + ' refazer ' + d.key" [label]="d.short" icon="restart_alt" [block]="true" />
            }
          </details>
        </li>
        <li>
          <b>Banco de dados</b>: o Claude lê <b>direto do banco {{ dbLabel() }}</b> (somente leitura) as views, procedures, functions, triggers, check
          constraints e jobs do módulo — deixe a <b>VPN ligada</b> e a credencial do servidor cadastrada na máquina
          (<code>prmake-skills.sh db-credentials</code>). Scripts SQL versionados no repositório não são usados.
        </li>
        <li>
          <b>UI/UX</b>: antes de gerar UI/UX e Spec. design, anexe na aba <b>UI/UX</b> os links do Figma/protótipo ou as imagens — o Claude compara com o que está implementado.
        </li>
        <li>
          <b>Acompanhe aqui, ao vivo</b>: cada documento mostra as etapas (inventário do código → leitura por área → checagem de cobertura → envio), o que o
          Claude está fazendo agora e o rascunho crescendo. Nada a fazer nesta tela até ele enviar.
        </li>
        <li>
          <b>Revise e publique</b> ({{ approvers() }}): na aba do documento, veja o que mudou por item, a cobertura do código e os avisos; aprove e publique
          — ou peça ajustes (a nota volta para o Claude na próxima sessão). Publicado, fica ativo na Base Solvace e nas análises de bug.
        </li>
      </ol>
    </section>
  `,
  styles: [`
    .how { padding: 14px 18px; border-radius: 10px; background: rgba(88,166,255,.06); border: 1px solid rgba(88,166,255,.25); margin: 12px 0; }
    .how h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 15px; }
    .how h3 mat-icon { color: var(--mat-sys-primary); }
    .how__steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 10px; font-size: 13.5px; line-height: 1.5; }
    .how__sources { margin: 4px 0; padding-left: 18px; }
    .how__cmds { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; }
    .cmd { display: flex; align-items: center; gap: 8px; margin: 4px 0; padding: 4px 6px 4px 10px; border-radius: 6px; background: rgba(0,0,0,.3); max-width: 760px; }
    .cmd code { flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; font-family: 'JetBrains Mono', monospace; font-size: 12.5px; }
    .cmd button { border: none; background: transparent; color: inherit; cursor: pointer; opacity: .7; display: inline-flex; }
    .cmd button:hover { opacity: 1; }
    .cmd button mat-icon, .cmd__icon { font-size: 17px; width: 17px; height: 17px; }
    .cmd__label { width: 120px; flex: none; font-size: 12px; opacity: .8; }
    .cmd--all { border: 1px dashed rgba(255,255,255,.18); }
    .how__redo { margin: 4px 0; }
    .how__redo summary { cursor: pointer; }
    .muted { font-size: 12px; opacity: .7; margin-top: 4px; }
    .warn { font-size: 12.5px; color: #d29922; margin-top: 4px; }
    code { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; }
  `]
})
export class ReHowToComponent {
  private snack = inject(MatSnackBar);
  module = input.required<ReverseModule>();
  approverRoles = input<string[]>([]);
  reference = input<{ environment: string; host: string; global: string; locals: string[] } | null | undefined>(null);
  readonly docKeys = REVERSE_DOCS.map(d => d.key).join(' · ');
  dbLabel = computed(() => { const r = this.reference(); return r ? `${r.environment} (${r.global} + ${r.locals.length} locais)` : 'de referência (DEMO)'; });
  readonly docs = REVERSE_DOCS;
  readonly installCmd = 'bash ~/.claude/skills/.prmake/prmake-skills.sh update engenharia-reversa';
  readonly reposCmd = 'bash ~/.claude/skills/.prmake/prmake-skills.sh repos scan';
  isLegacy = computed(() => this.module().projectKind === 'legacy');
  approvers = computed(() => this.approverRoles().length ? `papéis ${this.approverRoles().join(' ou ')}` : 'aprovadores');

  roleLabel(role: string) {
    return role === 'frontend' ? 'front' : role === 'database' ? 'banco' : role === 'backend' ? 'back' : role;
  }

  copy(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => this.snack.open('Copiado — cole no Claude Code aberto na pasta do módulo', 'OK', { duration: 2500 }),
      () => this.snack.open(text, 'OK', { duration: 6000 }));
  }
}
