import { EventEmitter, Injectable } from '@angular/core';

import { HttpClient } from '@angular/common/http';
import { NavigationExtras, Router } from '@angular/router';
import { MatSnackBar, MatSnackBarHorizontalPosition, MatSnackBarVerticalPosition } from '@angular/material/snack-bar';
import {CliipboardService} from './cliipboard.service';
import {environment} from '../../environments/environment';
import * as CryptoJS from 'crypto-js';



@Injectable({ providedIn: 'root' })
export class GlobalService {

  sideNavToggle = new EventEmitter<any>();
  horizontalPosition: MatSnackBarHorizontalPosition = 'end';
  verticalPosition: MatSnackBarVerticalPosition = 'top';

  constructor(
    private http: HttpClient
    , private router: Router
    , private _snackBar: MatSnackBar
    , private _clipboardService: CliipboardService
  ) { }

  public _sideNavToggle(status: any) {
    this.sideNavToggle.emit(status);
  }

  copyToClipBoard(text: string) {
    this._clipboardService.copyFullDescriptionToClipboard(text)
    this.sendAlert(`Copiado para aréa de trasnferência`, 'OK');
  }

  public navigateTo(route: string, redirectTo?: string) {

    if(redirectTo !== null || redirectTo !== ''){
      const queryParams: NavigationExtras = {
        queryParams: { redirectTo: redirectTo }
      };
      this.router.navigate([route], queryParams);
    }else {
      this.router.navigate([route]);
    }

  }

  public navigateToByUrl(route: any, extras?: any) {
    this.router.navigateByUrl(route, extras);
  }

  public log(msg: any, name?: string) {
    if (!environment.production) {
      console.log(name,msg)
    }
  }

  public sendAlertError(message: string, action?: string) {

    this._snackBar.open(message,action, {
      duration: 8000,
      horizontalPosition: this.horizontalPosition,
      verticalPosition: this.verticalPosition,
      panelClass: "snack-error"
    });

  }

  public sendAlert(message: string, action?: string) {

    this._snackBar.open(message,action, {
      duration: 8000,
      horizontalPosition: this.horizontalPosition,
      verticalPosition: this.verticalPosition
    });

  }


  public decrypt(data: any) {
    try {
      const bytes = CryptoJS.AES.decrypt(data, environment.secretKey);
      if (bytes.toString()) {
        return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
      }
      return data;
    } catch (error) {
      return data;
    }
  }

  public encrypt(data: any) {
    try {
      return CryptoJS.AES.encrypt(
        JSON.stringify(data),
        environment.secretKey
      ).toString();
    } catch (error) {
      return data;
    }
  }

  public base64Encode(valor: string) {
    return btoa(unescape(encodeURIComponent(valor)));
  }

  public base64Decode(valor: any) {
    return decodeURIComponent(escape(atob(valor)));
  }

  public getIPAddress() {
    return this.http.get('http://ip-api.com/json');
  }

  public isDesktop() {
    return window.innerWidth >= 600;
  }

  public isNull(data: any) {
    if (data) {
      return data;
    } else {
      return '';
    }
  }

}
