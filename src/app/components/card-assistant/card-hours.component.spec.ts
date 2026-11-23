import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { CardAssistantService } from '../../services/card-assistant.service';
import { CardHoursComponent } from './card-hours.component';

@Component({
  standalone: true,
  imports: [CardHoursComponent],
  template: `
    <div style="display: flex" [style.width.px]="width()">
      <app-card-hours style="flex: 1 1 0; min-width: 0; overflow: hidden" [adaptive]="adaptive()" cardNumber="78655"></app-card-hours>
    </div>`
})
class HostComponent {
  width = signal(900);
  adaptive = signal(true);
}

/** Bancada em telas menores: a linha de horas se compacta medindo o que cabe, sem nada passar por cima do vizinho. */
describe('CardHoursComponent (compactação medida)', () => {
  let fixture: ComponentFixture<HostComponent>;
  const effort = signal<unknown>({ status: 'ready', effort: { originalEstimate: 6, completedWork: 2, remainingWork: 0 }, error: null });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent, NoopAnimationsModule],
      providers: [provideZonelessChangeDetection(), {
        provide: CardAssistantService,
        useValue: {
          effortOf: () => effort,
          averageHours: signal(3),
          hoursPerStep: signal(1),
          loadSettings: () => Promise.resolve(),
          loadEffort: () => Promise.resolve(null)
        }
      }]
    });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  const hours = () => fixture.debugElement.query(By.directive(CardHoursComponent));
  const comp = () => hours().componentInstance as CardHoursComponent;
  const host = () => hours().nativeElement as HTMLElement;
  const row = () => host().querySelector<HTMLElement>('.hr')!;
  const visible = (sel: string) => {
    const el = host().querySelector<HTMLElement>(sel);
    return !!el && getComputedStyle(el).display !== 'none';
  };
  const at = (width: number) => {
    fixture.componentInstance.width.set(width);
    fixture.detectChanges();
    comp().fit();
    fixture.detectChanges();
  };

  it('com espaço, a linha fica completa', () => {
    at(900);
    expect(comp().level()).toBe(0);
    expect(host().textContent).toContain('Completed 2h');
    expect(visible('.hr__bar')).toBeTrue();
    expect(visible('.hr__pill')).toBeFalse();
  });

  it('quanto menos espaço, mais compacta — e o que fica sempre cabe', () => {
    let last = 0;
    for (const width of [900, 520, 420, 340, 260, 180, 120, 60]) {
      at(width);
      const level = comp().level();
      expect(level).toBeGreaterThanOrEqual(last);
      last = level;
      if (level < 6) expect(row().scrollWidth).toBeLessThanOrEqual(row().clientWidth + 1);
    }
    expect(last).toBe(6);
  });

  it('rótulos curtos mantêm o texto completo para leitores de tela', () => {
    at(900);
    host().classList.add('hr--short');
    const label = host().querySelector<HTMLElement>('.hr__fact--done .hr__k')!;
    expect(label.textContent).toBe('Completed');
    expect(getComputedStyle(label, '::after').content).toBe('"Comp"');
  });

  it('sem espaço vira a pastilha, que abre as horas completas num popover', async () => {
    at(150);
    expect(comp().level()).toBeGreaterThanOrEqual(5);
    expect(visible('.hr__pill')).toBeTrue();
    expect(visible('.hr__facts')).toBeFalse();
    expect(host().querySelector('.hr__pill')!.textContent).toContain('2h/6h');

    host().querySelector<HTMLButtonElement>('.hr__pill')!.click();
    fixture.detectChanges();
    const pop = TestBed.inject(OverlayContainer).getContainerElement().querySelector<HTMLElement>('.hr-pop')!;
    expect(pop).toBeTruthy();
    expect(pop.textContent).toContain('Original 6h');
    expect(pop.textContent).toContain('Remaining 0h');
    expect(pop.textContent).toContain('média do time 3h');
    expect(pop.querySelector('.hr__log')).toBeTruthy();

    at(900);
    expect(comp().open()).toBeFalse();
  });

  it('fora da Bancada (sem adaptive) não compacta nem mostra a pastilha', () => {
    fixture.componentInstance.adaptive.set(false);
    at(150);
    expect(comp().level()).toBe(0);
    expect(host().querySelector('.hr__pill')).toBeNull();
    expect(host().classList).not.toContain('hr--fit');
  });
});
