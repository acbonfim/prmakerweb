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

  getAllByExcludeUserId(userId: number) {
    return this.http
      .get<PluginData>(`${this.baseUrl}/PluginConfiguration/getAllByExcludeUserId?userId=${userId}`);
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

  postCreateUserPlugin(plugin: any) {
    return this.http
      .post<any>(`${this.baseUrl}/UserPlugin/Create`, plugin);
  }

  getAllUsersPlugins(page: number) {
    let paginationQuery = `page=${page}&itemsPerPage=6`;
    let includesQuery = `includePlugins=true&includeRoles=false`;
    return this.http
      .get<any>(`${this.baseUrl}/UserPlugin/GetAllUser?${paginationQuery}&${includesQuery}`);
  }

  getAllUsers(page: number) {
    let paginationQuery = `page=${page}&itemsPerPage=6`;
    let includesQuery = `includePlugins=false&includeRoles=true`;
    return this.http
      .get<any>(`${this.baseUrl}/UserPlugin/GetAllUser?${paginationQuery}&${includesQuery}`);
  }

  getAllUsersByUserName(userName: string,page: number) {
    let paginationQuery = `page=${page}&itemsPerPage=6`;
    let includesQuery = `includePlugins=false&includeRoles=true`;
    return this.http
      .get<any>(`${this.baseUrl}/UserPlugin/GetAllUserByUserName?userName=${userName}&${paginationQuery}&${includesQuery}`);
  }

  getAllUsersPluginsByUserName(userName: string,page: number) {
    let paginationQuery = `page=${page}&itemsPerPage=6`;
    let includesQuery = `includePlugins=true&includeRoles=false`;
    return this.http
      .get<any>(`${this.baseUrl}/UserPlugin/GetAllUserByUserName?userName=${userName}&${paginationQuery}&${includesQuery}`);
  }




  getAllPaymentServices() {
    return this.http
      .get<any>(`${this.baseUrl}/PaymentService/GetAll`);
  }



  postCreatePaymentServices(plugin: any) {
    return this.http
      .post<any>(`${this.baseUrl}/PaymentService/Create`, plugin);
  }






  getAllShoppingCartServices() {
    return this.http
      .get<any>(`${this.baseUrl}/ShoppingCart/GetAll`);
  }



  getAllCityPendingAssociation(page: number, pluginId: string, cityName: string = "") {
    let paginationQuery = `page=${page}&itemsPerPage=10`;
    let filterQuery = `pluginId=${pluginId}`;
    if(cityName){
      filterQuery = filterQuery + `&cityName=${cityName}`;
    }
    return this.http
      .get<any>(`${this.baseUrl}/City/GetCityAssociationPending?${paginationQuery}&${filterQuery}`);
  }

  getAllCities(page: number) {
    let paginationQuery = `page=${page}&itemsPerPage=10`;
    return this.http
      .get<any>(`${this.baseUrl}/City/GetAllCities?${paginationQuery}`);
  }

  getAllCitiesByName(page: number, name: string, includeStations: boolean = false) {
    let paginationQuery = `page=${page}&itemsPerPage=100`;
    let filterQuery = `name=${name}`;
    if(includeStations){
      filterQuery += `&includeStations=${includeStations}`;
    }
    return this.http
      .get<any>(`${this.baseUrl}/City/GetAllCitiesByName?${paginationQuery}&${filterQuery}`);
  }

  getACityById(id: string, includeStations: boolean = false) {
    let filterQuery = `id=${id}`;
    if(includeStations){
      filterQuery += `&includeStations=${includeStations}`;
    }
    return this.http
      .get<any>(`${this.baseUrl}/City/GetAllCitiesByName?${filterQuery}`);
  }

  getAllStationsByName(page: number, name: string, cityIdExclude: string = '') {
    let paginationQuery = `page=${page}&itemsPerPage=100`;
    let filterQuery = `name=${name}`;
    if(cityIdExclude){
      filterQuery += `&cityIdExclude=${cityIdExclude}`;
    }
    return this.http
      .get<any>(`${this.baseUrl}/City/GetAllStationsByName?${paginationQuery}&${filterQuery}`);
  }

  getAllStationsByCityId(page: number, cityId: string) {
    let paginationQuery = `page=${page}&itemsPerPage=100`;
    let filterQuery = `cityId=${cityId}`;
    return this.http
      .get<any>(`${this.baseUrl}/City/GetAllStationsByCityId?${paginationQuery}&${filterQuery}`);
  }

  GetStationCityAssociation(cityId: string, pluginId: string) {
    let filterQuery = `cityId=${cityId}&pluginId=${pluginId}`;
    return this.http
      .get<any>(`${this.baseUrl}/City/GetStationCityAssociation?${filterQuery}`);
  }

  postCreateStation(model: any) {
    return this.http
      .post<any>(`${this.baseUrl}/City/CreateStation`, model);
  }

  postCreateCity(model: any) {
    return this.http
      .post<any>(`${this.baseUrl}/City/Create`, model);
  }

  putUpdateStation(model: any) {
    return this.http
      .put<any>(`${this.baseUrl}/City/UpdateStation`, model);
  }

  putUpdateCity(model: any) {
    return this.http
      .put<any>(`${this.baseUrl}/City/UpdateCity`, model);
  }



}
