/**
 * 0081: tour guiado (spotlight + balões) montado sobre os elementos reais da tela. Cada passo aponta para um
 * `data-tour="..."` do template — quando a tela muda, o tour acompanha; passo sem elemento na hora é pulado.
 */
export type TourSide = 'top' | 'right' | 'bottom' | 'left';

/** Aba que precisa estar aberta no celular para o elemento aparecer (as três colunas viram abas). */
export type TourMobileTab = 'prs' | 'plan' | 'timeline';

export interface TourStep {
  id: string;
  /** `data-tour` do elemento (o primeiro visível da lista). Sem âncora = balão no centro da tela. */
  anchor?: string | string[];
  title: string;
  /** Texto do balão (HTML simples, curto). */
  body: string;
  /** Instruções completas, para o guia "Como usar esta tela" (HTML simples). */
  detail?: string;
  /** Seção do guia. */
  group: string;
  /** Versão do tour em que o passo entrou (quem já viu a anterior recebe só as novidades). */
  since: number;
  /** `entry` aparece logo ao entrar; `card` só com um card aberto (plano e especialista na tela). */
  phase: 'entry' | 'card';
  /** Passo que só existe em algumas situações (ex.: proposta pendente): some sem aviso quando não há o elemento. */
  optional?: boolean;
  side?: TourSide;
  align?: 'start' | 'center' | 'end';
  mobileTab?: TourMobileTab;
  /** Fora do guia "Como usar esta tela" (ex.: o passo de encerramento do tour). */
  guide?: false;
  /** Deixa a pessoa usar o elemento destacado (ex.: digitar o número do card). */
  interactive?: boolean;
}

export interface TourDefinition {
  id: string;
  /** Suba quando entrar passo novo ou um passo mudar de sentido: quem já viu recebe só o que tem `since` maior. */
  version: number;
  title: string;
  steps: TourStep[];
  /** Texto do botão do último passo (padrão: "Concluir tour"). */
  doneText?: string;
}

/** O que a tela oferece ao tour (abrir a aba certa no celular, saber se há card aberto). */
export interface TourHost {
  hasCard(): boolean;
  showMobileTab?(tab: TourMobileTab): void;
}
