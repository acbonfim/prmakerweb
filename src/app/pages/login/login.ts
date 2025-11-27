import {Component, HostListener, type OnInit} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
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

  ],
})
export class Login implements OnInit {

    isDesktop = false;
    hide = true;
    load = false;
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
        private _wsService: WsService
    ) {

    }

    ngOnInit(): void {
        this.getLoginCreds();
        this.getAccess();

        const token = this._storageService.getAccess().accessToken;

        console.log("exp", this.jwtHelper.isTokenExpired(token))
    }

  @HostListener('window:resize')
  onResize() {
    this.isDesktop = this._globalService.isDesktop();
    }

    login() {
        if (this.creds) {

        this.load = true;

        this._authService.login(this.creds).subscribe(
            (_retorno: any) => {
            this.load = false;
            this._globalService.log(_retorno, "LOGUEI")
            if (_retorno.success) {
                this._storageService.setAccess(_retorno.object);

                this._authService.generateApiKey().subscribe(
                  (retApiKey: any) => {
                    this._storageService.setItem("apiKey", retApiKey.object.apiKey);

                    this._globalService.navigateTo('/auth/register');
                    //this._wsService.startConnection();
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
            this.load = false;
            console.log("aqui", error.error);
            if (error.error.message === "E-mail não confirmado!") {
                this._globalService.sendAlertError("Você precisa confirmar o email para liberar o primeiro acesso!", 'OK');
            } else {
                this._globalService.sendAlertError(error.message, 'OK');
            }


            }
        );
        }

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

        const isRefreshSuccess = await this._authService.tryRefreshingTokens();
        console.log(isRefreshSuccess)
    }

}
