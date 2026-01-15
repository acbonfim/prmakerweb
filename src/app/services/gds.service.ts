import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { StorageService } from './storage.service';
import { GlobalService } from './global.service';
import { PluginData } from '../interfaces/Plugin';
import {environment} from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class GdsService {

  baseUrl = environment.apiUrl;

  constructor(
    private http: HttpClient
    ,private _storageService: StorageService
    , private _globalService: GlobalService
    ) {}



  getAllPluginConfiguration() {
    return this.http
      .get<PluginData>(`${this.baseUrl}PluginConfiguration/get-all`);
  }

  getAllPlugin() {
    return this.http
      .get<PluginData>(`${this.baseUrl}/Plugin/AllPlugins`);
  }

  getAllById(id: number) {
    return this.http
      .get<PluginData>(`${this.baseUrl}PluginConfiguration/get-all-by-id?id=${id}`);
  }

  postCreatePluginConfiguration(plugin: any) {
    return this.http
      .post<any>(`${this.baseUrl}PluginConfiguration`, plugin);
  }

  putUpdatePluginConfiguration(plugin: any) {
    return this.http
      .put<PluginData>(`${this.baseUrl}PluginConfiguration/update-configuration/${plugin.id}`, plugin);
  }

  deletePlugin(id: number) {
    return this.http
      .delete<PluginData>(`${this.baseUrl}PluginConfiguration/delete/${id}`);
  }




}
