import { Component, OnChanges, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ReCopyCommandComponent } from './re-copy-command.component';
import { ReverseEngineeringService, ReverseInfra, ReverseInfraAccount, ReverseInfraResource } from '../../../services/reverse-engineering.service';

interface Group { service: string; label: string; items: ReverseInfraResource[]; }

/**
 * Infra do módulo na AWS (0059): o que a etapa opcional da skill (`re.sh infra`, AWS CLI somente leitura) encontrou ligado ao
 * módulo — esteiras de deploy, Lambdas, buckets, segredos (só os nomes), filas, logs no CloudWatch — mais o resumo da conta e o
 * que não pôde ser lido. Os dados vêm do último envio da skill; a tela não consulta a AWS.
 */
@Component({
  selector: 'app-re-infra',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, ReCopyCommandComponent],
  template: `
    @if (loading()) { <div class="state"><mat-spinner diameter="22"></mat-spinner></div> }
    @else if (!infra()) {
      <div class="empty">
        <mat-icon>cloud_off</mat-icon>
        <div>
          <b>A infra deste módulo ainda não foi mapeada.</b>
          <div class="muted">Etapa opcional: lê a AWS pelo CLI (somente leitura, nunca o valor de segredo) e liga ao módulo. No Claude Code aberto na pasta do módulo, depois do inventário:</div>
          <app-copy-command [command]="'bash $RE infra ' + moduleKey()" [block]="true" />
        </div>
      </div>
    } @else {
      @for (acc of accounts(); track acc.account) {
        <section class="acc">
          <header>
            <mat-icon>cloud</mat-icon>
            <b>Conta {{ acc.account }}</b>
            <span class="muted">{{ acc.regions.join(', ') }} · lida por {{ infra()!.collectedBy }} em {{ date(infra()!.collectedAt) }} · {{ acc.resources.length }} recursos do módulo de {{ acc.summary.total }} na conta</span>
            <span class="spacer"></span>
            <app-copy-command [command]="'bash $RE infra ' + moduleKey()" icon="refresh" label="Reler" />
          </header>

          @if (acc.denied.length) {
            <details class="warn">
              <summary><mat-icon>lock</mat-icon>{{ acc.denied.length }} leituras sem permissão — o mapa está incompleto nesses serviços</summary>
              <ul>@for (d of acc.denied; track d.call) { <li><code>{{ d.call }}</code></li> }</ul>
              <div class="muted">Para completar, a conta precisa liberar leitura (list/describe) nesses serviços ou usar um perfil de leitura mais amplo.</div>
            </details>
          }

          <nav class="seg">
            @for (t of tabs; track t.key) {
              <button type="button" [class.on]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}@if (count(acc, t.key); as n) { <span class="n">{{ n }}</span> }</button>
            }
          </nav>

          @switch (tab()) {
            @case ('recursos') {
              <input class="filter" type="search" placeholder="Filtrar por nome, serviço ou motivo da ligação" [ngModel]="filter()" (ngModelChange)="filter.set($event)" />
              @for (g of groups(acc); track g.service) {
                <details class="grp" [open]="g.items.length <= 12 || !!filter()">
                  <summary>{{ g.label }} <span class="n">{{ g.items.length }}</span></summary>
                  @for (r of g.items; track r.arn) {
                    <div class="res">
                      <div class="res__head"><b>{{ r.name }}</b><span class="muted">{{ r.why }}</span></div>
                      @for (k of keys(r.details); track k) { <div class="kv"><span class="k">{{ k }}</span><span class="v">{{ show(r.details[k]) }}</span></div> }
                      @if (r.stages?.length) {
                        <div class="kv"><span class="k">estágios</span><span class="v">{{ stagesLine(r) }}</span></div>
                        @for (s of r.stages!; track s.name) { @for (a of s.actions; track a.name) { @if (keys(a.config).length) {
                          <div class="kv kv--sub"><span class="k">{{ s.name }}/{{ a.name }}</span><span class="v">{{ show(a.config) }}</span></div> } } }
                      }
                      @if (r.buildspec) { <details><summary class="muted">buildspec (valores mascarados)</summary><pre>{{ r.buildspec }}</pre></details> }
                    </div>
                  }
                </details>
              } @empty { <div class="muted">Nada corresponde ao filtro.</div> }
            }
            @case ('esteiras') {
              <p class="muted">Como o código chega à AWS: esteiras na conta (CodePipeline/CodeBuild) e arquivos de pipeline nos repositórios.</p>
              @for (r of byService(acc, ['codepipeline', 'codebuild', 'codedeploy']); track r.arn) {
                <div class="res"><div class="res__head"><b>{{ r.label }} · {{ r.name }}</b><span class="muted">{{ r.why }}</span></div>
                  @if (r.stages?.length) { <div class="kv"><span class="k">estágios</span><span class="v">{{ stagesLine(r) }}</span></div> }
                  @for (k of keys(r.details); track k) { <div class="kv"><span class="k">{{ k }}</span><span class="v">{{ show(r.details[k]) }}</span></div> }</div>
              }
              @for (p of infra()!.data?.repoPipelines ?? []; track p.repo + p.file) {
                <div class="res"><div class="res__head"><b>{{ p.file }}</b><span class="muted">{{ p.repo }} · {{ p.detail }}</span></div>
                  <pre>{{ p.facts.join('\n') }}</pre></div>
              }
            }
            @case ('segredos') {
              <p class="muted">Só nome, descrição e datas — o valor nunca é lido. "Último acesso" mostra se alguém ainda usa o segredo.</p>
              @for (r of byService(acc, ['secret', 'ssm']); track r.arn) {
                <div class="res"><div class="res__head"><b>{{ r.name }}</b><span class="muted">{{ r.label }}</span></div>
                  @for (k of keys(r.details); track k) { <div class="kv"><span class="k">{{ k }}</span><span class="v">{{ show(r.details[k]) }}</span></div> }</div>
              } @empty { <div class="muted">Nenhum segredo ligado ao módulo.</div> }
            }
            @case ('logs') {
              <p class="muted">Onde ver o que cada recurso grava (CloudWatch Logs). Rode o comando numa máquina com o perfil do AWS CLI.</p>
              @for (l of acc.logs; track l.group) {
                <div class="res"><div class="res__head"><b>{{ l.group }}</b>
                  <span class="muted">{{ l.resource }}{{ l.exists ? ' · retenção: ' + l.retention : ' · grupo ainda não criado ou fora da região lida' }}</span></div>
                  <app-copy-command [command]="l.command" [block]="true" /></div>
              } @empty { <div class="muted">Nenhum grupo de log identificado.</div> }
            }
            @case ('conta') {
              <p class="muted">Tudo o que a conta tem (referência — só o ligado ao módulo aparece nas outras abas).</p>
              <table class="sum">
                @for (s of acc.summary.byService; track s.service) { <tr><td>{{ s.label }}</td><td class="num">{{ s.count }}</td></tr> }
              </table>
              @if (acc.failed.length) { <details class="warn"><summary>{{ acc.failed.length }} leituras falharam</summary><ul>@for (f of acc.failed; track f.call) { <li><code>{{ f.call }}</code> — {{ f.message }}</li> }</ul></details> }
            }
          }
        </section>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .state { display: flex; justify-content: center; padding: 24px; }
    .empty { display: flex; gap: 12px; padding: 18px; border-radius: 8px; background: rgba(255,255,255,.04); margin: 12px 0; }
    .muted { font-size: 12px; opacity: .65; }
    .acc { margin: 12px 0; }
    .acc header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .acc header mat-icon { color: var(--mat-sys-primary); }
    .spacer { flex: 1; }
    .warn { margin: 10px 0; padding: 8px 12px; border-radius: 8px; background: rgba(210,153,34,.08); border: 1px solid rgba(210,153,34,.3); font-size: 13px; }
    .warn summary { cursor: pointer; display: flex; align-items: center; gap: 6px; }
    .warn mat-icon { font-size: 17px; width: 17px; height: 17px; color: #d29922; }
    .warn ul { margin: 6px 0; padding-left: 20px; }
    .seg { display: flex; gap: 2px; margin: 12px 0 8px; flex-wrap: wrap; }
    .seg button { border: 1px solid rgba(255,255,255,.15); background: transparent; color: inherit; padding: 4px 12px; border-radius: 14px; cursor: pointer; font-size: 13px; }
    .seg button.on { background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); border-color: transparent; }
    .n { margin-left: 6px; font-size: 11px; opacity: .75; }
    .filter { width: 100%; max-width: 480px; margin: 4px 0 8px; padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,.2); background: transparent; color: inherit; }
    .grp { margin: 6px 0; border: 1px solid rgba(255,255,255,.08); border-radius: 8px; padding: 6px 12px; }
    .grp > summary { cursor: pointer; font-weight: 600; }
    .res { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.06); font-size: 13px; }
    .res__head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
    .res__head b { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; word-break: break-all; }
    .kv { display: flex; gap: 10px; padding-left: 4px; }
    .kv--sub { padding-left: 20px; }
    .k { min-width: 120px; opacity: .6; font-size: 12px; }
    .v { word-break: break-word; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    pre { overflow-x: auto; font-size: 11.5px; padding: 8px; border-radius: 6px; background: rgba(0,0,0,.3); margin: 6px 0; max-height: 320px; }
    .sum { border-collapse: collapse; font-size: 13px; }
    .sum td { padding: 3px 14px 3px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
  `]
})
export class ReInfraComponent implements OnChanges {
  private api = inject(ReverseEngineeringService);
  moduleKey = input.required<string>();
  stamp = input<string | null | undefined>('');
  infra = signal<ReverseInfra | null>(null);
  loading = signal(false);
  tab = signal<'recursos' | 'esteiras' | 'segredos' | 'logs' | 'conta'>('recursos');
  filter = signal('');
  tabs = [
    { key: 'recursos', label: 'Recursos' }, { key: 'esteiras', label: 'Esteiras de deploy' }, { key: 'segredos', label: 'Segredos' },
    { key: 'logs', label: 'Logs' }, { key: 'conta', label: 'Conta' }
  ] as const;
  accounts = computed<ReverseInfraAccount[]>(() => this.infra()?.data?.accounts ?? []);

