import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { StorageService } from './storage.service';

export interface ServiceItem {
  externalId?: string;  // string grande; é o identificador usado nas operações da API
  name: string;
  description: string;
  isActive?: boolean;
}

// CRUD de serviços na API de autenticação (Cime.Auth).
// A API usa esquema Bearer (JWT); em rotas 'auth/*' o interceptor injeta apenas
// x-api-key, então anexamos o Authorization: Bearer aqui explicitamente.
@Injectable({ providedIn: 'root' })
export class AuthServicesService {

  private baseUrl = environment.urlApiAuth;

  constructor(
    private http: HttpClient,
    private _storageService: StorageService
  ) {}

  getAll() {
    return this.http.get<any>(`${this.baseUrl}Service/GetAll`, { headers: this.authHeaders() });
  }

  getAllByUserId(userId: number) {
    return this.http.get<any>(`${this.baseUrl}Service/GetAllByUserId?userId=${userId}`, { headers: this.authHeaders() });
  }

  create(service: ServiceItem) {
    return this.http.post<any>(`${this.baseUrl}Service/Create`, service, { headers: this.authHeaders() });
  }

  update(service: ServiceItem) {
    return this.http.put<any>(`${this.baseUrl}Service/Update`, service, { headers: this.authHeaders() });
  }

  delete(externalId: string) {
    return this.http.delete<any>(`${this.baseUrl}Service/Delete?id=${encodeURIComponent(externalId)}`, { headers: this.authHeaders() });
  }

  addUserToService(userId: number, serviceExternalId: string) {
    const query = `userId=${userId}&serviceId=${encodeURIComponent(serviceExternalId)}`;
    return this.http.post<any>(`${this.baseUrl}Service/AddUserToService?${query}`, {}, { headers: this.authHeaders() });
  }

  removeUserFromService(userId: number, serviceExternalId: string) {
    const query = `userId=${userId}&serviceId=${encodeURIComponent(serviceExternalId)}`;
    return this.http.delete<any>(`${this.baseUrl}Service/RemoveUserFromService?${query}`, { headers: this.authHeaders() });
  }

  private authHeaders(): HttpHeaders {
    const access: any = this._storageService.getAccess();
    const token = access && access.accessToken ? access.accessToken : '';
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
