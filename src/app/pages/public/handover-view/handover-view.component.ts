import { ChangeDetectorRef, Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { marked } from 'marked';
import { SafeHtmlPipe } from 'primeng/menu';
import { environment } from '../../../../environments/environment';

/**
 * Visualização PÚBLICA e SOMENTE LEITURA da passagem de conhecimento (handover) de um card.
 *
 * Acessível por qualquer pessoa com o link, sem autenticação, pela URL `/handover/{numeroDoCard}`.
 * Reaproveita a renderização do modal de handover, mas sem botões e sem qualquer ação que
 * altere o sistema. Fica fora do layout autenticado (PageContainer), portanto é exibida em
 * tela cheia, sem menus laterais e sem topbar.
 */
@Component({
  selector: 'app-handover-view',
  standalone: true,
  templateUrl: './handover-view.component.html',
  styleUrl: './handover-view.component.css',
  imports: [CommonModule, SafeHtmlPipe],
})
export class HandoverViewComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);

  private urlBase = environment.apiUrl;

  cardNumber = signal<string>('');
  loading = signal(true);
  contentHtml = signal<string>('');
  generatedAt = signal<string | null>(null);
  notPublic = signal(false); // handover existe, mas não está liberado publicamente

  get hasHandover(): boolean {
    return !!this.contentHtml();
  }

  ngOnInit() {
    marked.setOptions({ gfm: true, breaks: true });
    const card = this.route.snapshot.paramMap.get('cardNumber') ?? '';
    this.cardNumber.set(card);
    this.load(card);
  }

  private load(cardNumber: string) {
    if (!cardNumber) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.http
      .get<any>(`${this.urlBase}Handover/public/${encodeURIComponent(cardNumber)}`)
      .subscribe({
        next: (res) => {
          if (res && res.content) {
            this.contentHtml.set(marked.parse(res.content) as string);
            this.generatedAt.set(res.updatedAt || res.createdAt || null);
          }
          this.loading.set(false);
          this.cdr.detectChanges();
        },
        error: (err) => {
          // 403: existe, mas não é público → apenas autenticados têm acesso.
          if (err?.status === 403) {
            this.notPublic.set(true);
          }
          this.loading.set(false);
          this.cdr.detectChanges();
        },
      });
  }
}
