import { Component, OnInit, ViewChild } from '@angular/core';
import {MatPaginator, MatPaginatorModule} from '@angular/material/paginator';
import {MatSort, MatSortModule} from '@angular/material/sort';
import {MatTableDataSource, MatTableModule} from '@angular/material/table';
import { DialogEditComponent } from './dialogEdit/dialogEdit.component';
import { MatDialog } from '@angular/material/dialog';
import { DialogManagerPluginComponent } from './dialog-manager-plugin/dialog-manager-plugin.component';
import {PluginData} from '../../../interfaces/Plugin';
import {GdsService} from '../../../services/gds.service';
import {GlobalService} from '../../../services/global.service';
import {ConfirmDialogComponent} from '../../../components/confirmDialog/confirmDialog.component';
import {MatCardModule} from '@angular/material/card';
import {MatFormFieldModule} from '@angular/material/form-field';
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
import {MatMenuModule} from '@angular/material/menu';
import {ShowLoadComponent} from '../../../components/showLoad/showLoad.component';
import {MatButton, MatButtonModule} from '@angular/material/button';

@Component({
  selector: 'app-plugin',
  templateUrl: './plugin.component.html',
  styleUrls: ['./plugin.component.css'],
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
    ShowLoadComponent,
    MatButtonModule,
    MatSortModule
  ]
})
export class PluginComponent implements OnInit {
  load: any = {};
  allPlugins: any = [];
  actionId: string = '';

  displayedColumns: string[] = [
    'description',
    'actions',
  ];
  dataSource!: MatTableDataSource<PluginData>;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private _gdsService: GdsService
    , public dialog: MatDialog
    , private _globalService: GlobalService) {}

  ngOnInit() {
    this.getAllPlugin();
  }

  ngAfterViewInit() {
    //this.dataSource.paginator = this.paginator;
    //this.dataSource.sort = this.sort;
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();

    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
  }

  openDialogEdit(data: PluginData, type: string) {
    data.key = type;
    const dialogRef = this.dialog.open(DialogEditComponent, {
      width: '1000px',
      data: data,
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.getAllPlugin();
      }
    });
  }




  openDialogManager(data?: PluginData) {
    const dialogRef = this.dialog.open(DialogManagerPluginComponent, {
      width: '1200px',
      data: data,
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.getAllPlugin();
      }
    });
  }

  copyPlugin(plugin: PluginData){
    let newPlugin: any = {
      apiBaseUrl : plugin.apiBaseUrl
      ,credentialsJsonObject: plugin.credentialsJsonObject
      ,description: 'Cópia ' + plugin.description
      ,fromToClass: plugin.fromToClass
      ,paymentServiceId: plugin.paymentServiceId
      ,pluginId: plugin.pluginId
      ,shoppingCartId: plugin.shoppingCartId
      ,storeId: plugin.storeId
    };

    this.actionId = 'btn-' + plugin.id;

    this.createPlugin(newPlugin);
  }

  createPlugin(plugin: PluginData){
    this.load.createPlugin = true;

    this._gdsService.postCreatePluginConfiguration(plugin).subscribe(
      (_ret: any) => {
        this.load.createPlugin = false;
        this.actionId = '';
        this._globalService.sendAlert("Salvo com sucesso!", "Ok");
        this.getAllPlugin();
      }, error => {
        this.actionId = '';
        this.load.createPlugin = false;
        console.error(error.message);
        this._globalService.sendAlertError("Erro ao tentar salvar!", "Ok");
      }
    );
  }

  async deletePlugin(plugin: PluginData) {
    this.load.createPlugin = true;

    try {
      await this._gdsService.deletePlugin(plugin.id).toPromise();
      this.load.deletePlugin = false;
      this.actionId = '';
      this._globalService.sendAlert("Deletado com sucesso!", "Ok");
      await this.getAllPlugin();
    } catch (error: any) {
      this.actionId = '';
      this.load.deletePlugin = false;
      console.error(error.message);
      this._globalService.sendAlertError("Erro ao tentar deletar!", "Ok");
      }
  }

  async openDialogConfirm(item: any): Promise<void> {
    let model: any = {
      title: 'Deseja realmente deletar?',
      description: 'Ao deletar, algum plugin poderá de funcionar!',
      labelConfirm: 'Quero deletar',
      labelCancel: 'Fechar',
    };
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: model,
      width: '400px',
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        console.log('Confirmei');
        await this.deletePlugin(item);
      } else {
        console.log('Desisti');
      }
    });
  }

  async getAllPlugin() {
    this.load.getAllPlugin = true;
    this._gdsService.getAllPluginConfiguration().subscribe(
      (x: PluginData) => {
        this.allPlugins = x;

        this.load.getAllPlugin = false;
        this.dataSource = new MatTableDataSource(this.allPlugins);
        this.dataSource.paginator = this.paginator;
        this.dataSource.sort = this.sort;
      },
      (error) => {
        this.load.getAllPlugin = false;
        console.error(error.message);
      }
    );
  }
}
