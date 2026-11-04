import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { ExecutionPlanService } from '../../services/execution-plan.service';
import { DevOpsActionsService } from '../../services/devops-actions.service';
import { QaCompleteDialogComponent, isQaValidationStep } from './qa-complete-dialog.component';

describe('QaCompleteDialogComponent (0075/F5)', () => {
  let plans: jasmine.SpyObj<ExecutionPlanService>;
  let devops: jasmine.SpyObj<DevOpsActionsService>;
  let ref: { close: jasmine.Spy; disableClose: boolean };
  let f: ComponentFixture<QaCompleteDialogComponent>;
  let c: QaCompleteDialogComponent;

  beforeEach(() => {
    plans = jasmine.createSpyObj<ExecutionPlanService>('ExecutionPlanService', ['completeStep']);
    devops = jasmine.createSpyObj<DevOpsActionsService>('DevOpsActionsService', ['run']);
    ref = { close: jasmine.createSpy('close'), disableClose: false };
    TestBed.configureTestingModule({
      imports: [QaCompleteDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ExecutionPlanService, useValue: plans },
        { provide: DevOpsActionsService, useValue: devops },
        { provide: MatDialogRef, useValue: ref },
        { provide: MAT_DIALOG_DATA, useValue: { planId: 'p1', stepKey: 'validar-qa', stepTitle: 'Validar em QA', cardNumber: '75812' } },
      ],
    });
    f = TestBed.createComponent(QaCompleteDialogComponent);
    c = f.componentInstance;
    f.detectChanges();
  });

  it('reconhece as etapas de validar em QA', () => {
    expect(isQaValidationStep('validar-qa')).toBeTrue();
    expect(isQaValidationStep('validar-qa-edv-solvace')).toBeTrue();
    expect(isQaValidationStep('VALIDAR-QA')).toBeTrue();
    expect(isQaValidationStep('validar-qa2')).toBeFalse();
    expect(isQaValidationStep('fechar-card')).toBeFalse();
    expect(isQaValidationStep(null)).toBeFalse();
  });

  it('opção "Mover para Ready for QA" vem marcada, com o texto auxiliar', () => {
    const el = f.nativeElement as HTMLElement;
    expect(c.move).toBeTrue();
    expect(el.textContent).toContain('Mover o card para Ready for QA agora');
    expect(el.textContent).toContain('o card sai de Dev Test in QA e vai para Ready for QA no DevOps');
  });

  it('marcado: conclui a etapa e move o card', async () => {
    plans.completeStep.and.returnValue(of({} as any));
    devops.run.and.resolveTo({ rev: 3, message: 'Card movido para Ready for QA.' });
    await c.confirm();
    f.detectChanges();
    expect(plans.completeStep).toHaveBeenCalledWith('p1', 'validar-qa');
    expect(devops.run).toHaveBeenCalledWith('75812', 'ready-for-qa');
    expect(c.result()).toEqual({ completed: true, moveRequested: true, moved: true, error: null });
    expect((f.nativeElement as HTMLElement).textContent).toContain('Card movido para Ready for QA.');
    c.close();
    expect(ref.close).toHaveBeenCalledWith(jasmine.objectContaining({ completed: true, moved: true }));
  });

  it('desmarcado: só conclui, não chama o ready-for-qa', async () => {
    plans.completeStep.and.returnValue(of({} as any));
    c.move = false;
    await c.confirm();
    expect(plans.completeStep).toHaveBeenCalled();
    expect(devops.run).not.toHaveBeenCalled();
    expect(c.result()).toEqual({ completed: true, moveRequested: false, moved: false, error: null });
  });

  it('falha ao concluir: não tenta mover', async () => {
    plans.completeStep.and.returnValue(throwError(() => ({ error: { error: 'etapa já concluída' } })));
    await c.confirm();
    expect(devops.run).not.toHaveBeenCalled();
    expect(c.result()?.completed).toBeFalse();
    expect(c.result()?.error).toBe('etapa já concluída');
  });

  it('409 do DevOps: etapa concluída, mostra a regra não atendida e deixa tentar de novo', async () => {
    plans.completeStep.and.returnValue(of({} as any));
    devops.run.and.rejectWith({ status: 409, error: { error: 'O card não está em Dev Test in QA.' } });
    await c.confirm();
    f.detectChanges();
    const r = c.result()!;
    expect(r.completed).toBeTrue();
    expect(r.moved).toBeFalse();
    expect(r.error).toContain('regra não atendida');
    expect(r.error).toContain('O card não está em Dev Test in QA.');
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Tentar mover de novo');

    devops.run.and.resolveTo({ rev: 4, message: '' });
    await c.retryMove();
    expect(devops.run).toHaveBeenCalledTimes(2);
    expect(plans.completeStep).toHaveBeenCalledTimes(1);
    expect(c.result()?.moved).toBeTrue();
    expect(c.result()?.error).toBeNull();
  });
});
