import { StorageService } from './storage.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { JwtHelperService } from '@auth0/angular-jwt';
import { map } from 'rxjs';
import { GlobalService } from './global.service';
import {environment} from '../../environments/environment';
import {AuthenticatedResponse} from '../interfaces/AuthenticatedResponse';
import {CreateUser} from '../interfaces/CreateUser';
import { login } from '../interfaces/login';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  baseUrl = environment.urlApiAuth;
  jwtHelper = new JwtHelperService();
  decodedToken: any;
  private refreshTimeout: any;

  constructor(
    private http: HttpClient
    ,private _storageService: StorageService
    , private _globalService: GlobalService
    ) { }

  public scheduleTokenRefresh() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    const refreshTime = 59 * 60 * 1000; // 59 minutos em milissegundos

    this.refreshTimeout = setTimeout(() => {
      this.tryRefreshingTokens().then(success => {
        if (success) {
          this._globalService.log("Token renovado automaticamente após 59 minutos.");
          this.scheduleTokenRefresh();
        }
      });
    }, refreshTime);
  }

  login(cred: any) {
    return this.http
      .post<login>(`${this.baseUrl}v2/oauth/login`, cred);
  }

  generateApiKey() {
    return this.http
      .get<any>(`${this.baseUrl}v2/integration/key/generate`, { headers: this.authHeaders() });
  }

  register(user: CreateUser) {
    return this.http
      .post<login>(`${this.baseUrl}user/Register`, user, { headers: this.authHeaders() });
  }

  updateUser(user: { id: number; fullName: string; email: string; departamento: string }) {
    return this.http
      .put<any>(`${this.baseUrl}user/Update`, user, { headers: this.authHeaders() });
  }

  updateUserRoles(userId: number, roles: string[]) {
    return this.http
      .put<any>(`${this.baseUrl}user/UpdateRoles`, { userId, roles }, { headers: this.authHeaders() });
  }

  activeToggle(userId: number, isActive: boolean) {
    let query = `userId=${userId}&isActive=${isActive}`;
    return this.http
      .patch<any>(`${this.baseUrl}user/ActiveToggle?${query}`, null, { headers: this.authHeaders() });
  }

  getAllRoles() {
    return this.http
      .get<any>(`${this.baseUrl}role/GetAll`, { headers: this.authHeaders() });
  }

  getAllUsers(page: number, itemsPerPage: number = 6, search: string = '') {
    let query = `page=${page}&itemsPerPage=${itemsPerPage}`;
    if (search && search.trim().length > 0) {
      query += `&search=${encodeURIComponent(search.trim())}`;
    }
    return this.http
      .post<any>(`${this.baseUrl}user/GetAll?${query}`, {}, { headers: this.authHeaders() });
  }

  // A API de autenticação usa esquema Bearer (JWT). Em rotas 'auth/*' o interceptor
  // injeta apenas x-api-key (esquema da API prform), então anexamos o Bearer aqui
  // explicitamente para autorizar nas chamadas ao serviço de autenticação.
  private authHeaders(): HttpHeaders {
    const access: any = this._storageService.getAccess();
    const token = access && access.accessToken ? access.accessToken : '';
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  public async tryRefreshingTokens(): Promise<boolean> {
    const access: any = this._storageService.getAccess();
    if (access === null) {
      return false;
    }

    const credentials = JSON.stringify({ accessToken: access.accessToken, refreshToken: access.refreshToken });
    let isRefreshSuccess: boolean;
    const refreshRes = await new Promise<any>((resolve, reject) => {
      this.http.post<AuthenticatedResponse>(`${this.baseUrl}user/RefreshToken`, credentials, {
        headers: new HttpHeaders({
          "Content-Type": "application/json"
        })
      }).subscribe({
        next: (res: AuthenticatedResponse) => resolve(res),
        error: (_) => { reject; isRefreshSuccess = false;}
      });
    });

    this._globalService.log(refreshRes,"REFRESH TOKEN_")

    access.accessToken = refreshRes.object.accessToken;
    access.refreshToken = refreshRes.object.refreshToken;

    this._storageService.cleanAccess();
    this._storageService.setAccess(access);

    isRefreshSuccess = true;
    return isRefreshSuccess;
  }

  public getAllowPagesByUser(userExternalI: string) : any[] {
    return [
      {page: "teste"}
      ,{page: "auth2"}
      ,{page: "teste"}
  ];
  }

  isAuthenticaded(): boolean {
    const access = this._storageService.getAccess();

    let accessToken = access.accessToken;
    let refreshToken = access.refreshToken;

    if (access === null || access === '') {
      return false;
    }

    if (refreshToken && this.jwtHelper.isTokenExpired(refreshToken)) {
      return false;
    }

    if (accessToken && this.jwtHelper.isTokenExpired(accessToken)) {
      return false;
    }

    return true;
  }
}
