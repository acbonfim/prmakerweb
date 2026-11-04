import { WritableSignal, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NEVER } from 'rxjs';
import { CliipboardService } from '../../services/cliipboard.service';
import { StorageService } from '../../services/storage.service';
import { WsService } from '../../services/ws.service';
import { CardSituation, CardSituationService } from '../card-situation/card-situation.service';
import { CodeRefService } from '../code-ref/code-ref.service';
import { ExecutionArtifact, ExecutionPlan } from '../execution-plan/execution-plan.model';
import { TextCenterDialogComponent, TextCenterDialogData } from './text-center-dialog.component';
import { buildRegeneratePrompt, buildTextItems, firstLine, sendStateLabel, textHash } from './text-center.model';

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ANALYSIS = '## Análise do card 75999\n\n| O que vai ser feito | Tipo |\n|---|---|\n| Ajustar filtro | **Alterar** |';

function art(id: string, name: string, extra: Partial<ExecutionArtifact> = {}): ExecutionArtifact {
  return {
    id, planId: 'pa', number: 1, noteId: null, stepKey: null, name, kind: 'analysis', contentType: 'text/markdown',
    size: 10, sha256: 'x', description: null, createdBy: 'Claude', createdAt: ago(3_600_000), updatedAt: null, ...extra,
  };
}

function plan(artifacts: ExecutionArtifact[]): ExecutionPlan {
  return {
    id: 'pa', cardNumber: '75999', kind: 'analisar-bug', title: 'Plano', status: 'running', createdBy: 'Alex', createdAt: ago(0), updatedAt: ago(0),
    stepsTotal: 1, stepsCompleted: 0, phase: 'analysis', steps: [], artifacts, questions: [], links: [], lastLogId: 0, serverTime: ago(0),
  } as ExecutionPlan;
}

function situation(extra: Partial<CardSituation> = {}): CardSituation {
  return {
    cardNumber: '75999', kind: 'ticket', title: 'Aguardando chamado', icon: '', since: ago(600_000), alsoWaiting: [], planId: 'pa', phase: 'analysis',
    planTitle: 'P', planStatus: 'running', stepKey: null, stepTitle: null, done: [], pullRequests: [], tickets: [], questions: [], userSteps: [],
    devTestInQaAt: null, devTestInQaError: null, qaChecklist: null, devOpsState: null, devOpsColumn: null, handoff: null, handoffAt: null,
    handoffBy: null, next: null, markdown: '**Aguardando chamado** #4321', autoPost: false, publishedAt: ago(3_600_000), publishedBy: 'Ana',
    publishedMarkdown: '**Aguardando chamado** #4321', publishPending: false, ...extra,
  };
}

