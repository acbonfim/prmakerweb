import { Component, ElementRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanMarkdownPipe } from '../../../components/execution-plan/plan-markdown.pipe';
import { renderMermaidIn } from '../../../helpers/mermaid-loader';
import { ArchitectureProject, ArchitectureService } from '../../../services/architecture.service';
import { GLOSSARY, areaGroups, friendlyKind, friendlyName, friendlyTagline, guideSections } from './kb-friendly';

const ECOSYSTEM = 'ecossistema';

/**
 * Visão geral para leigos (0038 F2, modo Simples): catálogo por área de negócio (nome amigável + uma frase),
 * "Como o Solvace funciona" (guia-o-que-e do projeto ecossistema) e o glossário (guia-glossario ou o do front).
 * O "Pergunte à Base Solvace" fica acima, na tela principal.
 */
@Component({
  selector: 'app-kb-friendly-overview',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe],
  template: `
    @if (howItWorks(); as how) {
      <section class="fo__how">
        <h2><mat-icon>lightbulb</mat-icon>Como o Solvace funciona</h2>
        <div class="fo__md" [class.fo__md--clamp]="!howOpen()" [innerHTML]="how | planMarkdown"></div>
        <button type="button" class="fo__more" (click)="howOpen.set(!howOpen())">{{ howOpen() ? 'mostrar menos' : 'ler tudo' }}</button>
      </section>
    }

    <div class="fo__catalog-head">
      <h2>Sistemas por área</h2>
      <span class="fo__muted">{{ projects().length }} sistemas · clique para ver o que cada um faz</span>
      <span class="fo__spacer"></span>
      <button mat-stroked-button (click)="openMap.emit()"><mat-icon>hub</mat-icon>Como os sistemas se conectam</button>
    </div>
    <div class="fo__cards">
      @for (g of groups(); track g.area) {
        <div class="fo__card">
          <div class="fo__card-head"><mat-icon>{{ g.icon }}</mat-icon>{{ g.area }}<span class="fo__count">{{ g.projects.length }}</span></div>
          @for (p of cardProjects(g.area, g.projects); track p.key) {
            <button type="button" class="fo__item" (click)="openProject.emit(p.key)">
              <span class="fo__item-name">{{ name(p) }}
                @if (hasGuide(p)) { <mat-icon class="fo__guide" matTooltip="Tem guia em linguagem simples">menu_book</mat-icon> }
              </span>
              @if (tagline(p)) { <span class="fo__item-tag">{{ tagline(p) }}</span> }
              @if (g.business) { <span class="fo__item-kind">{{ kind(p.kind) }}</span> }
            </button>
          }
          @if (g.projects.length > limit) {
            <button type="button" class="fo__more" (click)="toggle(g.area)">{{ expanded().has(g.area) ? 'mostrar menos' : 'ver mais ' + (g.projects.length - limit) }}</button>
          }
        </div>
      }
    </div>

    <section class="fo__gloss">
      <button type="button" class="fo__gloss-head" (click)="glossOpen.set(!glossOpen())" [attr.aria-expanded]="glossOpen()">
        <mat-icon>{{ glossOpen() ? 'expand_more' : 'chevron_right' }}</mat-icon>
        <h2>Glossário</h2>
        <span class="fo__muted">os termos técnicos que aparecem por aqui, em poucas palavras</span>
      </button>
      @if (glossOpen()) {
        @if (glossary(); as g) {
          <div class="fo__md" [innerHTML]="g | planMarkdown"></div>
        } @else {
          <dl class="fo__dl">
            @for (t of terms; track t.term) { <div><dt>{{ t.term }}</dt><dd>{{ t.definition }}</dd></div> }
          </dl>
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    h2 { display: flex; align-items: center; gap: 8px; font-size: 17px; margin: 0; }
    h2 mat-icon { color: var(--mat-sys-primary); }
    .fo__muted { font-size: 12.5px; color: color-mix(in srgb, var(--mat-sys-on-surface) 58%, transparent); }
    .fo__spacer { flex: 1 1 auto; }
    .fo__how { margin: 0 0 18px; padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.02); }
    .fo__md { font-size: 14px; line-height: 1.65; max-width: 900px; overflow-wrap: anywhere; }
    .fo__md--clamp { max-height: 220px; overflow: hidden; -webkit-mask-image: linear-gradient(#000 70%, transparent); mask-image: linear-gradient(#000 70%, transparent); }
    .fo__md ::ng-deep table { border-collapse: collapse; display: block; overflow-x: auto; }
    .fo__md ::ng-deep th, .fo__md ::ng-deep td { border: 1px solid rgba(255,255,255,.12); padding: 4px 8px; text-align: left; }
    .fo__md ::ng-deep h2, .fo__md ::ng-deep h3 { font-size: 15.5px; margin: 14px 0 6px; }
    .fo__catalog-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 6px 0 12px; }
    .fo__catalog-head button mat-icon { font-size: 17px; width: 17px; height: 17px; margin-right: 4px; }
    .fo__cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 12px; }
    .fo__card { padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.02); }
    .fo__card-head { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; margin-bottom: 6px; }
    .fo__card-head mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--mat-sys-primary); }
    .fo__count { margin-left: auto; font-size: 11px; font-weight: 600; padding: 0 7px; border-radius: 9px; background: rgba(255,255,255,.07); }
    .fo__item { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 8px; border: none; border-radius: 8px; background: transparent;
      color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background .15s; }
    .fo__item:hover, .fo__item:focus-visible { background: rgba(255,255,255,.05); outline: none; }
    .fo__item-name { display: flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 600; }
    .fo__guide { font-size: 15px; width: 15px; height: 15px; color: #3fb950; }
    .fo__item-tag { font-size: 12.5px; line-height: 1.45; opacity: .75; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .fo__item-kind { font-size: 11px; opacity: .5; }
    .fo__more { width: 100%; margin-top: 4px; padding: 6px 8px; border: none; border-radius: 8px; background: rgba(255,255,255,.04);
      color: var(--mat-sys-primary); font: inherit; font-size: 12.5px; cursor: pointer; }
    .fo__how .fo__more { width: auto; margin-top: 8px; }
    .fo__gloss { margin-top: 20px; }
    .fo__gloss-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border: none; background: transparent; color: inherit; font: inherit; padding: 4px 0; cursor: pointer; text-align: left; }
    .fo__dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px 16px; margin: 10px 0 0; }
    .fo__dl div { padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,.03); }
    .fo__dl dt { font-weight: 700; font-size: 13px; }
    .fo__dl dd { margin: 2px 0 0; font-size: 12.5px; line-height: 1.5; opacity: .8; }
    @media (prefers-reduced-motion: reduce) { .fo__item { transition: none; } }
  `]
})
export class KbFriendlyOverviewComponent {
  private api = inject(ArchitectureService);
  private el = inject(ElementRef<HTMLElement>);

