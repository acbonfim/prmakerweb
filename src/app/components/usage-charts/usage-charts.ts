import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';

/**
 * Gráficos da análise de uso (0079), em SVG próprio (o app não tem biblioteca de gráficos). Seguem a skill de dataviz:
 * marcas finas com cantos de 4 px na ponta, 2 px de folga entre barras/segmentos, grade em linha fina, uma cor por
 * série (passos escuros da paleta de referência), cores de status só para ok/falha (sempre com legenda), tooltip no
 * hover e alvo maior que a marca.
 */

export interface BarSeries {
  name: string;
  color: string;
}

export interface BarDatum {
  /** Rótulo do eixo (ex.: "04/11"). */
  label: string;
  /** Rótulo longo do tooltip (ex.: "terça, 04/11"). */
  title?: string;
  /** Um valor por série (empilhados na ordem). */
  values: number[];
}

/** Escala com passo "redondo" (1, 2, 5 × 10ⁿ) e no máximo 4 intervalos: rótulos inteiros e sem repetição. */
function niceScale(v: number): { max: number; step: number } {
  if (v <= 4) {
    const max = Math.max(1, Math.ceil(v));
    return { max, step: 1 };
  }
  const raw = v / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  return { max: Math.ceil(v / step) * step, step };
}

const fmt = new Intl.NumberFormat('pt-BR');

/** Barras verticais (uma série ou empilhadas). */
@Component({
  selector: 'app-usage-bars',
  standalone: true,
  template: `
    <div class="uc" (mouseleave)="hover.set(null)">
      @if (series().length > 1) {
        <div class="uc-legend">
          @for (s of series(); track s.name) {
            <span class="uc-legend__item"><i [style.background]="s.color"></i>{{ s.name }}</span>
          }
        </div>
      }
      <svg [attr.viewBox]="'0 0 ' + W() + ' ' + H" class="uc-svg" role="img" [attr.aria-label]="ariaLabel()">
        @for (t of ticks(); track t.v) {
          <line [attr.x1]="padL" [attr.x2]="W()" [attr.y1]="t.y" [attr.y2]="t.y" class="uc-grid" />
          <text [attr.x]="padL - 6" [attr.y]="t.y + 3" class="uc-tick" text-anchor="end">{{ t.label }}</text>
        }
        <line [attr.x1]="padL" [attr.x2]="W()" [attr.y1]="H - padB" [attr.y2]="H - padB" class="uc-base" />
        @for (c of columns(); track $index) {
          <g>
            @for (seg of c.segs; track $index) {
              <path [attr.d]="seg.d" [attr.fill]="seg.color" />
            }
            @if (c.showLabel) {
              <text [attr.x]="c.cx" [attr.y]="H - padB + 14" class="uc-tick" text-anchor="middle">{{ c.label }}</text>
            }
            <rect [attr.x]="c.x - c.gap / 2" [attr.y]="0" [attr.width]="c.w + c.gap" [attr.height]="H - padB" class="uc-hit"
                  (mouseenter)="hover.set($index)" />
          </g>
        }
        @if (hover() !== null && columns()[hover()!]; as c) {
          <rect [attr.x]="c.x - 1" y="0" [attr.width]="c.w + 2" [attr.height]="H - padB" class="uc-hover" />
        }
      </svg>
      @if (hover() !== null && columns()[hover()!]; as c) {
        <div class="uc-tip" [style.left.%]="(c.cx / W()) * 100">
          <div class="uc-tip__title">{{ c.title }}</div>
          @for (s of series(); track s.name; let i = $index) {
            <div class="uc-tip__row"><i [style.background]="s.color"></i>{{ s.name }}<b>{{ fmt(c.values[i] || 0) }}</b></div>
          }
        </div>
      }
      @if (!data().length) { <div class="uc-empty">Sem dados no período.</div> }
    </div>
  `,
  styleUrl: './usage-charts.css',
})
export class UsageBarsComponent {
  readonly data = input<BarDatum[]>([]);
  readonly series = input<BarSeries[]>([{ name: 'Valor', color: '#3987e5' }]);
  readonly ariaLabel = input('Gráfico de barras');

  /** Largura real do gráfico (sem esticar o SVG: texto e cantos ficam no tamanho certo). */
  readonly W = signal(640);
  readonly H = 200;

  constructor() {
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const ro = new ResizeObserver(([entry]) => {
        const w = Math.round(entry.contentRect.width);
        if (w > 0 && w !== this.W()) this.W.set(w);
      });
      ro.observe(host);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }
  readonly padL = 34;
  readonly padB = 22;
  readonly hover = signal<number | null>(null);
  fmt = (v: number) => fmt.format(v);

  private readonly scale = computed(() => niceScale(Math.max(0, ...this.data().map((d) => d.values.reduce((a, b) => a + (b || 0), 0)))));
  private readonly max = computed(() => this.scale().max);

  readonly ticks = computed(() => {
    const { max, step } = this.scale();
    const plotH = this.H - this.padB - 8;
    return Array.from({ length: Math.round(max / step) + 1 }, (_, i) => {
      const v = step * i;
      return { v, y: this.H - this.padB - (v / max) * plotH, label: fmt.format(v) };
    });
  });

