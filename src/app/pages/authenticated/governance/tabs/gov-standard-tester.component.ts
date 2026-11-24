import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  DECISION_LABEL, EFFECT_LABEL, GovDecision, MODE_LABEL, STANDARD_CHECK_TARGETS, STANDARD_CHECK_TARGET_LABEL, Standard,
  StandardCheckRequest, StandardCheckResponse, StandardCheckTarget, StandardFinding, labelOf,
} from '../../../../services/governance/governance.model';
import { apiErrorMessage, parseBlockedBody } from '../../../../services/governance/governance.logic';
import { checkLocally } from '../../../../services/governance/standards.logic';
import { GovernanceStore } from '../governance.store';

interface Example {
  label: string;
  target: StandardCheckTarget;
  text: string;
  path?: string;
}

export interface TesterPrefill {
  text: string;
  target: StandardCheckTarget;
  path?: string;
  /** Padrão que pediu o teste (destacado nos achados). */
  focus?: string;
}

const EXAMPLES: Example[] = [
  {
    label: 'tabela fora do padrão', target: 'sql', text: `CREATE TABLE TB_ACTION_PLAN_LOG (
  Id INT IDENTITY(1,1),
  Cost MONEY NOT NULL,
  PRIMARY KEY (Id)
);
CREATE INDEX IX_Log_PlanId ON TB_ACTION_PLAN_LOG (PlanId);`,
  },
  {
    label: 'FK com cascade', target: 'sql', text: `ALTER TABLE actionPlan.ActionPlan
  ADD CONSTRAINT ActionPlanArea FOREIGN KEY (AreaId) REFERENCES area.Area (AreaId) ON DELETE CASCADE;`,
  },
  { label: 'procedure sp_', target: 'sql', text: 'CREATE PROCEDURE actionPlan.sp_ListActionPlan\nAS\n  SELECT * FROM actionPlan.ActionPlan;' },
  { label: 'view sem vw', target: 'sql', text: 'CREATE VIEW actionPlan.ActionPlanSummary AS\n  SELECT ActionPlanId, Title FROM actionPlan.ActionPlan;' },
  {
    label: 'tudo certo', target: 'sql', text: `CREATE TABLE language.StandardLanguage (
  StandardLanguageId INT IDENTITY(1,1) NOT NULL,
  LanguageId INT NOT NULL,
  CONSTRAINT PK_language_StandardLanguage PRIMARY KEY CLUSTERED (StandardLanguageId)
);
CREATE NONCLUSTERED INDEX IX_language_StandardLanguage_01 ON language.StandardLanguage (LanguageId);`,
  },
  { label: 'legado no dbo (ignorado)', target: 'sql', text: 'SELECT * FROM dbo.TB_WCM_SITE;\nCREATE PROCEDURE dbo.sp_Legacy AS SELECT 1;' },
  { label: 'migração EF cascade', target: 'migration', text: 'b.HasOne("Area").WithMany().HasForeignKey("AreaId")\n  .OnDelete(DeleteBehavior.Cascade);' },
  { label: 'rota fora do padrão', target: 'code', text: '[ApiController]\n[Route("export/[action]")]\npublic class ExportController : ControllerBase { }' },
  { label: 'controller no domínio', target: 'path', text: '', path: 'src/actionplan.domain/Controllers/ReportController.cs' },
];

/**
 * Teste da conferência dos padrões (0101): cola SQL/DDL/código (ou um caminho), escolhe o alvo e chama
 * `POST standards/check` — mostra a decisão (barrado/avisado/passa) e os achados (linha, trecho, dica). Com um padrão em
 * edição, mostra também a prévia do rascunho no navegador (regex/caminho), antes de salvar.
 */
