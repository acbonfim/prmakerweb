import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { GovernanceInterceptor } from '../../auth/governance.interceptor';

/** O aviso de barrado abre num setTimeout (depois do tratamento da tela). App zoneless: sem fakeAsync. */
const tick = () => new Promise((r) => setTimeout(r, 5));

/** 0098: o interceptor só reage ao 403 da governança e ao cabeçalho de aviso; os outros 403 seguem como antes. */
describe('GovernanceInterceptor (0098)', () => {
  let http: HttpClient;
  let ctl: HttpTestingController;
  let dialog: jasmine.SpyObj<MatDialog>;
  let snack: jasmine.SpyObj<MatSnackBar>;

  beforeEach(() => {
    dialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
    snack = jasmine.createSpyObj<MatSnackBar>('MatSnackBar', ['open']);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: HTTP_INTERCEPTORS, useClass: GovernanceInterceptor, multi: true },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snack },
      ],
    });
    http = TestBed.inject(HttpClient);
    ctl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctl.verify());

  it('403 governance_blocked abre o aviso com o motivo e a regra, e o erro chega à tela', async () => {
    let status = 0;
    http.post('/api/v1/Azure/card/1/actions/ready-for-qa', {}).subscribe({ error: (e) => (status = e.status) });
    ctl.expectOne('/api/v1/Azure/card/1/actions/ready-for-qa').flush(
      { code: 'governance_blocked', message: 'Barrado pela governança: só o suporte move para QA', rules: [{ key: 'qa-only-support', name: 'QA só pelo suporte', effect: 'block', message: '' }] },
      { status: 403, statusText: 'Forbidden' },
    );
    await tick();
    expect(status).toBe(403);
    expect(dialog.open).toHaveBeenCalledTimes(1);
    const data = dialog.open.calls.mostRecent().args[1]!.data as { message: string; rules: { key: string }[] };
    expect(data.message).toBe('só o suporte move para QA');
    expect(data.rules[0].key).toBe('qa-only-support');
  });

  it('403 de integração pessoal não é tratado aqui', async () => {
    http.get('/api/v1/x').subscribe({ error: () => undefined });
    ctl.expectOne('/api/v1/x').flush({ code: 'PERSONAL_INTEGRATION_REQUIRED', plugins: ['GitHub'] }, { status: 403, statusText: 'Forbidden' });
    await tick();
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('cabeçalho X-Governance-Warning vira aviso (decodificado) e repetido em seguida não duplica', () => {
    for (let i = 0; i < 2; i++) {
      http.get('/api/v1/y').subscribe();
      ctl.expectOne('/api/v1/y').flush({}, { headers: { 'X-Governance-Warning': 'Voc%C3%AA%20passou%20do%20teto' } });
    }
    expect(snack.open).toHaveBeenCalledTimes(1);
    expect(snack.open.calls.mostRecent().args[0]).toContain('Você passou do teto');
  });
});