  readonly columns = computed(() => {
    const data = this.data();
    const n = data.length || 1;
    const plotW = this.W() - this.padL;
    const slot = plotW / n;
    const gap = Math.min(8, Math.max(2, slot * 0.25));
    const w = Math.max(2, Math.min(28, slot - gap));
    const plotH = this.H - this.padB - 8;
    const max = this.max();
    const every = Math.ceil(n / 10);
    const colors = this.series().map((s) => s.color);
    return data.map((d, i) => {
      const x = this.padL + i * slot + (slot - w) / 2;
      let base = this.H - this.padB;
      const nonZero = d.values.map((v, k) => ({ v: v || 0, k })).filter((s) => s.v > 0);
      const segs = nonZero.map((s, j) => {
        const h = Math.max(1, (s.v / max) * plotH);
        // 2 px de folga entre segmentos empilhados; só o de cima leva cantos arredondados.
        const top = base - h;
        const isTop = j === nonZero.length - 1;
        const y = top;
        const hh = j > 0 ? Math.max(0.5, h - 2) : h;
        const d2 = isTop ? roundedTop(x, y, w, hh, Math.min(4, w / 2, hh)) : `M${x},${y}h${w}v${hh}h${-w}z`;
        base = top;
        return { d: d2, color: colors[s.k] ?? '#3987e5' };
      });
      return { x, w, gap, cx: x + w / 2, label: d.label, title: d.title ?? d.label, values: d.values, segs, showLabel: i % every === 0 };
    });
  });
}

/** Barras horizontais ranqueadas (uma série, uma cor). */
@Component({
  selector: 'app-usage-hbars',
  standalone: true,
  template: `
    <div class="uh">
      @for (it of rows(); track it.label) {
        <div class="uh-row" [attr.title]="it.tip || null">
          <span class="uh-label">{{ it.label }}</span>
          <span class="uh-track"><span class="uh-bar" [style.width.%]="it.pct" [style.background]="color()"></span></span>
          <span class="uh-value">{{ it.text }}</span>
        </div>
      } @empty {
        <div class="uc-empty uc-empty--static">Sem dados no período.</div>
      }
    </div>
  `,
  styleUrl: './usage-charts.css',
})
export class UsageHBarsComponent {
  readonly items = input<{ label: string; value: number; text?: string; tip?: string }[]>([]);
  readonly color = input('#3987e5');
  readonly limit = input(10);

  readonly rows = computed(() => {
    const list = [...this.items()].sort((a, b) => b.value - a.value).slice(0, this.limit());
    const max = Math.max(1, ...list.map((i) => i.value));
    return list.map((i) => ({ ...i, pct: Math.max(1.5, (i.value / max) * 100), text: i.text ?? fmt.format(i.value) }));
  });
}

/** Mapa de calor dia da semana × hora (sequencial de uma cor). */
@Component({
  selector: 'app-usage-heatmap',
  standalone: true,
  template: `
    <div class="hm" (mouseleave)="hover.set(null)">
      <div class="hm-grid">
        <span></span>
        @for (h of hours; track h) { <span class="hm-hour">{{ h % 3 === 0 ? h + 'h' : '' }}</span> }
        @for (d of days; track d.i) {
          <span class="hm-day">{{ d.label }}</span>
          @for (h of hours; track h) {
            <span class="hm-cell" [style.background]="colorOf(d.i, h)" (mouseenter)="hover.set({ d: d.i, h })"
                  [class.hm-cell--on]="hover()?.d === d.i && hover()?.h === h"></span>
          }
        }
      </div>
      <div class="hm-foot">
        @if (hover(); as hv) {
          <span><b>{{ days[hv.d].long }}, {{ hv.h }}h–{{ hv.h + 1 }}h</b> · {{ fmtN(value(hv.d, hv.h)) }} {{ unit() }}</span>
        } @else {
          <span class="hm-hint">Passe o mouse para ver os valores · fuso do navegador</span>
        }
        <span class="hm-scale">menos
          @for (c of scale; track c) { <i [style.background]="c"></i> }
          mais</span>
      </div>
    </div>
  `,
  styleUrl: './usage-charts.css',
})
export class UsageHeatmapComponent {
  readonly cells = input<{ weekday: number; hour: number; count: number }[]>([]);
  readonly unit = input('eventos');
  readonly hover = signal<{ d: number; h: number } | null>(null);
  readonly hours = Array.from({ length: 24 }, (_, i) => i);
  readonly days = [
    { i: 1, label: 'seg', long: 'Segunda' }, { i: 2, label: 'ter', long: 'Terça' }, { i: 3, label: 'qua', long: 'Quarta' },
    { i: 4, label: 'qui', long: 'Quinta' }, { i: 5, label: 'sex', long: 'Sexta' }, { i: 6, label: 'sáb', long: 'Sábado' },
    { i: 0, label: 'dom', long: 'Domingo' },
  ].map((d) => d);
  /** Rampa azul (passos 600 → 200 da paleta de referência) sobre a superfície escura. */
  readonly scale = ['#184f95', '#1c5cab', '#2a78d6', '#5598e7', '#9ec5f4'];
  fmtN = (v: number) => fmt.format(v);

  private readonly map = computed(() => {
    const m = new Map<string, number>();
    for (const c of this.cells()) m.set(`${c.weekday}:${c.hour}`, (m.get(`${c.weekday}:${c.hour}`) ?? 0) + c.count);
    return m;
  });
  private readonly max = computed(() => Math.max(0, ...this.map().values()));

  value(d: number, h: number): number {
    return this.map().get(`${d}:${h}`) ?? 0;
  }

  colorOf(d: number, h: number): string {
    const v = this.value(d, h);
    const max = this.max();
    if (!v || !max) return 'var(--hm-empty)';
    const idx = Math.min(this.scale.length - 1, Math.floor((v / max) * this.scale.length * 0.999));
    return this.scale[idx];
  }
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}z`;
}