  ngOnChanges() {
    this.loading.set(true);
    this.api.infra(this.moduleKey()).subscribe({
      next: i => { this.infra.set(i ?? null); this.loading.set(false); },
      error: () => { this.infra.set(null); this.loading.set(false); }
    });
  }

  groups(acc: ReverseInfraAccount): Group[] {
    const f = this.filter().trim().toLowerCase();
    const map = new Map<string, Group>();
    for (const r of acc.resources) {
      if (f && !`${r.name} ${r.label} ${r.why}`.toLowerCase().includes(f)) continue;
      if (!map.has(r.service)) map.set(r.service, { service: r.service, label: r.label, items: [] });
      map.get(r.service)!.items.push(r);
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length);
  }

  byService(acc: ReverseInfraAccount, services: string[]) { return acc.resources.filter(r => services.includes(r.service)); }

  count(acc: ReverseInfraAccount, tab: string): number {
    switch (tab) {
      case 'recursos': return acc.resources.length;
      case 'esteiras': return this.byService(acc, ['codepipeline', 'codebuild', 'codedeploy']).length + (this.infra()?.data?.repoPipelines?.length ?? 0);
      case 'segredos': return this.byService(acc, ['secret', 'ssm']).length;
      case 'logs': return acc.logs.length;
      default: return 0;
    }
  }

  keys(o: Record<string, any> | undefined) { return o ? Object.keys(o) : []; }
  show(v: any): string { return typeof v === 'string' ? v : JSON.stringify(v); }
  stagesLine(r: ReverseInfraResource) { return (r.stages ?? []).map(s => `${s.name} [${s.actions.map(a => a.provider).join(', ')}]`).join(' → '); }
  date(at?: string | null) { return at ? new Date(at).toLocaleString('pt-BR') : ''; }
}