@Component({
  selector: 'app-gov-standard-tester',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="panel__head"><h3>Testar conferência</h3><span class="muted">cola um texto e vê o que os padrões acham — a API registra os achados na trilha</span></div>
    <div class="examples">
      @for (x of examples; track x.label) {
        <button type="button" class="pill ex" (click)="use(x)">{{ x.label }}</button>
      }
    </div>
    <div class="form-grid">
      <label class="f-field"><span>Conferir como</span>
        <select [ngModel]="target()" (ngModelChange)="target.set($event)">
          @for (t of targets; track t) { <option [value]="t">{{ targetLabel[t] }}</option> }
        </select>
      </label>
      <label class="f-field"><span>Caminho do arquivo {{ target() === 'path' ? '' : '(opcional)' }}</span>
        <input type="text" class="mono" placeholder="Scripts/99_78612_ajuste.sql" [ngModel]="path()" (ngModelChange)="path.set($event)" data-usage-ignore>
      </label>
      <label class="f-field"><span>Repositório (opcional)</span>
        <input type="text" class="mono" list="tester-repos" placeholder="edv-solvace-api" [ngModel]="repository()" (ngModelChange)="repository.set($event)" data-usage-ignore>
        <datalist id="tester-repos">@for (r of repositories(); track r) { <option [value]="r"></option> }</datalist>
      </label>
      <label class="f-field"><span>Card (opcional)</span>
        <input type="text" inputmode="numeric" [ngModel]="card()" (ngModelChange)="card.set($event)" data-usage-ignore>
      </label>
      @if (target() !== 'path') {
        <label class="f-field span-all"><span>Texto (SQL, DDL, migração ou código)</span>
          <textarea rows="8" spellcheck="false" [ngModel]="text()" (ngModelChange)="text.set($event)" placeholder="CREATE TABLE …" data-usage-ignore></textarea>
        </label>
      }
    </div>
    <div class="actions-row">
      <span class="muted">Linhas do <code>dbo</code> e do histórico do EF ficam fora (escopo da wiki).</span>
      <span class="ms-auto"></span>
      @if (running()) { <mat-spinner diameter="18"></mat-spinner> }
      <button mat-flat-button type="button" (click)="run()" [disabled]="running() || !canRun()"><mat-icon>play_arrow</mat-icon> Testar conferência</button>
    </div>

    @if (preview(); as p) {
      <div class="result result--preview">
        <div class="result__line"><b>Prévia do rascunho {{ draft()?.code }}</b> <span class="muted">(no navegador, antes de salvar)</span>:
          @if (p.length) { <span class="badge badge--warned">{{ p.length }} achado(s)</span> } @else { <span class="badge badge--ok">nenhum achado</span> }
        </div>
        @for (f of p; track $index) {
          <div class="finding"><span class="muted">{{ f.line != null ? 'linha ' + f.line : 'arquivo' }}</span> <code>{{ f.excerpt }}</code></div>
        }
      </div>
    }

    @if (error()) { <div class="notice">{{ error() }}</div> }
    @if (result(); as r) {
      <div class="result result--{{ r.decision }}">
        <div class="result__line">
          @if (r.decision === 'block') {
            <mat-icon class="dec dec--block">block</mat-icon><b>Barrado:</b> gravar este texto pelo PRMake seria recusado (403 da governança).
          } @else if (r.decision === 'warn') {
            <mat-icon class="dec dec--warn">warning</mat-icon><b>Passa com aviso.</b>
          } @else if (r.findings.length) {
            <mat-icon class="dec">visibility</mat-icon><b>Passa</b> — os achados só vão para a trilha (monitorar).
          } @else {
            <mat-icon class="dec dec--ok">check_circle</mat-icon><b>Nenhum achado.</b>
          }
          @if (r.mode) { <span class="sep">·</span><span class="muted">modo {{ modeLabel[r.mode] }}</span> }
          @if (r.wouldDecide && r.wouldDecide !== r.decision) {
            <span class="sep">·</span><span>no modo "Aplicando": <span class="badge badge--{{ badge(r.wouldDecide) }}">{{ decisionLabel[r.wouldDecide] }}</span></span>
          }
        </div>
        @if (r.findings.length) {
          <ul class="findings">
            @for (f of r.findings; track $index) {
              <li class="finding" [class.finding--focus]="f.key === focus()">
                <div class="finding__head">
                  <button type="button" class="code code--btn" (click)="openStandard.emit(f.key)" [matTooltip]="'Abrir ' + f.code">{{ f.code }}</button>
                  <b>{{ f.title }}</b>
                  <span class="badge badge--{{ f.effect }}">{{ effectName(f.effect) }}</span>
                  <span class="muted">{{ f.line != null ? 'linha ' + f.line : 'no arquivo' }}</span>
                </div>
                @if (f.excerpt) { <pre class="excerpt">{{ f.excerpt }}</pre> }
                @if (f.hint) { <div class="muted">{{ f.hint }}</div> }
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
  styleUrls: ['../governance-shared.css', './gov-standards.css'],
  styles: [`
    :host { display: block; }
    .examples { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .ex { border: 1px solid var(--cc-surface-border); cursor: pointer; color: var(--cc-text-2); font: inherit; font-size: 12px; }
    .ex:hover { color: var(--cc-text-1); }
    .result { margin-top: 10px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--cc-surface-border); display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
    .result--block { border-color: color-mix(in srgb, #d03b3b 70%, transparent); background: color-mix(in srgb, #d03b3b 8%, transparent); }
    .result--warn { border-color: color-mix(in srgb, #d29922 60%, transparent); }
    .result--preview { border-style: dashed; }
    .result__line { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
    .sep { color: var(--cc-text-3); }
    .dec { font-size: 18px; width: 18px; height: 18px; color: var(--cc-text-2); }
    .dec--block { color: #f85149; }
    .dec--warn { color: #d29922; }
    .dec--ok { color: #3fb950; }
    .findings { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .finding { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border-radius: 6px; background: color-mix(in srgb, var(--mat-sys-on-surface) 4%, transparent); }
    .finding--focus { outline: 1px solid color-mix(in srgb, var(--mat-sys-primary) 60%, transparent); }
    .finding__head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
    .excerpt { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--cc-text-1); }
  `],
})
export class GovStandardTesterComponent {
  private readonly store = inject(GovernanceStore);
  /** Padrão em edição: prévia local da conferência (regex/caminho) antes de salvar. */
  readonly draft = input<Standard | null>(null);
  readonly repositories = input<string[]>([]);
  readonly openStandard = output<string>();

  readonly target = signal<StandardCheckTarget>('sql');
  readonly text = signal(EXAMPLES[0].text);
  readonly path = signal('');
  readonly repository = signal('');
  readonly card = signal('');
  readonly focus = signal<string | null>(null);

  readonly running = signal(false);
  readonly result = signal<StandardCheckResponse | null>(null);
  readonly error = signal<string | null>(null);

  readonly examples = EXAMPLES;
  readonly targets = STANDARD_CHECK_TARGETS;
  readonly targetLabel = STANDARD_CHECK_TARGET_LABEL;
  readonly decisionLabel = DECISION_LABEL;
  readonly modeLabel = MODE_LABEL;

  readonly canRun = computed(() => (this.target() === 'path' ? !!this.path().trim() : !!this.text().trim()));

  /** Prévia do rascunho (só regex e caminho rodam no navegador). */
  readonly preview = computed<StandardFinding[] | null>(() => {
    const d = this.draft();
    if (!d || (d.check.kind !== 'regex' && d.check.kind !== 'path') || !d.check.pattern) return null;
    if (!this.canRun()) return null;
    return checkLocally([{ ...d, status: d.status === 'deprecated' ? 'active' : d.status }], this.request(), 'monitor').findings;
  });

  /** Vem do detalhe/editor: "testar conferência" com o exemplo errado do padrão. */
  prefill(p: TesterPrefill): void {
    this.target.set(p.target);
    if (p.text || p.target !== 'path') this.text.set(p.text);
    this.path.set(p.path ?? '');
    this.focus.set(p.focus ?? null);
    this.result.set(null);
    if (this.canRun()) this.run();
  }

  use(x: Example): void {
    this.target.set(x.target);
    this.text.set(x.text);
    this.path.set(x.path ?? '');
    this.focus.set(null);
    this.run();
  }

  private request(): StandardCheckRequest {
    const card = Number(this.card().trim());
    return {
      text: this.target() === 'path' ? '' : this.text(),
      target: this.target(),
      ...(this.path().trim() ? { path: this.path().trim() } : {}),
      ...(this.repository().trim() ? { repository: this.repository().trim() } : {}),
      ...(Number.isInteger(card) && card > 0 ? { card } : {}),
    };
  }

  run(): void {
    if (!this.canRun()) return;
    this.running.set(true);
    this.error.set(null);
    this.store.api.checkStandards(this.request()).subscribe({
      next: (r) => {
        this.result.set({ ...r, findings: r?.findings ?? [] });
        this.running.set(false);
      },
      error: (e) => {
        this.running.set(false);
        // Se a API responder a conferência com o 403 da governança, mostra como barrado (o aviso do interceptor também aparece).
        const blocked = e?.status === 403 ? parseBlockedBody(e.error) : null;
        if (blocked) {
          this.result.set({
            decision: 'block',
            findings: blocked.rules.map((r) => ({ key: r.key, code: r.key, title: r.name, effect: 'block', line: null, excerpt: '', hint: blocked.message })),
          });
          return;
        }
        this.result.set(null);
        this.error.set(apiErrorMessage(e, 'Não consegui testar a conferência.'));
      },
    });
  }

  badge(d: GovDecision): string {
    return d === 'block' ? 'blocked' : d === 'warn' ? 'warned' : 'ok';
  }

  effectName(e: string): string {
    return labelOf(EFFECT_LABEL, e);
  }
}
