import { Component, Inject, OnInit } from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {PluginData} from '../../../../interfaces/Plugin';
import {GdsService} from '../../../../services/gds.service';
import {GlobalService} from '../../../../services/global.service';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatCardModule} from '@angular/material/card';
import {MatIconModule} from '@angular/material/icon';
import {FormsModule} from '@angular/forms';
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
import {MatSelectModule} from '@angular/material/select';
import {MatButtonModule} from '@angular/material/button';

@Component({
  selector: 'app-dialog-manager-plugin',
  templateUrl: './dialog-manager-plugin.component.html',
  styleUrls: ['./dialog-manager-plugin.component.css'],
  imports: [
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
    MatSelectModule,
    MatDialogModule,
    MatButtonModule
  ]
})
export class DialogManagerPluginComponent implements OnInit {

  model!: PluginData;
  title: string = "";
  allPlugins: any = [];
  allPaymentServices: any = [];
  allShoppingCartServices: any = [];
  load = false;

  constructor(
    public dialogRef: MatDialogRef<DialogManagerPluginComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PluginData,
    private _gdsService: GdsService,
    private _globalService: GlobalService
  ) { }

  ngOnInit() {
    this.model = {} as PluginData;
    if(this.data)
    {
      this.title = 'Editar configuração de Plugin';
      this.model = this.data;
    }else{
      this.title = 'Criar nova configuração de Plugin';
    }


  }

  getAllPlugins(){
    this.load = true;
    this._gdsService.getAllPlugin().subscribe(
      (_ret: any) => {
        if(_ret){
          this.allPlugins = _ret;
        }
        this.load = false;
      }, (error:any) => {
        this._globalService.sendAlertError("Erro ao tentar buscar plugins!", "Ok");
        console.error("ERRO: ", error.message);
        this.load = false;
      }
    );
  }



  save(){
    if(this.data)
    {
      this.update();
    }else{
      this.create();
    }
  }

  create(){
    this.load = true;
    const modelRegiste = {
      description: this.model.description,
      configurations: {}
    };
    this._gdsService.postCreatePluginConfiguration(modelRegiste).subscribe(
      (_ret: any) => {
        this.load = false;
        this._globalService.sendAlert("Salvo com sucesso!", "Ok");
        this.dialogRef.close(true);
      }, (error: any) => {
        this.load = false;
        console.error(error.message);
        this._globalService.sendAlertError("Erro ao tentar salvar!", "Ok");
      }
    );
  }

  update(){
    this.load = true;
    this._gdsService.putUpdatePluginConfiguration(this.model).subscribe(
      (_ret: any) => {
        this.load = false;
        this._globalService.sendAlert("Salvo com sucesso!", "Ok");
        this.dialogRef.close(true);
      }, (error: any) => {
        this.load = false;
        console.error(error.message);
        this._globalService.sendAlertError("Erro ao tentar salvar!", "Ok");
      }
    );
  }



}
