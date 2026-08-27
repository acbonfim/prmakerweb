import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CardFull } from './card-full.model';

interface FieldItem {
  key: string;
  label: string;
  value: string;
}

interface FieldGroup {
  title: string;
  items: FieldItem[];
}

@Component({
  selector: 'app-card-details-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatTooltipModule
  ],
  templateUrl: './card-details-dialog.component.html',
  styleUrls: ['./card-details-dialog.component.css']
})
export class CardDetailsDialogComponent {
  readonly data = inject<{ card: CardFull; cardNumber?: string }>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<CardDetailsDialogComponent>);

  card: CardFull = this.data.card;
  groups: FieldGroup[] = [];
  title = '';
  state = '';
  workItemType = '';

  constructor() {
    const fields = this.card?.fields ?? {};
    this.title = this.stringValue(fields['System.Title']);
    this.state = this.stringValue(fields['System.State']);
    this.workItemType = this.stringValue(fields['System.WorkItemType']);
    this.groups = this.buildGroups(fields);
  }

  private buildGroups(fields: Record<string, any>): FieldGroup[] {
    const system: FieldGroup = { title: 'Sistema', items: [] };
    const vsts: FieldGroup = { title: 'Planejamento / VSTS', items: [] };
    const custom: FieldGroup = { title: 'Campos personalizados', items: [] };
    const other: FieldGroup = { title: 'Outros', items: [] };

    Object.keys(fields)
      .sort()
      .forEach((key) => {
        const value = this.stringValue(fields[key]);
        if (!value) {
          return;
        }
        const item: FieldItem = { key, label: this.friendlyLabel(key), value };
        if (key.startsWith('System.')) {
          system.items.push(item);
        } else if (key.startsWith('Microsoft.VSTS.')) {
          vsts.items.push(item);
        } else if (key.startsWith('Custom.')) {
          custom.items.push(item);
        } else {
          other.items.push(item);
        }
      });

    return [system, vsts, custom, other].filter((g) => g.items.length > 0);
  }

  friendlyLabel(refName: string): string {
    const last = refName.split('.').pop() ?? refName;
    return last
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .trim();
  }

  stringValue(v: any): string {
    if (v === null || v === undefined) {
      return '';
    }
    if (typeof v === 'object') {
      if (v.displayName) {
        return v.displayName;
      }
      try {
        return JSON.stringify(v);
      } catch {
        return '';
      }
    }
    return this.stripHtml(String(v)).trim();
  }

  stripHtml(s: string): string {
    return (s || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  formatDate(value?: string): string {
    if (!value) {
      return '';
    }
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      return '';
    }
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()} ${hh}:${min}`;
  }

  get historyDesc(): CardFull['history'] {
    return (this.card?.history ?? []).slice().reverse();
  }
}
