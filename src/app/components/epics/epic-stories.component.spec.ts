import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { EpicStoriesService } from '../../services/epic-stories.service';
import { EpicsService } from '../../services/epics.service';
import { EpicStoriesComponent } from './epic-stories.component';
import { EpicStory } from './epic-stories.logic';

function story(p: Partial<EpicStory>): EpicStory {
  return {
    id: `id-${p.number}`, number: 1, type: 'user-story', title: 'Título', tags: [], fields: {}, status: 'draft',
    createdByName: 'Ana', createdAt: '2026-11-20T10:00:00', updatedAt: '2026-11-20T10:00:00', ...p
  };
}

class FakeStories {
  list$: EpicStory[] = [];
  listed: number[] = [];
  list(epic: number) { this.listed.push(epic); return of(this.list$); }
  listen() { return () => undefined; }
}

class FakeEpics {
  tags() { return of(['mesa']); }
}

describe('EpicStoriesComponent (0099 ajustes 2)', () => {
  let stories: FakeStories;

  beforeEach(() => {
    stories = new FakeStories();
    TestBed.configureTestingModule({
      imports: [EpicStoriesComponent],
      providers: [
        provideZonelessChangeDetection(), provideNoopAnimations(),
        { provide: EpicStoriesService, useValue: stories },
        { provide: EpicsService, useValue: new FakeEpics() }
      ]
    });
  });

  async function render(epic: number | null = 12) {
    const fixture = TestBed.createComponent(EpicStoriesComponent);
    fixture.componentRef.setInput('epic', epic);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('sem histórias mostra o estado vazio explicativo', async () => {
    const fixture = await render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(stories.listed).toEqual([12]);
    expect(text).toContain('Escreva aqui histórias e bugs antes de virarem card no DevOps');
    expect(text).toContain('o Especialista também escreve rascunhos');
  });

  it('lista com tipo, situação, "Converter em card" só nas não convertidas e "Card #n ↗" que abre o card', async () => {
    stories.list$ = [
      story({ number: 5, title: 'Exportar PDF', status: 'ready' }),
      story({ number: 6, type: 'bug', title: 'Erro ao salvar', status: 'converted', cardId: 78123, convertedByName: 'Alex' })
    ];
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('.est__row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('#5');
    expect(rows[0].textContent).toContain('Pronta');
    expect(rows[0].textContent).toContain('Converter em card');
    expect(rows[1].textContent).toContain('Convertida');
    expect(rows[1].textContent).not.toContain('Converter em card');
    expect(rows[1].querySelector('.est__ty')?.textContent).toContain('bug_report');

    const opened: string[] = [];
    fixture.componentInstance.cardOpened.subscribe((c) => opened.push(c));
    (rows[1].querySelector('.est__card') as HTMLButtonElement).click();
    expect(opened).toEqual(['78123']);

    // Filtro "Convertidas" deixa só a convertida.
    const seg = Array.from(el.querySelectorAll<HTMLButtonElement>('.est__seg-btn'));
    seg.find((b) => b.textContent?.includes('Convertidas'))!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.est__row').length).toBe(1);
  });
});
