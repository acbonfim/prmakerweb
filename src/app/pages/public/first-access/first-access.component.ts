import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../services/auth.service';
import { GlobalService } from '../../../services/global.service';

@Component({
  selector: 'app-first-access',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './first-access.component.html',
  styleUrls: ['./first-access.component.css']
})
export class FirstAccessComponent implements OnInit {
  username = signal('');
  code = signal('');
  mode = signal<'welcome' | 'reset'>('welcome');

  password = signal('');
  confirm = signal('');
  hide = signal(true);
  loading = signal(false);
  done = signal(false);

  validating = signal(true);
  codeValid = signal(false);
  invalidMsg = signal('');

  isWelcome = computed(() => this.mode() === 'welcome');

  // Regras alinhadas ao Identity do backend.
  rules = computed(() => {
    const p = this.password();
    return {
      length: p.length >= 8,
      lower: /[a-z]/.test(p),
      upper: /[A-Z]/.test(p),
      special: /[^a-zA-Z0-9]/.test(p)
    };
  });

  allRulesOk = computed(() => {
    const r = this.rules();
    return r.length && r.lower && r.upper && r.special;
  });

  canSubmit = computed(() =>
    this.allRulesOk() && !!this.confirm() && this.password() === this.confirm()
  );

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private _authService: AuthService,
    private _globalService: GlobalService
  ) {}

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap;
    this.username.set(q.get('username') || '');
    this.code.set(q.get('code') || '');
    this.mode.set(q.get('mode') === 'reset' ? 'reset' : 'welcome');

    if (!this.username() || !this.code()) {
      this.validating.set(false);
      this.invalidMsg.set('Link inválido. Solicite um novo e-mail de acesso.');
      return;
    }

    // Valida o código (existência + expiração) antes de exibir o formulário.
    this._authService.validateAccessCode(this.username(), this.code()).subscribe({
      next: () => {
        this.validating.set(false);
        this.codeValid.set(true);
      },
      error: (err) => {
        this.validating.set(false);
        this.invalidMsg.set(this.friendlyInvalid(err?.error?.message || err?.error?.Message));
      }
    });
  }

  private friendlyInvalid(msg: string): string {
    if (msg === 'Codigo expirado') return 'Este link expirou. Solicite um novo e-mail de acesso.';
    if (msg === 'Codigo não encontrado') return 'Este link já foi utilizado ou não é mais válido. Solicite um novo e-mail de acesso.';
    if (msg === 'Usuario não encontrado') return 'Usuário não encontrado para este link.';
    return msg || 'Este link é inválido ou expirou. Solicite um novo e-mail de acesso.';
  }

  submit(): void {
    if (!this.canSubmit()) return;

    if (!this.username() || !this.code()) {
      this._globalService.sendAlertError('Link inválido ou expirado. Solicite um novo e-mail.', 'OK');
      return;
    }

    this.loading.set(true);
    this._authService.setPasswordWithCode(this.username(), this.password(), this.code()).subscribe({
      next: () => {
        this.loading.set(false);
        this.done.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err?.error?.message || err?.error?.Message || 'Não foi possível definir a senha. O código pode ter expirado.';
        this._globalService.sendAlertError(msg, 'OK');
      }
    });
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }
}
