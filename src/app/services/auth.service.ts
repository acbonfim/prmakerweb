import { StorageService } from './storage.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { JwtHelperService } from '@auth0/angular-jwt';
import { firstValueFrom, map, timeout } from 'rxjs';
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

  /** Refresh em andamento (0022): chamadas simultâneas (guard, login, timer) reaproveitam o mesmo. */
  private refreshInFlight: Promise<boolean> | null = null;
  /** true enquanto o token está sendo renovado — a troca de tela mostra "Renovando sessão…". */
  readonly refreshing = signal(false);
  private static readonly REFRESH_TIMEOUT_MS = 15000;

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

  // Salva a URL da foto (Cloudinary) no usuário autenticado.
  updatePhoto(imageUrl: string) {
    return this.http
      .post<any>(`${this.baseUrl}user/UpdatePhoto`, { imageUrl }, { headers: this.authHeaders() });
  }

  // Fotos/nomes por externalId (para avatares na timeline). Endpoint anônimo.
  getPhotosByExternalIds(externalIds: string[]) {
    return this.http
      .post<any>(`${this.baseUrl}user/PhotosByExternalIds`, externalIds);
  }

  // Troca da própria senha (usuário autenticado, informa a senha atual).
  changePassword(currentPassword: string, newPassword: string) {
    return this.http
      .post<any>(`${this.baseUrl}user/ChangePassword`, { currentPassword, newPassword }, { headers: this.authHeaders() });
  }

  // Valida se o código de acesso existe e não expirou (antes de exibir o formulário).
  validateAccessCode(userName: string, code: string) {
    return this.http
      .get<any>(`${this.baseUrl}Password/ValidateCode?userName=${encodeURIComponent(userName)}&code=${encodeURIComponent(code)}`);
  }

  // Define senha via código (primeiro acesso / redefinição) — endpoint anônimo.
  setPasswordWithCode(userName: string, password: string, code: string) {
    return this.http
      .post<any>(`${this.baseUrl}Password/UpdatePassword?code=${encodeURIComponent(code)}`, { userName, password });
  }

  // Reenvia e-mail de boas-vindas / primeiro acesso (gestão).
  sendWelcomeEmail(userName: string) {
    return this.http
      .get<any>(`${this.baseUrl}Password/SendWelcomeByUsername?userName=${encodeURIComponent(userName)}`, { headers: this.authHeaders() });
  }

  // Dispara e-mail de redefinição de senha (gestão).
  sendResetPasswordEmail(userName: string) {
    return this.http
      .get<any>(`${this.baseUrl}Password/GenerateForgetCodeByUsername?userName=${encodeURIComponent(userName)}`, { headers: this.authHeaders() });
  }

  // "Esqueci minha senha" na tela de login (público, sem token).
  forgotPassword(userName: string) {
    return this.http
      .get<any>(`${this.baseUrl}Password/GenerateForgetCodeByUsername?userName=${encodeURIComponent(userName)}`);
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

  getAllUsers(page: number, itemsPerPage: number = 10, search: string = '') {
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

  /**
   * Renova os tokens. Sempre termina com true/false (0022): antes, com erro no refresh a promise
   * nunca resolvia e o AuthGuard deixava a navegação presa, sem aviso. Com false, o guard limpa a
   * sessão e manda para o login.
   */
  public tryRefreshingTokens(): Promise<boolean> {
    if (!this.refreshInFlight) {
      this.refreshing.set(true);
      this.refreshInFlight = this.refreshTokens().finally(() => {
        this.refreshInFlight = null;
        this.refreshing.set(false);
      });
    }
    return this.refreshInFlight;
  }

  private async refreshTokens(): Promise<boolean> {
    const access: any = this._storageService.getAccess();
    if (!access?.accessToken || !access?.refreshToken) {
      return false;
    }

    const credentials = JSON.stringify({ accessToken: access.accessToken, refreshToken: access.refreshToken });
    try {
      const refreshRes: any = await firstValueFrom(
        this.http.post<AuthenticatedResponse>(`${this.baseUrl}user/RefreshToken`, credentials, {
          headers: new HttpHeaders({
            "Content-Type": "application/json"
          })
        }).pipe(timeout(AuthService.REFRESH_TIMEOUT_MS))
      );

      this._globalService.log(refreshRes,"REFRESH TOKEN_")

      const tokens = refreshRes?.object;
      if (!tokens?.accessToken || !tokens?.refreshToken) {
        return false;
      }

      access.accessToken = tokens.accessToken;
      access.refreshToken = tokens.refreshToken;

      this._storageService.cleanAccess();
      this._storageService.setAccess(access);
      return true;
    } catch (error) {
      console.warn('Falha ao renovar o token', error);
      return false;
    }
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
