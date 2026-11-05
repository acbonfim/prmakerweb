import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';

/** Tipo do card / item de trabalho na Bancada (feature 0085). */
export type WorkItemCardType = 'bug' | 'user-story';

/** Nome do ícone SVG do Bug (joaninha vermelha, como no Azure DevOps). */
export const WI_BUG_ICON = 'wi-bug';
/** Nome do ícone SVG da User Story (livrinho azul, como no Azure DevOps). */
export const WI_US_ICON = 'wi-us';

/** Cor do Bug no Azure DevOps. */
export const WI_BUG_COLOR = '#cc293d';
/** Cor da User Story no Azure DevOps. */
export const WI_US_COLOR = '#009ccc';

// Joaninha discreta: corpo oval com a linha do meio, cabeça e patinhas — viewBox 16×16.
const BUG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="${WI_BUG_COLOR}">
  <path d="M5.6 3.1A2.6 2.6 0 0 1 8 1.6a2.6 2.6 0 0 1 2.4 1.5 4.6 4.6 0 0 0-4.8 0z"/>
  <path d="M7.5 4.1C5.3 4.4 3.6 6.6 3.6 9.3c0 2.9 1.9 5.1 3.9 5.1zM8.5 4.1c2.2.3 3.9 2.5 3.9 5.2 0 2.9-1.9 5.1-3.9 5.1z"/>
  <g stroke="${WI_BUG_COLOR}" stroke-width="1.1" stroke-linecap="round" fill="none">
    <path d="M3.7 7.4 1.8 6.6M3.5 9.6H1.6M3.9 11.8l-1.8 1M12.3 7.4l1.9-.8M12.5 9.6h1.9M12.1 11.8l1.8 1"/>
  </g>
</svg>`;

// Livrinho aberto discreto — viewBox 16×16.
const US_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="${WI_US_COLOR}">
  <path d="M1.5 3.2c2.1-.6 4.2-.4 5.9.8v9.6c-1.7-1.1-3.8-1.3-5.9-.8z"/>
  <path d="M14.5 3.2c-2.1-.6-4.2-.4-5.9.8v9.6c1.7-1.1 3.8-1.3 5.9-.8z"/>
</svg>`;

/**
 * Registra os ícones de tipo do card/item (`wi-bug` e `wi-us`) no `MatIconRegistry`.
 * Uso: `<mat-icon svgIcon="wi-bug">`. Idempotente (registrar de novo só sobrescreve).
 */
export function registerWorkItemTypeIcons(registry: MatIconRegistry, sanitizer: DomSanitizer): void {
  registry.addSvgIconLiteral(WI_BUG_ICON, sanitizer.bypassSecurityTrustHtml(BUG_SVG));
  registry.addSvgIconLiteral(WI_US_ICON, sanitizer.bypassSecurityTrustHtml(US_SVG));
}

/** `System.WorkItemType` do DevOps → tipo da Bancada: "User Story" é user-story; o resto é bug. */
export function workItemTypeOf(workItemType: string | null | undefined): WorkItemCardType {
  return (workItemType ?? '').trim().toLowerCase() === 'user story' ? 'user-story' : 'bug';
}

/** Nome do ícone SVG para o tipo. */
export function workItemTypeIcon(type: WorkItemCardType | string | null | undefined): string {
  return type === 'user-story' ? WI_US_ICON : WI_BUG_ICON;
}

/** Rótulo curto do tipo. */
export function workItemTypeLabel(type: WorkItemCardType | string | null | undefined): string {
  return type === 'user-story' ? 'User Story' : 'Bug';
}
