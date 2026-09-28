import { Component, inject, signal } from '@angular/core';
import {RouterModule, RouterOutlet} from '@angular/router';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {PageContainerComponent} from './components/page-container/page-container.component';
import {PwaService} from './services/pwa.service';

@Component({
  selector: 'app-root',
  imports: [  RouterModule, MatButtonModule, MatIconModule],
  standalone: true,
  template: `
    <router-outlet></router-outlet>
    @if (pwa.notice(); as notice) {
      <!-- Aviso de versão nova (feature 0019): só some pelo botão; nunca recarrega sozinho. -->
      <div class="pwa-notice" role="status" aria-live="polite">
        <mat-icon>system_update_alt</mat-icon>
        <span>{{ notice === 'update' ? 'Nova versão do PRMake disponível.' : 'O PRMake precisa ser recarregado.' }}</span>
        <button mat-flat-button color="primary" (click)="pwa.reload()">
          {{ notice === 'update' ? 'Atualizar' : 'Recarregar' }}
        </button>
      </div>
    }
  `,
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('prform-app');
  protected readonly pwa = inject(PwaService);

  constructor() {
    this.pwa.start();
  }
}
