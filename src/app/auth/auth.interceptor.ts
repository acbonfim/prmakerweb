import { StorageService } from '../services/storage.service';
import {inject, Injectable} from "@angular/core";
import { Observable } from "rxjs";
import { HttpClient, HttpHeaders, HttpRequest, HttpInterceptor, HttpHandler, HttpEvent } from '@angular/common/http';
import { Router } from "@angular/router";
import { tap } from "rxjs/internal/operators/tap";
import {MatSnackBar} from '@angular/material/snack-bar';
import {GlobalService} from '../services/global.service';

@Injectable({ providedIn: 'root' })

export class AuthInterceptor implements HttpInterceptor {
  constructor(
    private router: Router
    , private storageService: StorageService,
    private _globalService: GlobalService
  ) {

  }


  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if(this.router.url.includes('auth/')){
      let apiKey = this.storageService.getItem("apiKey");

      if (apiKey !== null) {
        const cloneReq = req.clone({
          headers: req.headers.set('x-api-key', `${apiKey}`)
        });
        return next.handle(cloneReq).pipe(
          tap(
            succ => { },
            err => {
              if (err.status === 401) {
                this._globalService.sendAlertError("Você não tem acesso ao serviço requisitado!", 'OK');
              }
            }
          )
        );

      }
    }
    var uriReq = req.url.split('//')[1].split('/')[0];
    if (
      uriReq === 'viacep.com.br'
      || uriReq === 'xtalk.ftc.br'
    ) {
      return next.handle(req.clone());
    } else {

      let token = this.storageService.getAccess().accessToken;

      if (token !== null) {
        const cloneReq = req.clone({
          headers: req.headers.set('Authorization', `Bearer ${token}`)
        });
        return next.handle(cloneReq).pipe(
          tap(
            succ => { },
            err => {
              if (err.status === 401) {
                this.storageService.cleanAccess();
                this.router.navigateByUrl('user/lockScreen');
              }
            }
          )
        );

      }
      else {
        return next.handle(req.clone());
      }
    }


  }
}
