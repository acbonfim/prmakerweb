import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthServicesService } from '../../../services/auth-services.service';
import { GlobalService } from '../../../services/global.service';
import { ServiceFormDialogComponent } from './dialogs/service-form-dialog.component';
import { ConfirmDialogComponent } from '../../../components/confirmDialog/confirmDialog.component';

@Component({
  selector: 'app-services',
  standalone: true,
  templateUrl: './services.component.html',
  styleUrls: ['./services.component.css'],
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatTooltipModule
  ]
})
export class ServicesComponent implements OnInit {
  services = signal<any[]>([]);
  loading = signal(false);
  readonly skeletons = Array.from({ length: 6 });

  constructor(
    private _authServices: AuthServicesService,
    private _globalService: GlobalService,
    public dialog: MatDialog
  ) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this._authServices.getAll().subscribe({
      next: (res: any) => {
        this.services.set(res?.object ?? res?.Object ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this._globalService.sendAlertError('Erro ao carregar serviços', 'OK');
      }
    });
  }

  copyId(service: any) {
    this._globalService.copyToClipBoard(service.externalId);
  }

  openCreate() {
    const ref = this.dialog.open(ServiceFormDialogComponent, {
      width: '480px',
      data: { mode: 'create' }
    });
    ref.afterClosed().subscribe((result) => {
      if (result) this.load();
    });
  }

  openEdit(service: any) {
    const ref = this.dialog.open(ServiceFormDialogComponent, {
      width: '480px',
      data: { mode: 'edit', service }
    });
    ref.afterClosed().subscribe((result) => {
      if (result) this.load();
    });
  }

  confirmDelete(service: any) {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: {
        title: 'Excluir serviço',
        description: `Tem certeza que deseja excluir o serviço "${service.name}"? Esta ação removerá também os acessos concedidos a usuários.`,
        labelCancel: 'Cancelar',
        labelConfirm: 'Excluir'
      }
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed) this.remove(service);
    });
  }

  private remove(service: any) {
    this._authServices.delete(service.externalId).subscribe({
      next: () => {
        this._globalService.sendAlert('Serviço excluído', 'OK');
        this.services.set(this.services().filter((s) => s.externalId !== service.externalId));
      },
      error: (err) => {
        const msg = err?.error?.message || err?.error?.Message || 'Erro ao excluir serviço';
        this._globalService.sendAlertError(msg, 'OK');
      }
    });
  }
}
