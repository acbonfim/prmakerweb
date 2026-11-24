import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  DECISION_LABEL, EFFECT_LABEL, EvaluateRequest, EvaluateResponse, GovSource, GovernanceRule, MODE_LABEL, SOURCES, SOURCE_LABEL,
} from '../../../../services/governance/governance.model';
import { apiErrorMessage } from '../../../../services/governance/governance.logic';
import { GovernanceStore } from '../governance.store';

interface Example {
  label: string;
  req: Partial<EvaluateRequest>;
}

/**
 * Simulador de regras (0098): monta um pedido de exemplo (comando, ferramenta, ação, caminho) e chama
 * `POST rules/test` — com a regra em edição como rascunho — mostrando a decisão agora e no modo "aplicando".
 */
@Component({
  selector: 'app-gov-rule-simulator',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="panel__head"><h3>Simulador</h3><span class="muted">testa sem gravar nada</span></div>
    <div class="examples">
      @for (x of examples; track x.label) {
        <button type="button" class="pill ex" (click)="use(x)">{{ x.label }}</button>
      }
    </div>
    <div class="form-grid">
      <label class="f-field"><span>Origem</span>
        <select [ngModel]="source()" (ngModelChange)="source.set($event)">
          @for (s of sources; track s) { <option [value]="s">{{ sourceLabel[s] }}</option> }
        </select>
      </label>
      <label class="f-field"><span>Ferramenta (Claude Code)</span>
        <input type="text" class="mono" placeholder="Bash, Read, mcp__prmake__…" [ngModel]="tool()" (ngModelChange)="tool.set($event)" data-usage-ignore>
      </label>
      <label class="f-field"><span>Ação</span>
        <input type="text" class="mono" placeholder="POST Azure/card/{id}/actions/… ou mcp:prmake_…" [ngModel]="action()" (ngModelChange)="action.set($event)" data-usage-ignore>
      </label>
      <label class="f-field"><span>Caminho de arquivo</span>
        <input type="text" class="mono" placeholder="/Users/…/.aws/credentials" [ngModel]="path()" (ngModelChange)="path.set($event)" data-usage-ignore>
      </label>
      <label class="f-field"><span>Card</span>
        <input type="text" inputmode="numeric" [ngModel]="card()" (ngModelChange)="card.set($event)" data-usage-ignore>
      </label>
      <label class="f-field span-all"><span>Comando / entrada da ferramenta</span>
        <textarea rows="2" placeholder="git push --force origin bugfix/12345" [ngModel]="text()" (ngModelChange)="text.set($event)" data-usage-ignore></textarea>
      </label>
    </div>
    <div class="actions-row">
      @if (draft()) {
        <label class="chk"><input type="checkbox" [ngModel]="useDraft()" (ngModelChange)="useDraft.set($event)"> Usar o rascunho desta regra (mesmo sem salvar)</label>
      }
      <span class="ms-auto"></span>
      @if (running()) { <mat-spinner diameter="18"></mat-spinner> }
      <button mat-flat-button type="button" (click)="run()" [disabled]="running()"><mat-icon>play_arrow</mat-icon> Testar</button>
    </div>

    @if (error()) { <div class="notice">{{ error() }}</div> }
    @if (result(); as r) {
      <div class="result result--{{ r.decision }}">
        <div class="result__line">
          <b>Agora ({{ modeLabel[r.mode] }}):</b> <span class="badge badge--{{ badge(r.decision) }}">{{ decisionLabel[r.decision] }}</span>
          @if (r.wouldDecide) {
            <span class="sep">·</span>
            <b>No modo "Aplicando":</b> <span class="badge badge--{{ badge(r.wouldDecide) }}">{{ decisionLabel[r.wouldDecide] }}</span>
          }
        </div>
        @if (r.reason) { <div class="muted">{{ r.reason }}</div> }
        @if (r.rules.length) {
          <ul class="hits">
            @for (h of r.rules; track h.key) {
              <li><span class="badge badge--{{ h.effect }}">{{ effectLabel[h.effect] }}</span> <b>{{ h.name }}</b> <span class="mono muted">{{ h.key }}</span>
                @if (h.message) { <div class="muted">{{ h.message }}</div> }</li>
            }
          </ul>
        } @else {
          <div class="muted">Nenhuma regra casou.</div>
        }
      </div>
    }
  `,
  styleUrls: ['../governance-shared.css'],
  styles: [`
    :host { display: block; }
    .examples { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .ex { border: 1px solid var(--cc-surface-border); cursor: pointer; color: var(--cc-text-2); font: inherit; font-size: 12px; }
    .ex:hover { color: var(--cc-text-1); }
    .chk { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; }
    .result { margin-top: 10px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--cc-surface-border); display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    .result--block { border-color: color-mix(in srgb, #d03b3b 60%, transparent); }
    .result--warn { border-color: color-mix(in srgb, #d29922 60%, transparent); }
    .result__line { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
    .sep { color: var(--cc-text-3); }
    .hits { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
  `],
})
export class GovRuleSimulatorComponent {
  private readonly store = inject(GovernanceStore);
  /** Regra em edição (rascunho), se houver. */
  readonly draft = input<GovernanceRule | null>(null);

  readonly source = signal<GovSource>('hook');
  readonly tool = signal('Bash');
  readonly action = signal('');
  readonly path = signal('');
  readonly card = signal('');
  readonly text = signal('git push --force origin bugfix/78720');
  readonly useDraft = signal(true);

  readonly running = signal(false);
  readonly result = signal<EvaluateResponse | null>(null);
  readonly error = signal<string | null>(null);

  readonly sources = SOURCES;
  readonly sourceLabel = SOURCE_LABEL;
  readonly decisionLabel = DECISION_LABEL;
  readonly effectLabel = EFFECT_LABEL;
  readonly modeLabel = MODE_LABEL;

  readonly examples: Example[] = [
    { label: 'push forçado', req: { source: 'hook', tool: 'Bash', input: 'git push --force origin bugfix/78720' } },
    { label: 'mesclar PR', req: { source: 'hook', tool: 'Bash', input: 'gh pr merge 120 --squash' } },
    { label: 'push na master', req: { source: 'hook', tool: 'Bash', input: 'git push origin master' } },
    { label: 'update no banco', req: { source: 'hook', tool: 'Bash', input: 'psql -c "update tb_wcm_site set x = 1"' } },
    { label: 'PATCH direto no DevOps', req: { source: 'hook', tool: 'Bash', input: 'curl -X PATCH https://dev.azure.com/org/_apis/wit/workitems/1' } },
    { label: 'ler credenciais', req: { source: 'hook', tool: 'Read', path: '/Users/voce/.aws/credentials' } },
    { label: 'Ready for QA (tela)', req: { source: 'screen', action: 'POST Azure/card/{id}/actions/ready-for-qa', cardNumber: 78720 } },
    { label: 'abrir PR (MCP)', req: { source: 'mcp', action: 'mcp:prmake_pr_open', cardNumber: 78720 } },
    { label: 'git status', req: { source: 'hook', tool: 'Bash', input: 'git status' } },
  ];

  use(x: Example): void {
    this.source.set(x.req.source ?? 'hook');
    this.tool.set(x.req.tool ?? '');
    this.action.set(x.req.action ?? '');
    this.path.set(x.req.path ?? '');
    this.card.set(x.req.cardNumber != null ? `${x.req.cardNumber}` : '');
    this.text.set(x.req.input ?? '');
    this.run();
  }

  run(): void {
    const card = Number(this.card().trim());
    const req: EvaluateRequest = {
      source: this.source(),
      ...(this.tool().trim() ? { tool: this.tool().trim() } : {}),
      ...(this.action().trim() ? { action: this.action().trim() } : {}),
      ...(this.path().trim() ? { path: this.path().trim() } : {}),
      ...(this.text() ? { input: this.text() } : {}),
      ...(Number.isInteger(card) && card > 0 ? { cardNumber: card } : {}),
    };
    const rule = this.draft() && this.useDraft() ? this.draft() : null;
    this.running.set(true);
    this.error.set(null);
    this.store.api.testRule({ ...req, rule }).subscribe({
      next: (r) => {
        this.result.set(r);
        this.running.set(false);
      },
      error: (e) => {
        this.running.set(false);
        this.error.set(apiErrorMessage(e, 'Não consegui testar.'));
      },
    });
  }

  badge(d: string): string {
    return d === 'block' ? 'blocked' : d === 'warn' ? 'warned' : 'ok';
  }
}
