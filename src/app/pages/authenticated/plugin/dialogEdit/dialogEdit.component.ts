import { Component, Inject, OnInit } from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import { FormBuilder, FormGroup, FormsModule } from '@angular/forms';
import {PluginData} from '../../../../interfaces/Plugin';
import {GdsService} from '../../../../services/gds.service';
import {GlobalService} from '../../../../services/global.service';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatCardModule} from '@angular/material/card';
import {MatIconModule} from '@angular/material/icon';
import {MatBadgeModule} from '@angular/material/badge';
import {MatProgressBarModule} from '@angular/material/progress-bar';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatDividerModule} from '@angular/material/divider';
import {MatSliderModule} from '@angular/material/slider';
import {MatSlideToggleModule} from '@angular/material/slide-toggle';
import {MatTooltipModule} from '@angular/material/tooltip';
import {MatInputModule} from '@angular/material/input';
import {MatTableModule} from '@angular/material/table';
import {MatMenuModule} from '@angular/material/menu';
import {MatPaginatorModule} from '@angular/material/paginator';
import {ShowLoadComponent} from '../../../../components/showLoad/showLoad.component';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';

@Component({
  selector: 'app-dialogEdit',
  templateUrl: './dialogEdit.component.html',
  styleUrls: ['./dialogEdit.component.css'],
  imports: [
    MatCheckboxModule,
    MatFormFieldModule,
    MatCardModule,
    MatIconModule,
    FormsModule,
    MatBadgeModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatSliderModule,
    MatSlideToggleModule,
    MatTooltipModule,
    MatInputModule,
    MatTableModule,
    MatMenuModule,
    MatPaginatorModule,
    MatDialogModule,
    MatButtonModule
  ]
})
export class DialogEditComponent implements OnInit {

  load = false;

  title!: string;
  constructor(
    public dialogRef: MatDialogRef<DialogEditComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PluginData,
    private _gdsService: GdsService,
    private _globalService: GlobalService
  ) {
    console.log('DATA: ', this.data);
    if(this.data.key == "auth"){
      this.title = "Credenciais";
      if(this.data.credentialsJsonObject === null || this.data.credentialsJsonObject === undefined)
      {
        let model: any = {username: ""}
        this.data.credentialsJsonObject = JSON.stringify(model)
      }

      this.urlApiModel = JSON.parse(this.data.credentialsJsonObject);
    }else if(this.data.key == 'url'){
      if(this.data.apiBaseUrl === null || this.data.apiBaseUrl === undefined)
      {
        let model: any = {baseUrl: ""}
        this.data.apiBaseUrl = JSON.stringify(model)
      }
      this.title = "Configurações";
      this.urlApiModel = JSON.parse(this.data.apiBaseUrl);
    }else if(this.data.key == 'settings'){
      this.title = 'Configurações';
      if(this.data.configurations === null || this.data.configurations === undefined)
      {
        let model: any = {configurations: ""}
        this.data.configurations = model;
      }
      this.title = "Configurações";
      this.urlApiModel = this.data.configurations;
    }


  }

  urlApiModel: any = {};
  dataParsed: any = {};
  urlApiForm!: FormGroup;
  propertyName: string = '';

  ngOnInit() {
    //console.log('DATA: ', this.data);

  }

  public getObjectProperties(obj: any): any[] {
    return Object.entries(obj).map(([key, value]) => ({ key, value }));
  }

  getObjectKeys(obj: any) {
    return Object.keys(obj);
  }

  addProperty(name: string) {
    this.urlApiModel[name] = '';
    // Campo novo de plugin pessoal nasce preenchido pelo usuário.
    if (this.data.personalFields) this.data.personalFields = [...this.data.personalFields, name];
  }

  removeProperty(name: string) {
    delete this.urlApiModel[name];
    if (this.data.personalFields) this.data.personalFields = this.data.personalFields.filter(k => k !== name);
  }

  /** Nome amigável do campo (0011); sem nome, a própria chave. */
  labelOf(key: string): string {
    const settings = this.data.fieldSettings ?? {};
    const match = Object.keys(settings).find(k => k.toLowerCase() === key.toLowerCase());
    return (match && settings[match]?.label?.trim()) || key;
  }

  /** Plugin pessoal: o campo é preenchido por cada usuário (true) ou fixo com o valor daqui (false). */
  isUserField(key: string): boolean {
    const keys = this.data.personalFields;
    return !keys || keys.some(k => k.toLowerCase() === key.toLowerCase());
  }

  toggleUserField(key: string, userFills: boolean) {
    // null = todos do usuário; ao desmarcar o primeiro, materializa a lista explícita.
    const current = this.data.personalFields ?? this.getObjectKeys(this.urlApiModel);
    const without = current.filter(k => k.toLowerCase() !== key.toLowerCase());
    this.data.personalFields = userFills ? [...without, key] : without;
  }

  validProperty(name: string) {

    const validFormat = /^[a-zA-Z][a-zA-Z0-9]*$/.test(name);

    return validFormat;
  }

  objChanged(property: string, value: string) {
    this.urlApiModel[property] = value;
    console.log(this.urlApiModel)
  }

  saveChanges()
  {
    this.load = true;
    if(this.data.key == "auth"){
      this.data.credentialsJsonObject = JSON.stringify(this.urlApiModel);
    }else if(this.data.key == 'url'){
      this.data.apiBaseUrl = JSON.stringify(this.urlApiModel);
    }else if( this.data.key =='settings'){
      this.data.configurations = this.urlApiModel;
      // Mantém só chaves que existem (campos removidos saem da lista de campos do usuário).
      if (this.data.personalFields) {
        const keys = this.getObjectKeys(this.urlApiModel);
        this.data.personalFields = this.data.personalFields.filter(k => keys.includes(k));
      }
    }

    this._gdsService.putUpdatePluginConfiguration(this.data).subscribe(
      (_retorno : PluginData) => {
        this.load = false;
        this._globalService.sendAlert("Atualizado com sucesso", "Ok");
        this.dialogRef.close(true);
      }, (error: any)  => {
        this.load = false;
        this._globalService.sendAlertError("Erro ao tentar atualizar", "Ok");
        console.error(error.message);
      }
    );
  }
}
