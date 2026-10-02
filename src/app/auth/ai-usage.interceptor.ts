import { Injectable, Injector } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest, HttpResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, tap } from 'rxjs';
import { formatTokens, formatUsd, parseAiUsageHeader } from '../services/ai-usage.service';
import { AiUsageDialogComponent } from '../components/ai-usage-dialog/ai-usage-dialog.component';

/**
 * Consumo de IA por ação (0042): resposta com o cabeçalho X-AI-Usage → aviso discreto com os tokens e o custo
 * estimado ("IA: 12,8 mil tokens · ≈ US$ 0,0056"). A IA roda com a chave de API do perfil — o custo é de quem clicou.
 */
@Injectable({ providedIn: 'root' })
export class AiUsageInterceptor implements HttpInterceptor {
  // Injector: o diálogo usa serviços com HttpClient, que depende deste interceptor.
  constructor(private injector: Injector) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      tap((event) => {
        if (!(event instanceof HttpResponse)) return;
        const usage = parseAiUsageHeader(event.headers.get('X-AI-Usage'));
        if (usage) this.notify(usage.input, usage.output, usage.cost, usage.model, usage.calls);
      })
    );
  }

  private notify(input: number, output: number, cost: number | null, model: string, calls: number): void {
    const price = cost == null ? 'custo não estimado' : `≈ ${formatUsd(cost)}`;
    const many = calls > 1 ? ` em ${calls} chamadas` : '';
    // 0044: entrada, saída e total em tokens (a gente mede em token).
    const ref = this.injector.get(MatSnackBar).open(
      `IA${many}: entrada ${formatTokens(input)} · saída ${formatTokens(output)} · total ${formatTokens(input + output)} tokens · ${price}${model ? ` (${model})` : ''}`, 'Detalhes',
      { horizontalPosition: 'right', verticalPosition: 'bottom', duration: 7000 });
    ref.onAction().subscribe(() => this.injector.get(MatDialog).open(AiUsageDialogComponent, {
      width: '820px', maxWidth: '96vw', maxHeight: '92vh', panelClass: 'custom-dialog-container', autoFocus: false
    }));
  }
}
