import { EventEmitter, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { DevOpsService } from '../../services/devops.service';
import { EpicsService } from '../../services/epics.service';
import { RoleService } from '../../services/role.service';
import { WsService } from '../../services/ws.service';
import { WorkItemPickerSource } from '../work-item-pickers/work-item-picker-source.service';
import { DevOpsBoardComponent } from './devops-board.component';
import { DevOpsCardCreateComponent } from './devops-card-create';
import { DevOpsCardPanelComponent } from './devops-card-panel.component';
import { BoardConfig, BoardItem, CardDetail, CreateCardRequest, DevOpsFieldDef, MoveCardRequest, UpdateCardRequest } from './devops.model';

const CONFIG: BoardConfig = {
  team: 'Time A', board: 'Stories', configHash: 'h1',
  columns: [
    { id: 'c1', name: 'New', itemLimit: 0, columnType: 'incoming', isSplit: false, stateMappings: { Bug: 'New', 'User Story': 'New' } },
    { id: 'c2', name: 'Active', itemLimit: 1, columnType: 'inProgress', isSplit: true, stateMappings: { Bug: 'Active', 'User Story': 'Active' } },
    { id: 'c3', name: 'QA', itemLimit: 0, columnType: 'inProgress', isSplit: false, stateMappings: { 'User Story': 'Resolved' } },
  ],
  lanes: [{ id: 'l0', name: null, isDefault: true }, { id: 'l1', name: 'Expedite', isDefault: false }],
  fields: { column: 'WEF_X_Kanban.Column', lane: 'WEF_X_Kanban.Lane', done: 'WEF_X_Kanban.Column.Done' },
  types: [{ name: 'Bug', color: 'CC293D' }, { name: 'User Story', color: '009CCC' }],
  orderField: 'Microsoft.VSTS.Common.StackRank',
};

function item(id: number, extra: Partial<BoardItem> = {}): BoardItem {
  return { id, rev: 1, type: 'Bug', title: `Card ${id}`, state: 'New', tags: [], column: 'New', done: false, lane: null, order: id, ...extra };
}

const DEFS: DevOpsFieldDef[] = [
  { referenceName: 'System.Title', name: 'Title', type: 'string', required: true, readOnly: false, allowedValues: [] },
  { referenceName: 'System.State', name: 'State', type: 'string', required: true, readOnly: false, allowedValues: ['New', 'Active'] },
  { referenceName: 'System.AssignedTo', name: 'Assigned To', type: 'identity', required: false, readOnly: false, allowedValues: [] },
  { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', type: 'integer', required: false, readOnly: false, allowedValues: ['1', '2', '3'] },
  { referenceName: 'Custom.Client', name: 'Client', type: 'string', required: true, readOnly: false, allowedValues: [] },
  { referenceName: 'System.Description', name: 'Description', type: 'html', required: false, readOnly: false, allowedValues: [] },
];

function card(extra: Partial<CardDetail> = {}): CardDetail {
  return {
    id: 501, rev: 3, type: 'Bug', title: 'Erro ao exportar', state: 'New', tags: ['Cliente'],
    url: 'https://dev.azure.com/org/proj/_apis/wit/workItems/501',
    fields: { 'System.State': 'New', 'Microsoft.VSTS.Common.Priority': 2, 'Custom.Client': 'Gerdau', 'WEF_X_Kanban.Column': 'New' },
    relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', id: 77, url: '' }], ...extra,
  };
}

class FakeDevOps {
  items: BoardItem[] = [item(1), item(2, { order: 0 }), item(3, { column: 'Active', type: 'User Story' }), item(4, { column: 'Active', lane: 'Expedite' })];
  moves: { id: number | string; body: MoveCardRequest }[] = [];
  moveFails = false;
  updates: UpdateCardRequest[] = [];
  creates: CreateCardRequest[] = [];
  boardItemsCalls = 0;
  types() { return of([{ name: 'Bug', color: 'CC293D', icon: 'icon_insect' }, { name: 'User Story', color: '009CCC', icon: 'icon_book' }]); }
  teams() { return of([{ id: 't', name: 'Time A' }]); }
  boards() { return of([{ id: 'b', name: 'Stories' }]); }
  board() { return of(CONFIG); }
  boardItems() { this.boardItemsCalls++; return of({ configHash: 'h1', items: this.items }); }
  fields() { return of(DEFS); }
  tags() { return of(['Cliente', 'Urgente']); }
  people() { return of([]); }
  areas() { return of([]); }
  iterations() { return of([]); }
  card(id: number | string) { return of(card({ id: +id })); }
  epicsOfCard() { return of([]); }
  addToEpic() { return of({}); }
  move(id: number | string, body: MoveCardRequest): Observable<CardDetail> {
    this.moves.push({ id, body });
    return this.moveFails ? throwError(() => ({ status: 400, error: { code: 'rule', message: 'Transição não permitida' } })) : of(card({ id: +id, state: 'Active' }));
  }
  update(_id: number | string, body: UpdateCardRequest) { this.updates.push(body); return of(card({ title: 'Novo título' })); }
  create(body: CreateCardRequest) { this.creates.push(body); return of(card({ id: 900 })); }
}

class FakeEpics {
  saved: { epic: number; filters: unknown }[] = [];
  saveBoardFilters(epic: number, filters: unknown) { this.saved.push({ epic, filters }); return of({}); }
  tags() { return of([]); }
}

class FakeWs {
  groups: string[] = [];
  handlers = new Map<string, (...a: unknown[]) => void>();
  _resynced = new EventEmitter<void>();
  addToGroup(g: string) { this.groups.push(g); }
  removeFromGroup(g: string) { this.groups = this.groups.filter((x) => x !== g); }
  on(e: string, h: (...a: unknown[]) => void) { this.handlers.set(e, h); }
  off(e: string) { this.handlers.delete(e); }
}

class FakePickers {
  states() { return of({ type: 'Bug', current: 'New', states: [{ name: 'New' }, { name: 'Active' }, { name: 'Closed' }] }); }
}

describe('Componentes do DevOps (0099)', () => {
  let api: FakeDevOps;
  let ws: FakeWs;
  let epics: FakeEpics;
  let snacks: string[];

  beforeEach(() => {
    api = new FakeDevOps();
    ws = new FakeWs();
    epics = new FakeEpics();
    snacks = [];
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideRouter([]),
        { provide: DevOpsService, useValue: api },
        { provide: WsService, useValue: ws },
        { provide: EpicsService, useValue: epics },
        // Ajustes 2: o painel lê os papéis ("Abrir na Bancada" só para admin/dev).
        { provide: RoleService, useValue: { canOpenWorkbenchFromDesk: true } },
        { provide: WorkItemPickerSource, useValue: new FakePickers() },
        { provide: MatSnackBar, useValue: { open: (m: string) => { snacks.push(m); return { onAction: () => of() }; } } },
      ],
    });
  });

  async function board(savedFilters: unknown = null) {
    const fixture = TestBed.createComponent(DevOpsBoardComponent);
    fixture.componentRef.setInput('team', 'Time A');
    fixture.componentRef.setInput('board', 'Stories');
    fixture.componentRef.setInput('epic', 12);
    fixture.componentRef.setInput('savedFilters', savedFilters);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r)); // a carga do board é uma Promise (fora das tarefas que o whenStable espera)
    fixture.detectChanges();
    return fixture;
  }

  it('board: colunas na ordem, WIP estourado, Doing/Done, lanes e cartões', async () => {
    const fixture = await board();
    const el: HTMLElement = fixture.nativeElement;
    const heads = [...el.querySelectorAll('.dvb-head__name')].map((h) => h.textContent?.trim());
    expect(heads).toEqual(['New', 'Active', 'QA']);
    expect(el.querySelector('.dvb-head__count--over')?.textContent).toContain('2');
    expect(el.querySelectorAll('.dvb-head__split').length).toBe(1);
    expect([...el.querySelectorAll('.dvb-lane__name')].map((l) => l.textContent?.trim())).toEqual(['Padrão', 'Expedite']);
    expect(el.querySelectorAll('.dvb-card').length).toBe(4);
    // ordem do board na primeira célula: 2 (order 0) antes do 1
    const firstCell = el.querySelector('.dvb-row .dvb-cell')!;
    expect([...firstCell.querySelectorAll('.dvb-card__id')].map((x) => x.textContent)).toEqual(['2', '1']);
    expect(ws.groups).toContain('devops');
    expect(ws.handlers.has('devopsCardsUpdated')).toBeTrue();
    expect(el.textContent).toContain('Cards do épico');
  });

  it('board: título abre o card; filtro de texto esconde os outros', async () => {
    const fixture = await board();
    const opened: number[] = [];
    fixture.componentInstance.cardOpened.subscribe((id) => opened.push(id));
    (fixture.nativeElement.querySelector('.dvb-card__title') as HTMLElement).click();
    expect(opened).toEqual([2]);
    fixture.componentInstance.setText('Card 4');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.dvb-card').length).toBe(1);
  });

  it('board: filtros vêm do épico (lane) e mudar grava no épico com debounce (ajustes 1)', async () => {
    const fixture = await board({ lanes: ['Expedite'], types: [], states: [], assignedTo: [], tags: [], text: '' });
    const el: HTMLElement = fixture.nativeElement;
    expect([...el.querySelectorAll('.dvb-card__id')].map((x) => x.textContent)).toEqual(['4']);
    expect(el.querySelector('.dvb-saved')?.textContent).toContain('especialista');
    expect(epics.saved.length).toBe(0); // carregar não grava

    fixture.componentInstance.toggle('types', 'Bug', new Event('click'));
    fixture.componentInstance.setText('card');
    await new Promise((r) => setTimeout(r, 700));
    expect(epics.saved.length).toBe(1);
    expect(epics.saved[0]).toEqual({
      epic: 12, filters: { text: 'card', types: ['Bug'], assignedTo: [], tags: [], states: [], lanes: ['Expedite'], hiddenColumns: [] },
    });

    // O épico relido traz o que foi gravado: não sobrescreve nem grava de novo.
    fixture.componentRef.setInput('savedFilters', epics.saved[0].filters);
    fixture.detectChanges();
    expect(fixture.componentInstance.filter().text).toBe('card');
    fixture.componentInstance.clearFilter();
    await new Promise((r) => setTimeout(r, 700));
    expect(epics.saved.length).toBe(2);
    expect((epics.saved[1].filters as { lanes: string[] }).lanes).toEqual([]);

    // Colunas ocultas saem do board e são gravadas junto; "Limpar filtros" não as mostra de volta.
    fixture.componentInstance.toggleColumn('QA', new Event('click'));
    fixture.detectChanges();
    const heads = () => [...fixture.nativeElement.querySelectorAll('.dvb-head__name')].map((h: Element) => h.textContent?.trim());
    expect(heads()).toEqual(['New', 'Active']);
    fixture.componentInstance.clearFilter();
    fixture.detectChanges();
    expect(heads()).toEqual(['New', 'Active']);
    await new Promise((r) => setTimeout(r, 700));
    expect((epics.saved[2].filters as { hiddenColumns: string[] }).hiddenColumns).toEqual(['QA']);
    expect(fixture.nativeElement.querySelector('.dvb-saved')?.textContent).toContain('Mostrar todas as colunas');
  });

  it('board: arrastar move otimista com vizinhos/lane/done e desfaz com aviso no erro', async () => {
    const fixture = await board();
    const cmp = fixture.componentInstance;
    const lanes = cmp.lanes();
    const from = lanes[0].columns[0].doing; // New, lane padrão: [2, 1]
    const to = lanes[1].columns[1].done!;   // Active/Done, lane Expedite
    const ev = (container: unknown, prev: unknown, data: BoardItem, previousIndex: number, currentIndex: number) => {
      const target = { data: container };
      return { container: target, previousContainer: prev === container ? target : { data: prev }, item: { data }, previousIndex, currentIndex } as any;
    };
    expect(cmp.enterPredicate({ data: item(1) } as any, { data: lanes[0].columns[2].doing } as any)).toBeFalse();
    expect(cmp.enterPredicate({ data: item(3, { type: 'User Story' }) } as any, { data: lanes[0].columns[2].doing } as any)).toBeTrue();

    cmp.drop(ev(to, from, from.items[1], 1, 0));
    expect(api.moves.length).toBe(1);
    expect(api.moves[0]).toEqual({ id: 1, body: { team: 'Time A', board: 'Stories', column: 'Active', previousId: null, nextId: null, lane: 'Expedite', done: true } });
    const moved = cmp.items().find((i) => i.id === 1)!;
    expect(moved.column).toBe('Active');
    expect(moved.state).toBe('Active');

    api.moveFails = true;
    const lanes2 = cmp.lanes();
    const cell = lanes2[0].columns[0].doing; // [2]
    const target = lanes2[0].columns[1].doing; // Active/Doing lane padrão: [3]
    cmp.drop(ev(target, cell, cell.items[0], 0, 1));
    expect(api.moves[1].body).toEqual({ team: 'Time A', board: 'Stories', column: 'Active', previousId: 3, nextId: null, done: false });
    expect(cmp.items().find((i) => i.id === 2)!.column).toBe('New'); // rollback
    expect(snacks[0]).toContain('Transição não permitida');

    // mesma posição na mesma célula: nada
    cmp.drop(ev(cell, cell, cell.items[0], 0, 0));
    expect(api.moves.length).toBe(2);
  });

  it('board: devopsCardsUpdated re-busca os itens', async () => {
    const fixture = await board();
    jasmine.clock().install();
    try {
      const before = api.boardItemsCalls;
      ws.handlers.get('devopsCardsUpdated')!({ ids: ['1'], action: 'updated' });
      jasmine.clock().tick(1000);
      expect(api.boardItemsCalls).toBe(before + 1);
      fixture.destroy();
      expect(ws.handlers.has('devopsCardsUpdated')).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('painel: carrega o card, edita e salva só o que mudou', async () => {
    const fixture = TestBed.createComponent(DevOpsCardPanelComponent);
    fixture.componentRef.setInput('cardId', 501);
    fixture.componentRef.setInput('epic', 12);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    const el: HTMLElement = fixture.nativeElement;
    expect(cmp.detail()?.id).toBe(501);
    expect(el.querySelector('.dvp__id')?.getAttribute('href')).toBe('https://dev.azure.com/org/proj/_workitems/edit/501');
    expect(el.textContent).toContain('Adicionar ao épico #12');
    expect(el.textContent).toContain('Pai: 77');
    expect(cmp.stateOptions()).toEqual(['New', 'Active', 'Closed']);
    expect(cmp.dirty()).toBeFalse();

    cmp.title.set('Novo título');
    cmp.setValue('Microsoft.VSTS.Common.Priority', '1');
    cmp.tags.set(['Cliente', 'Urgente']);
    expect(cmp.patch()).toEqual({
      fields: { 'Microsoft.VSTS.Common.Priority': 1, 'System.Title': 'Novo título' },
      addTags: ['Urgente'],
    });
    cmp.save();
    expect(api.updates.length).toBe(1);
    expect(cmp.title()).toBe('Novo título');
    expect(snacks[0]).toContain('salvo');
  });

  it('criar: tipo padrão, obrigatórios, épico e coluna no POST', async () => {
    let closedWith: CardDetail | undefined;
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { epic: 12, team: 'Time A', board: 'Stories', column: 'New' } },
        { provide: MatDialogRef, useValue: { close: (c: CardDetail) => (closedWith = c) } },
      ],
    });
    const fixture = TestBed.createComponent(DevOpsCardCreateComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    expect(cmp.type()).toBe('User Story');
    expect(fixture.nativeElement.textContent).toContain('Será adicionado ao épico #12');
    expect(cmp.canSave()).toBeFalse();
    expect(cmp.missing()).toEqual(['Título', 'Client']);
    cmp.title.set('Relatório de bugs');
    cmp.setValue('Custom.Client', 'Gerdau');
    cmp.tags.set(['Nova']);
    expect(cmp.canSave()).toBeTrue();
    cmp.save();
    expect(api.creates[0]).toEqual({
      type: 'User Story', title: 'Relatório de bugs', parentId: null, epic: 12, team: 'Time A', board: 'Stories', column: 'New', lane: null,
      fields: { 'Custom.Client': 'Gerdau' }, tags: ['Nova'],
    });
    expect(closedWith?.id).toBe(900);
  });
});
