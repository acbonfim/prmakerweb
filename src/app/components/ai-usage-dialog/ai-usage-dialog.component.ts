import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StorageService } from '../../services/storage.service';
import { AiUsageService, AiUsageSummary, AiUsageTotals, formatTokens, formatUsd } from '../../services/ai-usage.service';

/**
 * "Meu consumo de IA" (0042): tokens e custo estimado de cada ação de IA do PRMake. A IA roda com a chave de API do
 * perfil de quem usa, então o custo é dele. Admin alterna para "Todos" (total por usuário).
 */
@Component({
  selector: 'app-ai-usage-dialog',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatButtonToggleModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './ai-usage-dialog.component.html',
  styleUrls: ['./ai-usage-dialog.component.css'],
})
export class AiUsageDialogComponent implements OnInit {
  private service = inject(AiUsageService);
  private storage = inject(StorageService);
  readonly dialogRef = inject(MatDialogRef<AiUsageDialogComponent>);

  readonly isAdmin = this.readIsAdmin();
  readonly days = signal(30);
  readonly scope = signal<'me' | 'all'>('me');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<AiUsageSummary | null>(null);

  readonly tokens = formatTokens;
  readonly usd = formatUsd;

  /** Barras do gráfico por dia: altura relativa ao dia de maior custo (ou de mais tokens, sem preço). */
  readonly bars = computed(() => {
    const days = this.data()?.byDay ?? [];
    const byCost = days.some(d => d.totals.costUsd > 0);
    const value = (t: AiUsageTotals) => (byCost ? t.costUsd : t.inputTokens + t.outputTokens);
    const max = Math.max(...days.map(d => value(d.totals)), 0);
    return days.map(d => ({ day: d.day, totals: d.totals, pct: max ? Math.max(4, (value(d.totals) / max) * 100) : 0 }));
  });

  readonly average = computed(() => {
    const t = this.data()?.total;
    return t && t.calls ? t.costUsd / Math.max(1, t.calls - t.unpriced) : null;
  });

  ngOnInit(): void {
    void this.load();
  }

  setDays(days: number): void {
    this.days.set(days);
    void this.load();
  }

  setScope(scope: 'me' | 'all'): void {
    this.scope.set(scope);
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.data.set(this.scope() === 'all' ? await this.service.all(this.days()) : await this.service.mine(this.days()));
    } catch (err: any) {
      this.error.set(err?.status === 403 ? 'Seu login não identifica o usuário (entre de novo para ver o consumo).'
        : 'Não foi possível carregar o consumo de IA.');
    } finally {
      this.loading.set(false);
    }
  }

  totalTokens(t: AiUsageTotals): string {
    return formatTokens(t.inputTokens + t.outputTokens);
  }

  close(): void {
    this.dialogRef.close();
  }

  private readIsAdmin(): boolean {
    try {
      const token = this.storage.getItem('apiKey');
      if (!token) return false;
      const payload = JSON.parse(atob(token.split('.')[1]));
      const raw = payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] ?? payload['role'];
      return (Array.isArray(raw) ? raw : raw ? [raw] : []).includes('admin');
    } catch {
      return false;
    }
  }
}