describe('text-center.model (0078)', () => {
  it('agrupa só o que existe, na ordem dos grupos, com onde está e o estado de envio', () => {
    const items = buildTextItems({
      artifacts: [
        { planId: 'pa', phase: 'analysis', artifact: art('a1', 'analise-inicial.md'), content: ANALYSIS },
        { planId: 'pa', phase: 'analysis', artifact: art('a2', 'solucoes.md', { description: 'Editado por Ana em 04/11/2026 10:00', updatedAt: ago(1000) }), content: '## Soluções\nA' },
        { planId: 'pc', phase: 'correction', artifact: art('c1', 'chamado-filtros.md', { kind: 'ticket' }), content: 'Abrir chamado' },
        { planId: 'pa', phase: 'analysis', artifact: art('x', 'print.png', { kind: 'image' }), content: null },
      ],
      situation: situation({ publishPending: true, markdown: '**novo**' }),
      situationDraft: null,
      register: { summary: 'Olá', summaryUpdatedAt: ago(1000), summaryPublishedAt: ago(60_000), rootCause: 'Causa', description: '' },
      handover: null,
      timeline: [{ id: 7, cardNumber: '75999', description: ANALYSIS, userName: 'Bia', createdAt: ago(5000) }],
      rootCauseSent: { at: ago(100), by: 'Alex', hash: textHash('Causa') },
    });
    expect(items.map(i => `${i.group}:${i.label}`)).toEqual([
      'client:Resumo não técnico (PT/EN)', 'client:Resumo da situação', 'devops:Root cause',
      'analysis:Análise', 'analysis:Soluções propostas', 'correction:Texto do chamado · filtros',
    ]);
    const by = (k: string) => items.find(i => i.key === k)!;
    expect(by('summary').sendState).toBe('stale');
    expect(by('situation').sendState).toBe('stale');
    expect(by('root-cause').sendState).toBe('sent');
    expect(sendStateLabel(by('root-cause'))).toContain('por Alex');
    expect(by('a:a1').sendState).toBe('sent');
    expect(by('a:a1').timelineEntryId).toBe(7);
    expect(by('a:a1').where).toBe('Timeline do card');
    expect(by('a:a2').sendState).toBe('none');
    expect(by('a:a2').origin).toBe('Editado por Ana');
    expect(by('a:c1').sendState).toBe('local');
    expect(sendStateLabel(by('a:c1'))).toBe('Só no PRMake');
  });

  it('timeline: mesma primeira linha com texto diferente = editado depois do envio', () => {
    expect(firstLine('## **Análise** do card')).toBe('análise do card');
    const items = buildTextItems({
      artifacts: [{ planId: 'pa', phase: 'analysis', artifact: art('a1', 'analise-inicial.md'), content: ANALYSIS + '\n\nmais' }],
      situation: null, situationDraft: null, register: null, handover: null, rootCauseSent: null,
      timeline: [{ id: 7, cardNumber: '75999', description: ANALYSIS, userName: 'Bia', createdAt: ago(5000) }],
    });
    expect(items[0].sendState).toBe('stale');
    expect(sendStateLabel(items[0])).toBe('Editado depois do envio');
  });

  it('prompt de gerar de novo: pedido, regras e só os contextos marcados', () => {
    const p = buildRegeneratePrompt('75999', { label: 'Resumo da situação', where: 'discussion do DevOps', group: 'client' }, 'deixe mais curto',
      [{ label: 'Texto atual', text: 'ATUAL' }, { label: 'Discussion do DevOps', text: null }]);
    expect(p).toContain('card 75999');
    expect(p).toContain('lido pelo CLIENTE');
    expect(p).toContain('deixe mais curto');
    expect(p).toContain('### Texto atual\nATUAL');
    expect(p).not.toContain('Discussion do DevOps');
    expect(p).toContain('não invente');
  });
});

