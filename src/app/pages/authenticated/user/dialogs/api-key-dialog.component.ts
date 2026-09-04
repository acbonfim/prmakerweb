import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { GlobalService } from '../../../../services/global.service';

interface ApiKeyData {
  apiKey: string;
  user?: any;
  roles?: string[];
}

@Component({
  selector: 'app-api-key-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule
  ],
  template: `
    <h2 mat-dialog-title>Minha API Key</h2>

    <mat-dialog-content>
      <p class="text-muted">
        Use esta chave no header <code>x-api-key</code> para integrar com a API.
        Guarde-a com segurança.
      </p>

      <mat-form-field appearance="outline" style="width: 100%;">
        <mat-label>API Key</mat-label>
        <textarea matInput readonly rows="4" style="font-family: monospace; font-size: 12px;">{{ data.apiKey }}</textarea>
      </mat-form-field>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Fechar</button>
      <button mat-raised-button color="primary" (click)="copy()">
        <mat-icon>content_copy</mat-icon> Copiar
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { min-width: 460px; max-width: 560px; }
  `]
})
export class ApiKeyDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ApiKeyData,
    private dialogRef: MatDialogRef<ApiKeyDialogComponent>,
    private _globalService: GlobalService
  ) {}

  copy(): void {
    this._globalService.copyToClipBoard(this.data.apiKey);
  }

  close(): void {
    this.dialogRef.close();
  }
}