  readonly projects = input<ArchitectureProject[]>([]);
  readonly openProject = output<string>();
  readonly openMap = output<void>();

  readonly howItWorks = signal<string | null>(null);
  readonly glossary = signal<string | null>(null);
  readonly howOpen = signal(false);
  readonly glossOpen = signal(false);
  readonly expanded = signal<Set<string>>(new Set());
  readonly terms = GLOSSARY;
  readonly limit = 6;
  private loadedFor = '';

  readonly groups = computed(() => areaGroups(this.projects()));

  constructor() {
    // Carrega "Como o Solvace funciona" e o glossário do projeto ecossistema, se o guia existir.
    effect(() => {
      const eco = this.projects().find(p => p.key === ECOSYSTEM);
      const keys = eco ? eco.sections.map(s => `${s.key}:${s.version}`).join(',') : '';
      if (!eco || keys === this.loadedFor) return;
      this.loadedFor = keys;
      if (eco.sections.some(s => s.key === 'guia-o-que-e'))
        this.api.section(ECOSYSTEM, 'guia-o-que-e').subscribe({ next: s => this.howItWorks.set(s.content), error: () => this.howItWorks.set(null) });
      if (eco.sections.some(s => s.key === 'guia-glossario'))
        this.api.section(ECOSYSTEM, 'guia-glossario').subscribe({ next: s => this.glossary.set(s.content), error: () => this.glossary.set(null) });
    });
    effect(() => { this.howItWorks(); this.glossary(); this.glossOpen(); setTimeout(() => renderMermaidIn(this.el.nativeElement), 0); });
  }

  name(p: ArchitectureProject): string { return friendlyName(p); }
  tagline(p: ArchitectureProject): string { return friendlyTagline(p); }
  kind(kind: string): string { return friendlyKind(kind).label; }
  hasGuide(p: ArchitectureProject): boolean { return guideSections(p).length > 0; }

  cardProjects(area: string, list: ArchitectureProject[]): ArchitectureProject[] {
    return this.expanded().has(area) ? list : list.slice(0, this.limit);
  }

  toggle(area: string): void {
    this.expanded.update(set => { const next = new Set(set); next.has(area) ? next.delete(area) : next.add(area); return next; });
  }
}
