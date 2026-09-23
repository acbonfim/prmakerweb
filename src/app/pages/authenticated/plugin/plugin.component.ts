import { Component, computed, ElementRef, OnInit, signal, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { DialogEditComponent } from './dialogEdit/dialogEdit.component';
import { DialogManagerPluginComponent } from './dialog-manager-plugin/dialog-manager-plugin.component';
import { PluginData } from '../../../interfaces/Plugin';
import { GdsService } from '../../../services/gds.service';
import { GlobalService } from '../../../services/global.service';
import { ConfirmDialogComponent } from '../../../components/confirmDialog/confirmDialog.component';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-plugin',
  templateUrl: './plugin.component.html',
  styleUrls: ['./plugin.component.css'],
  imports: [
    MatIconModule,
    FormsModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatTooltipModule,
    MatInputModule,
    MatButtonModule,
  ]
})
export class PluginComponent implements OnInit {
  plugins = signal<PluginData[]>([]);
  loading = signal(false);
  searchOpen = signal(false);
  filterText = signal('');
  processingId = signal<number | null>(null);

  readonly skeletons = Array.from({ length: 6 });

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  /** Lista filtrada pela busca (client-side: o endpoint retorna todos os plugins). */
  filtered = computed(() => {
    const q = this.filterText().trim().toLowerCase();
    const list = this.plugins();
    if (!q) return list;
    return list.filter(p =>
      (p.description || '').toLowerCase().includes(q) ||
      (p.plugin?.name || '').toLowerCase().includes(q) ||
      (p.apiBaseUrl || '').toLowerCase().includes(q)
    );
  });

  constructor(
    private _gdsService: GdsService,
    public dialog: MatDialog,
    private _globalService: GlobalService,
  ) {}

  ngOnInit() {
    this.getAllPlugin();
  }

  // ── Busca colapsável (mesmo padrão da gestão de usuários) ──
  toggleSearch() {
    this.searchOpen.update(v => !v);
    if (this.searchOpen()) {
      setTimeout(() => this.searchInput?.nativeElement?.focus(), 0);
    } else if (this.filterText()) {
      this.filterText.set('');
    }
  }

  onSearchChange(value: string) {
    this.filterText.set(value ?? '');
  }

  clearSearch() {
    this.filterText.set('');
  }

  // ── Ações ──
  openDialogEdit(data: PluginData, type: string) {
    data.key = type;
    const dialogRef = this.dialog.open(DialogEditComponent, {
      width: '1000px',
      data: data,
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) this.getAllPlugin();
    });
  }

  openDialogManager(data?: PluginData) {
    const dialogRef = this.dialog.open(DialogManagerPluginComponent, {
      width: '1200px',
      data: data,
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) this.getAllPlugin();
    });
  }

  copyPlugin(plugin: PluginData) {
    const newPlugin: any = {
      apiBaseUrl: plugin.apiBaseUrl,
      credentialsJsonObject: plugin.credentialsJsonObject,
      description: 'Cópia ' + plugin.description,
      fromToClass: plugin.fromToClass,
      paymentServiceId: plugin.paymentServiceId,
      pluginId: plugin.pluginId,
      shoppingCartId: plugin.shoppingCartId,
      storeId: plugin.storeId,
    };

    this.processingId.set(plugin.id);
    this.createPlugin(newPlugin);
  }

  private createPlugin(plugin: PluginData) {
    this._gdsService.postCreatePluginConfiguration(plugin).subscribe(
      () => {
        this.processingId.set(null);
        this._globalService.sendAlert('Salvo com sucesso!', 'Ok');
        this.getAllPlugin();
      },
      (error) => {
        this.processingId.set(null);
        console.error(error.message);
        this._globalService.sendAlertError('Erro ao tentar salvar!', 'Ok');
      }
    );
  }

  private async deletePlugin(plugin: PluginData) {
    this.processingId.set(plugin.id);
    try {
      await this._gdsService.deletePlugin(plugin.id).toPromise();
      this.processingId.set(null);
      this._globalService.sendAlert('Deletado com sucesso!', 'Ok');
      await this.getAllPlugin();
    } catch (error: any) {
      this.processingId.set(null);
      console.error(error.message);
      this._globalService.sendAlertError('Erro ao tentar deletar!', 'Ok');
    }
  }

  openDialogConfirm(item: PluginData): void {
    const model = {
      title: 'Deseja realmente deletar?',
      description: 'Ao deletar, algum plugin poderá deixar de funcionar!',
      labelConfirm: 'Quero deletar',
      labelCancel: 'Fechar',
    };
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: model,
      width: '400px',
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) await this.deletePlugin(item);
    });
  }

  getAllPlugin() {
    this.loading.set(true);
    this._gdsService.getAllPluginConfiguration().subscribe(
      (x: any) => {
        this.plugins.set(Array.isArray(x) ? x : (x ? [x] : []));
        this.loading.set(false);
      },
      (error) => {
        this.loading.set(false);
        console.error(error.message);
        this._globalService.sendAlertError('Erro ao carregar plugins', 'Ok');
      }
    );
  }
}
