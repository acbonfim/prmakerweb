import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { GlobalService } from '../../services/global.service';

/**
 * "Minha API Key" (feature 0008): o próprio usuário gera a chave pessoal (x-api-key) para
 * integrar com a API (skills, scripts). A chave não expira e gerar outra não invalida as
 * anteriores; desativar o usuário bloqueia todas (checagem de usuário ativo a cada request).
 */
@Component({
  selector: 'app-my-api-key-dialog',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './my-api-key-dialog.component.html',
  styleUrls: ['./my-api-key-dialog.component.css'],
})
export class MyApiKeyDialogComponent {
  private authService = inject(AuthService);
  private globalService = inject(GlobalService);
  readonly dialogRef = inject(MatDialogRef<MyApiKeyDialogComponent>);

  readonly apiUrl = environment.apiUrl;

  readonly apiKey = signal<string | null>(null);
  readonly roles = signal<string[]>([]);
  readonly generating = signal(false);
  readonly error = signal<string | null>(null);
  readonly reveal = signal(false);

  readonly maskedKey = computed(() => {
    const key = this.apiKey();
    return key ? `${key.slice(0, 12)}${'•'.repeat(24)}${key.slice(-6)}` : '';
  });

  readonly curlExample = computed(() =>
    `curl -H "x-api-key: ${this.apiKey() ?? '<sua-api-key>'}" "${this.apiUrl}PullRequest/GetByCardNumber?cardNumber=12345"`);

  generate(): void {
    if (this.generating()) return;
    this.generating.set(true);
    this.error.set(null);
    this.authService.generateApiKey().subscribe({
      next: (res: any) => {
        this.generating.set(false);
        const data = res?.object ?? res?.Object ?? {};
        const key = data.apiKey ?? data.ApiKey;
        if (!key) {
          this.error.set('Não foi possível gerar a API Key. Tente novamente.');
          return;
        }
        this.apiKey.set(key);
        this.roles.set(data.roles ?? []);
        this.reveal.set(false);
      },
      error: (err) => {
        this.generating.set(false);
        this.error.set(err?.error?.message || err?.error?.Message || 'Não foi possível gerar a API Key. Tente novamente.');
      }
    });
  }

  copyKey(): void {
    const key = this.apiKey();
    if (key) this.globalService.copyToClipBoard(key);
  }

  copyExample(): void {
    this.globalService.copyToClipBoard(this.curlExample());
  }

  close(): void {
    this.dialogRef.close();
  }
}
