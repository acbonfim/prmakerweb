import {Component, HostListener, signal, type OnInit} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { ForgotPasswordDialogComponent } from './forgot-password-dialog.component';
import {MatFormFieldControl, MatFormFieldModule} from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GlobalService } from '../../services/global.service';
import { AuthService } from '../../services/auth.service';
import { StorageService } from '../../services/storage.service';
import { WsService } from '../../services/ws.service';
import {JwtHelperService} from '@auth0/angular-jwt';
import { login } from '../../interfaces/login';
import {MatSliderModule} from '@angular/material/slider';
import {MatSlideToggleModule} from '@angular/material/slide-toggle';
import {MatButtonModule} from '@angular/material/button';
import {MatInputModule} from '@angular/material/input';
import {JsonPipe} from '@angular/common';

@Component({
    selector: 'login-login',
    templateUrl: './login.html',
    styleUrl: './login.scss',
    standalone: true,
  imports: [
    MatCardModule,
    MatFormFieldModule,
    FormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSliderModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatDialogModule,

  ],
})
export class Login implements OnInit {

    isDesktop = false;
    hide = true;
    load = signal(false);
    jwtHelper = new JwtHelperService();

    creds: login | undefined = {
      username: '',
      password: ''
    };

    salvarLogin = false;

    constructor(
        private _globalService: GlobalService
        , private _authService: AuthService
        , private _storageService: StorageService,
        private _wsService: WsService,
        public dialog: MatDialog
    ) {

    }

    openForgotPassword() {
        this.dialog.open(ForgotPasswordDialogComponent, {
            width: '420px',
            data: { userName: this.creds?.username || '' }
        });
    }

    ngOnInit(): void {
        this.getLoginCreds();
        this.getAccess();

        const token = this._storageService.getAccess().accessToken;

      if (token && !this.jwtHelper.isTokenExpired(token)) {
        this._authService.scheduleTokenRefresh();
      }

        console.log("exp", this.jwtHelper.isTokenExpired(token))
    }

  @HostListener('window:resize')
  onResize() {
    this.isDesktop = this._globalService.isDesktop();
    }

    login() {
        if (this.creds) {

        this.load.set(true);

        this._authService.login(this.creds).subscribe(
            (_retorno: any) => {
            this.load.set(false);
            this._globalService.log(_retorno, "LOGUEI")
            if (_retorno.success) {
                this._storageService.setAccess(_retorno.object);

              this._authService.scheduleTokenRefresh();

                this._authService.generateApiKey().subscribe(
                  (retApiKey: any) => {
                    this._storageService.setItem("apiKey", retApiKey.object.apiKey);

                    this._globalService.navigateTo('/auth/dashboard');
                    this._wsService.startConnection();
                    this._globalService.sendAlert(_retorno.message, 'Ok');

                    if (this.salvarLogin) {
                      this._storageService.setItem("loginAccess", this.creds);
                    } else {
                      this.clearAccess()
                    }

                  }, error => {

                  });



            }
            }, error => {
            this.load.set(false);
            this._globalService.sendAlertError(this.getLoginErrorMessage(error), 'OK');
            }
        );
        }

    }

  // Traduz o erro do backend para uma mensagem clara do motivo da falha de login.
  private getLoginErrorMessage(error: any): string {
    const backend = error?.error?.message || error?.error?.Message || '';
    const status = error?.status;

    const map: { [key: string]: string } = {
      'Usuario não encontrado': 'Usuário não encontrado. Verifique o nome de usuário/e-mail digitado.',
      'Senha incorreta': 'Senha incorreta. Verifique e tente novamente.',
      'Usuario desativado': 'Este usuário está desativado. Procure um administrador.',
      'E-mail não confirmado!': 'Você ainda não confirmou seu e-mail. Use o link de primeiro acesso enviado à sua caixa de entrada.'
    };

    if (backend && map[backend]) return map[backend];
    if (backend) return backend;

    if (status === 0) return 'Não foi possível conectar ao servidor de autenticação. Tente novamente.';
    if (status === 401) return 'Senha incorreta. Verifique e tente novamente.';
    if (status === 404) return 'Usuário não encontrado. Verifique o nome de usuário/e-mail digitado.';
    if (status === 403) return 'Acesso negado. Usuário desativado ou e-mail não confirmado.';

    return 'Não foi possível fazer login. Tente novamente.';
  }

  getLoginCreds() {
    let cred = this._storageService.getItem("loginAccess");
    if (cred !== null && typeof cred === 'object') {
      this.creds = cred;
      this.salvarLogin = true;
    } else {
      this.creds = {
        username: '',
        password: ''
      };
    }
  }

    getAccess() {
        this._globalService.log(this._storageService.getAccess(), "ACCESS_")
    }

    clearAccess() {
        if (this.salvarLogin) {
        this.creds = {
            username: '',
            password: ''
        };
        this._storageService.cleanItem("loginAccess");
        }
    }

    async refresh() {

        return await this._authService.tryRefreshingTokens();
    }

}
