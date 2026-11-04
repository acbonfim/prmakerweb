import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { renderMarkdown } from '../../helpers/markdown-ext';
import { CodeRefHostDirective } from './code-ref-host.directive';
import { CodeRefHead } from './code-ref.model';
import { CodeRefService } from './code-ref.service';
import { ReItemService } from './re-item.service';
import { fakeReItem } from './re-item-popover.component.spec';

const head = (ref: string, path: string, startLine: number, endLine: number, change: string): CodeRefHead => ({
  id: ref, planId: 'p', ref, repository: 'solvace-asp', path, startLine, endLine, change, title: null, commitSha: null,
  hasProposal: false, hasImplemented: false, updatedAt: '2026-11-04T00:00:00Z',
});

class FakeService {
  readonly changes = signal<{ card: string; kind: 'codeRef' | 'artifact' | 'all'; at: number } | null>(null);
  heads: CodeRefHead[] = [head('sa3-init', 'systems/sa3/sa3_busca_a3.asp', 239, 289, 'change')];
  loads = 0;
  watched: string[] = [];
  async loadHeads(): Promise<CodeRefHead[]> { this.loads++; return this.heads; }
  watch(card: string) { this.watched.push(card); }
  unwatch(card: string) { this.watched = this.watched.filter(c => c !== card); }
  async attachment(_card: string, name: string): Promise<Blob> {
    if (name === 'existe.png') {
      // PNG 1x1 transparente
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      return new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/png' });
    }
    throw new Error('404');
  }
}

@Component({
  standalone: true,
  imports: [CodeRefHostDirective],
  template: `<div class="host" [appCodeRefHost]="card()" [innerHTML]="html()"></div>`,
})
class HostComponent {
  readonly card = signal<string | null>('75812');
  readonly html = signal('');
}

async function settle(f: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 5; i++) {
    f.detectChanges();
    await f.whenStable();
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  }
}

describe('CodeRefHostDirective (0075/F2, F3)', () => {
  let svc: FakeService;
  let f: ComponentFixture<HostComponent>;

  beforeEach(() => {
    svc = new FakeService();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection(), { provide: CodeRefService, useValue: svc },
        { provide: ReItemService, useValue: { get: async () => ({ status: 'ok', item: fakeReItem() }) } }],
    });
    f = TestBed.createComponent(HostComponent);
  });

  const root = () => (f.nativeElement as HTMLElement).querySelector('.host') as HTMLElement;

  it('sem link de código não carrega as cabeças; entra no tempo real do card', async () => {
    f.componentInstance.html.set(renderMarkdown('texto **comum**', { codeRefs: true }));
    await settle(f);
    expect(svc.loads).toBe(0);
    expect(svc.watched).toEqual(['75812']);
  });

  it('decora links: tipo da mudança, title e citação sem fotografia', async () => {
    f.componentInstance.html.set(renderMarkdown([
      '- [`sa3_busca_a3.asp:239-289`](ref:sa3-init) — ordem',
      '- solvace-asp/systems/sa3/sa3_busca_a3.asp:250 — dentro',
      '- solvace-core/x/loadSelectOptions.class.js:336-353 — sem fotografia',
      '- [ref inexistente](ref:nada)',
    ].join('\n'), { codeRefs: true }));
    await settle(f);
    const links = [...root().querySelectorAll<HTMLAnchorElement>('a.code-ref, a.code-cite')];
    expect(links.length).toBe(4);
    expect(links[0].classList).toContain('code-ref--change');
    expect(links[0].title).toBe('Alterar · systems/sa3/sa3_busca_a3.asp:239-289');
    expect(links[1].classList).toContain('code-ref--change');
    expect(links[2].classList).toContain('code-cite--missing');
    expect(links[2].title).toContain('Sem fotografia');
    expect(links[3].classList).toContain('code-ref--missing');
    expect(svc.loads).toBe(1);
  });

  it('clique no link não navega (preventDefault)', async () => {
    f.componentInstance.html.set(renderMarkdown('veja a/b/c.js:10', { codeRefs: true }));
    await settle(f);
    const a = root().querySelector<HTMLAnchorElement>('a.code-cite')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBeTrue();
    await settle(f);
    document.querySelectorAll('.cdk-overlay-container').forEach(c => c.remove());
  });

  it('imagens anexo:: carrega pelo nome, legenda pelo alt e placeholder quando não acha', async () => {
    f.componentInstance.html.set(renderMarkdown(
      '![Antes — filtro vazio](anexo:existe.png) ![Depois](anexo:falta.png)', { codeRefs: true }));
    await settle(f);
    const figures = [...root().querySelectorAll<HTMLElement>('.md-gallery > .md-figure')];
    expect(figures.length).toBe(2);
    const ok = figures[0].querySelector<HTMLImageElement>('img.md-attachment')!;
    expect(ok.src).toMatch(/^blob:/);
    expect(ok.classList).toContain('md-attachment--ok');
    expect(figures[0].querySelector('.md-figure__caption')!.textContent).toBe('Antes — filtro vazio');
    expect(figures[1].classList).toContain('md-figure--missing');
    expect(figures[1].querySelector('.md-figure__missing')!.textContent).toContain('Imagem não encontrada · falta.png');
  });

  it('0076: clique em UC-121 abre o popover do item da engenharia reversa; de novo fecha', async () => {
    f.componentInstance.html.set(renderMarkdown('regra UC-121', { codeRefs: true, reRefs: true }));
    await settle(f);
    const a = root().querySelector<HTMLAnchorElement>('a.re-ref')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBeTrue();
    await settle(f);
    await settle(f);
    const pop = document.querySelector('.cdk-overlay-container app-re-item-popover');
    expect(pop).not.toBeNull();
    expect(pop!.querySelector('.rei__title')!.textContent).toContain('Registrar melhoria');
    a.click();
    await settle(f);
    expect(document.querySelector('.cdk-overlay-container app-re-item-popover')).toBeNull();
    document.querySelectorAll('.cdk-overlay-container').forEach(c => c.remove());
  });
});
