import { Inject, Injectable } from '@angular/core';
import { identificadores } from '../helpers/identificadores';
import {GlobalService} from './global.service';

@Injectable({ providedIn: 'root' })
export class StorageService {


  constructor(
    private serviceGlobal: GlobalService
    ) {}

  cleanAccess() {
    const nameHash = identificadores.filter(e => e.name === "access")[0].hash;
    localStorage.removeItem(nameHash);
  }

  cleanItem(item: string) {
    localStorage.removeItem(item);
  }

  cleanToken() {
    localStorage.removeItem('token');
  }


  getAccess() {
    const nameHash = identificadores.filter(e => e.name === "access")[0].hash;
    const usuarioDecrypt = this.serviceGlobal.decrypt(
      this.serviceGlobal.isNull(localStorage.getItem(nameHash))
    );
    if (usuarioDecrypt === '') {
      return '';
    } else {
      return usuarioDecrypt;
    }
  }



  getAccessToken() {
    const nameHash = identificadores.filter(e => e.name === "access")[0].hash;
    const usuarioDecrypt = this.serviceGlobal.decrypt(
      this.serviceGlobal.isNull(localStorage.getItem(nameHash))
    );
    if (usuarioDecrypt === '') {
      return '';
    } else {
      return usuarioDecrypt.token;
    }
  }


  getError() {
    return localStorage.getItem('error');
  }

  getToken() {
    return localStorage.getItem('token');
  }

  logout() {
    this.cleanToken();
    this.cleanAccess();
  }

  setAccess(access: any) {
    const nameHash = identificadores.filter(e => e.name === "access")[0].hash;
    const accessCrypt = this.serviceGlobal.encrypt(access);
    localStorage.setItem(nameHash, accessCrypt);
  }

  setItem(nameItem: string, value: any){
    const nameHash = identificadores.filter(e => e.name === nameItem)[0].hash;
    const itemCrypt = this.serviceGlobal.encrypt(value);
    localStorage.setItem(nameHash, itemCrypt);
  }

  getItem(nameItem: string){
    const nameHash = identificadores.filter(e => e.name === nameItem)[0].hash;
    let item = localStorage.getItem(nameHash);
    return this.serviceGlobal.decrypt(item);
  }

  setToken(token: any) {
    localStorage.setItem('token', token);
  }

  setUsuarioLocal(currentUser: any) {
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
  }


}