describe('TextCenterDialogComponent (0078)', () => {
  let f: ComponentFixture<TextCenterDialogComponent>;
  let http: HttpTestingController;
  let sit: WritableSignal<CardSituation | null>;
  let situations: { situationOf: () => WritableSignal<CardSituation | null>; load: jasmine.Spy; publish: jasmine.Spy };
  const el = () => f.nativeElement as HTMLElement;
  const planSig = signal<ExecutionPlan | null>(null);
  const holder: { data: TextCenterDialogData | null } = { data: null };

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      f.detectChanges();
      await f.whenStable();
      await new Promise(r => setTimeout(r, 0));
    }
  }

  async function open(selectKey: string | null = null): Promise<void> {
    holder.data = { card: '75999', plan: planSig, pair: signal(null), selectKey };
    f = TestBed.createComponent(TextCenterDialogComponent);
    await settle();
    http.expectOne(r => r.url.includes('PullRequest/GetByCardNumber')).flush({ rootCause: 'Causa antiga', description: '', summary: null });
    http.expectOne(r => r.url.includes('Handover/GetByCardNumber')).flush(null);
    http.expectOne(r => r.url.endsWith('Timeline/card/75999')).flush([]);
    http.expectOne(r => r.url.endsWith('ExecutionPlan/pa/artifacts/a1/content')).flush(new Blob([ANALYSIS], { type: 'text/markdown' }));
    await settle();
  }

  function clickText(selector: string, text: string): void {
    const b = [...el().querySelectorAll<HTMLButtonElement>(selector)].find(x => x.textContent!.includes(text));
    if (!b) throw new Error(`botão "${text}" não encontrado`);
    b.click();
  }

  beforeEach(() => {
    try { localStorage.removeItem('prmake.situation-draft:75999'); localStorage.removeItem('prmake.root-cause-sent:75999'); } catch { /* sem storage */ }
    planSig.set(plan([art('a1', 'analise-inicial.md')]));
    sit = signal<CardSituation | null>(situation());
    situations = {
      situationOf: () => sit,
      load: jasmine.createSpy('load').and.resolveTo(null),
      publish: jasmine.createSpy('publish').and.resolveTo({ commentId: 3 }),
    };
    TestBed.configureTestingModule({
      imports: [TextCenterDialogComponent],
      providers: [
        provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useFactory: () => holder.data },
        { provide: MatDialogRef, useValue: { disableClose: false, backdropClick: () => NEVER, keydownEvents: () => NEVER, close: jasmine.createSpy('close') } },
        { provide: CardSituationService, useValue: situations },
        { provide: StorageService, useValue: { getAccess: () => ({ user: { externalId: 'u1', name: 'Alex' } }) } },
        { provide: CliipboardService, useValue: jasmine.createSpyObj('CliipboardService', ['copyRichToClipboard']) },
        { provide: WsService, useValue: { on() {}, off() {}, addToGroup() {}, removeFromGroup() {} } },
        { provide: CodeRefService, useValue: { changes: signal(null), loadHeads: async () => [], watch() {}, unwatch() {}, attachment: async () => { throw new Error('x'); } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('lista agrupada com onde está e o estado de envio', async () => {
    await open();
    const groups = [...el().querySelectorAll('.tc__group-title')].map(g => g.textContent!.trim());
    expect(groups).toEqual(['Para o cliente', 'DevOps', 'Análise']);
    const labels = [...el().querySelectorAll('.tci__label')].map(x => x.textContent!.trim());
    expect(labels).toEqual(['Resumo da situação', 'Root cause', 'Análise']);
    const items = [...el().querySelectorAll('.tci')];
    expect(items[0].querySelector('.tc-state')!.textContent).toContain('Enviado em');
    expect(items[0].querySelector('.tc-state')!.textContent).toContain('por Ana');
    expect(items[1].querySelector('.tci__where')!.textContent).toContain('campo Root Cause do DevOps');
    expect(items[1].querySelector('.tc-state')!.textContent).toContain('Envio não registrado');
    expect(items[2].querySelector('.tc-state')!.textContent).toContain('Não enviado');
  });

  it('análise: editar → Salvar no PRMake faz PUT text com o markdown', async () => {
    await open('a:a1');
    expect(el().querySelector('.tcd__title')!.textContent).toContain('Análise');
    expect(el().querySelector('.tcd__md table')).not.toBeNull();
    clickText('.tcd__toolbar button', 'Editar');
    await settle();
    const area = el().querySelector<HTMLTextAreaElement>('.tce__area')!;
    expect(area.value).toBe(ANALYSIS);
    area.value = ANALYSIS + '\n\nRevisado pela Ana.';
    area.dispatchEvent(new Event('input'));
    await settle();
    clickText('.tce__foot button', 'Salvar no PRMake');
    await settle();
    const req = http.expectOne(r => r.method === 'PUT' && r.url.endsWith('ExecutionPlan/pa/artifacts/a1/text'));
    expect(req.request.body).toEqual({ content: ANALYSIS + '\n\nRevisado pela Ana.' });
    req.flush(art('a1', 'analise-inicial.md', { updatedAt: new Date().toISOString(), sha256: 'y', description: 'Editado por Alex em 04/11/2026 14:00' }));
    await settle();
    expect(el().querySelector('.tc__msg')!.textContent).toContain('Salvo no PRMake');
    expect(el().querySelector('.tcd__md')!.textContent).toContain('Revisado pela Ana.');
    expect(el().querySelector('.tcd__meta')!.textContent).toContain('Editado por Alex');
  });

  it('resumo da situação: editar guarda rascunho; enviar publica com { markdown } depois de confirmar', async () => {
    await open('situation');
    clickText('.tcd__toolbar button', 'Editar');
    await settle();
    const area = el().querySelector<HTMLTextAreaElement>('.tce__area')!;
    area.value = '**Aguardando chamado** #4321 — previsão sexta';
    area.dispatchEvent(new Event('input'));
    await settle();
    clickText('.tce__foot button', 'Guardar rascunho');
    await settle();
    expect(localStorage.getItem('prmake.situation-draft:75999')).toContain('previsão sexta');
    expect(el().querySelector('.tci--on .tc-state')!.textContent).toContain('Editado depois do envio');

    clickText('.tcd__toolbar button', 'Atualizar na discussion');
    await settle();
    expect(el().querySelector('.tc__bar--confirm')!.textContent).toContain('lida pelo cliente');
    expect(situations.publish).not.toHaveBeenCalled();
    clickText('.tc__bar--confirm button', 'Enviar');
    await settle();
    expect(situations.publish).toHaveBeenCalledWith('75999', '**Aguardando chamado** #4321 — previsão sexta');
    expect(localStorage.getItem('prmake.situation-draft:75999')).toBeNull();
    expect(el().querySelector('.tc__msg')!.textContent).toContain('publicado na discussion');
  });

  it('IA: avisa que usa a chave da pessoa, monta o prompt com o contexto marcado e "Usar este texto" leva ao editor', async () => {
    await open('a:a1');
    clickText('.tcd__toolbar button', 'Gerar de novo com IA');
    await settle();
    http.expectOne(r => r.url.endsWith('Azure/card/75999/full')).flush({
      id: 75999, rev: 1, fields: { 'System.Title': 'Filtro do relatório', 'Microsoft.VSTS.TCM.ReproSteps': '<p>Abrir o relatório</p>' },
      comments: [{ id: 1, text: '<p>Cliente: ainda falha</p>', createdByName: 'Cliente' }], history: [], alerts: {} as any,
    });
    await settle();
    expect(el().querySelector('.tca__cost')!.textContent).toContain('sua chave de IA');
    http.expectNone(r => r.url.includes('AI/generate'));

    const ask = el().querySelector<HTMLTextAreaElement>('.tca__ask')!;
    ask.value = 'deixe mais curto';
    ask.dispatchEvent(new Event('input'));
    // marca a discussion (desmarcada por padrão na análise)
    const discussion = [...el().querySelectorAll<HTMLLabelElement>('.tca__check')].find(l => l.textContent!.includes('Discussion'))!;
    const box = discussion.querySelector<HTMLInputElement>('input')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle();
    clickText('.tca__actions button', 'Gerar com a minha IA');
    await settle();
    const req = http.expectOne(r => r.method === 'POST' && r.url.endsWith('AI/generate'));
    const prompt = JSON.parse(req.request.body as string) as string;
    expect(prompt).toContain('deixe mais curto');
    expect(prompt).toContain('Título: Filtro do relatório');
    expect(prompt).toContain('Abrir o relatório');
    expect(prompt).toContain('Cliente: ainda falha');
    expect(prompt).toContain('### Texto atual');
    expect(prompt).not.toContain('### Situação atual');
    req.flush({ content: '## Análise curta\n\nTexto novo.' });
    await settle();
    expect(el().querySelector('.tca__col--new')!.textContent).toContain('Texto novo.');
    clickText('.tca__actions button', 'Usar este texto');
    await settle();
    expect(el().querySelector<HTMLTextAreaElement>('.tce__area')!.value).toBe('## Análise curta\n\nTexto novo.');
    http.expectNone(r => r.method === 'PUT');
  });

  it('IA sem chave/indisponível: mensagem amigável e o texto atual não muda', async () => {
    await open('a:a1');
    clickText('.tcd__toolbar button', 'Gerar de novo com IA');
    await settle();
    http.expectOne(r => r.url.endsWith('Azure/card/75999/full')).flush({ error: 'sem integração' }, { status: 502, statusText: 'x' });
    await settle();
    expect(el().querySelector('.tca__check--off')!.textContent).toContain('indisponível');
    clickText('.tca__actions button', 'Gerar com a minha IA');
    await settle();
    http.expectOne(r => r.url.endsWith('AI/generate')).flush({ error: 'Configure sua chave de IA.' }, { status: 400, statusText: 'x' });
    await settle();
    expect(el().querySelector('.tca .tc__msg--error')!.textContent).toContain('Configure sua chave de IA.');
    expect(el().querySelector('.tca .tc__msg--error')!.textContent).toContain('Minhas integrações');
  });
});
