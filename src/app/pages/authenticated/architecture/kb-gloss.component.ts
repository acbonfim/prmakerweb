import { Component, computed, input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { glossarySegments } from './kb-friendly';

/** Texto com tooltip do glossário nos termos técnicos (fila, evento, Lambda, API…) — 0038. */
@Component({
  selector: 'app-kb-gloss',
  standalone: true,
  imports: [MatTooltipModule],
  template: `@for (s of segments(); track $index) {@if (s.tip) {<abbr class="gl" [matTooltip]="s.tip" matTooltipClass="kb-gloss-tip" tabindex="0">{{ s.text }}</abbr>} @else {<ng-container>{{ s.text }}</ng-container>}}`,
  styles: [`
    :host { display: inline; }
    .gl { text-decoration: underline dotted color-mix(in srgb, currentColor 55%, transparent); text-underline-offset: 3px; cursor: help; }
    .gl:focus-visible { outline: 1px solid var(--mat-sys-primary); border-radius: 3px; }
  `]
})
export class KbGlossComponent {
  readonly text = input<string>('');
  readonly segments = computed(() => glossarySegments(this.text() ?? ''));
}
