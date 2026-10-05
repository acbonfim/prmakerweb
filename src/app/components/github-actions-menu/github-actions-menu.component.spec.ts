import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { GithubActionsMenuComponent } from './github-actions-menu.component';
import { CliipboardService } from '../../services/cliipboard.service';
import { GithubPullRequest } from '../../services/pull-request.service';

const pr = (id: number, status: GithubPullRequest['status'], target: string, number: number): GithubPullRequest => ({
  id, pullRequestRegisterId: 1, cardNumber: '75294', repositoryId: 'org/repo', branchPrefix: 'hotfix/', branchName: '75294',
  targetBranch: target, number, url: `https://github.com/org/repo/pull/${number}`, title: '', description: '', status,
  isDraft: false, statusSyncedAt: null, statusStale: false, alreadyExisted: false, userId: 'u', createdAt: '', updatedAt: null,
});

describe('GithubActionsMenuComponent', () => {
  let fixture: ComponentFixture<GithubActionsMenuComponent>;
  let clipboard: jasmine.SpyObj<CliipboardService>;
  const body = () => document.body as HTMLElement;
  const click = (selector: string) => (body().querySelector(selector) as HTMLElement).click();

  beforeEach(() => {
    clipboard = jasmine.createSpyObj('CliipboardService', ['copyFullDescriptionToClipboard', 'copyRichToClipboard']);
    clipboard.copyRichToClipboard.and.resolveTo();
    TestBed.configureTestingModule({
      imports: [GithubActionsMenuComponent, NoopAnimationsModule],
      providers: [provideZonelessChangeDetection(), { provide: CliipboardService, useValue: clipboard }],
    });
    fixture = TestBed.createComponent(GithubActionsMenuComponent);
    fixture.componentRef.setInput('cardNumber', '75294');
    fixture.componentRef.setInput('canOpenPr', true);
    fixture.componentRef.setInput('targetOptions', [{ label: 'HV', value: 'hv' }, { label: 'DEV', value: 'dev' }]);
    fixture.componentRef.setInput('prs', [pr(1, 'MERGED', 'hv', 12), pr(2, 'OPEN', 'dev', 13), pr(3, 'CLOSED', 'dev', 14)]);
    fixture.detectChanges();
  });

  afterEach(() => fixture?.destroy());

  it('"Abrir PR" emite openPr', () => {
    const emitted = jasmine.createSpy('openPr');
    fixture.componentInstance.openPr.subscribe(emitted);
    (fixture.nativeElement.querySelector('button') as HTMLElement).click();
    fixture.detectChanges();
    click('.ga-item');
    expect(emitted).toHaveBeenCalled();
  });

  it('"Copiar PR" lista só abertos/mesclados, com status colorido, e copia o texto no formato pedido', () => {
    (fixture.nativeElement.querySelector('button') as HTMLElement).click();
    fixture.detectChanges();
    (body().querySelectorAll('.ga-item')[1] as HTMLElement).click();
    fixture.detectChanges();

    expect(body().querySelectorAll('.ga-pr').length).toBe(2);
    expect(body().querySelector('.ga-chip--merged')?.textContent).toContain('MERGEADO');
    expect(body().querySelector('.ga-chip--open')?.textContent).toContain('ABERTO');
    expect(body().querySelector('.ga-env')?.textContent).toContain('HV');

    click('.ga-copy__footer button[mat-flat-button]');
    expect(clipboard.copyFullDescriptionToClipboard).toHaveBeenCalledWith(
      '75294 [HV] - https://github.com/org/repo/pull/12\n75294 [DEV] - https://github.com/org/repo/pull/13');
  });

  it('desmarcar um PR tira ele da cópia; formato tabela copia HTML + markdown', () => {
    (fixture.nativeElement.querySelector('button') as HTMLElement).click();
    fixture.detectChanges();
    (body().querySelectorAll('.ga-item')[1] as HTMLElement).click();
    fixture.detectChanges();

    fixture.componentInstance.toggle(fixture.componentInstance.copyable()[1], false);
    fixture.componentInstance.format.set('table');
    fixture.detectChanges();
    click('.ga-copy__footer button[mat-flat-button]');

    const [html, text] = clipboard.copyRichToClipboard.calls.mostRecent().args;
    expect(html).toContain('<table');
    expect(html).not.toContain('pull/13');
    expect(text).toContain('| 75294 | HV | https://github.com/org/repo/pull/12 |');
  });
});
