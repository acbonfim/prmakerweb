import { JwtHelperService } from '@auth0/angular-jwt';
import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import {StorageService} from '../services/storage.service';
import {GlobalService} from '../services/global.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard  {

  jwtHelper = new JwtHelperService();

  constructor(
    private router: Router
    , private _storageService: StorageService
    , private _globalService: GlobalService
    , private _authService: AuthService
  ) {

  }



  async canActivate(

    activated: ActivatedRouteSnapshot
  ): Promise<boolean> {
    let page = activated.url[0]?.path;

    let accessToken = this._storageService.getAccess().accessToken;
    let refreshToken = this._storageService.getAccess().refreshToken;
    let isRefreshSuccess = false;

    if (refreshToken && this.jwtHelper.isTokenExpired(refreshToken)) {
      this.router.navigate(['/login']);
      this._storageService.cleanAccess();
      this._globalService.sendAlert("Sessão encerrada. Faça login novamente", "OK")
      return false;
    }

    if (accessToken && this.jwtHelper.isTokenExpired(accessToken)) {
      this._globalService.log("TOKEN EXPIRADO")
      isRefreshSuccess = await this._authService.tryRefreshingTokens();

      if (isRefreshSuccess) {
        accessToken = this._storageService.getAccess().accessToken;
        refreshToken = this._storageService.getAccess().refreshToken;
      }
    }

    if (!accessToken || this.jwtHelper.isTokenExpired(accessToken)) {
      this._storageService.cleanAccess();
      this.router.navigate(['/login']);
      this._globalService.sendAlert("Sessão encerrada. Faça login novamente", "OK")
      return false;
    }

    // if (page !== null && page !== undefined) {

    //   let allowPages = await this._authService.getAllowPagesByUser("idUser");
    //   let cont = 0;

    //   allowPages.forEach(function (x) : any {
    //     if (x.page === page) {
    //       cont++
    //     }
    //   });

    //   if(cont == 0) {
    //     this._globalService.navigateTo("auth");
    //     this._globalService.sendAlertError("Você não possui acesso a essa página.","OK")
    //     return false;

    //   }
    // }

    return true;
  }



}

export class VerificarPermissoes {
  public static temPermissao(roles: string[], permissoesDoUsuario: string[]): boolean {
    for (let role of roles) {
      if (permissoesDoUsuario.includes(role)) {
        return true;
      }
    }
    return false;
  }
}
