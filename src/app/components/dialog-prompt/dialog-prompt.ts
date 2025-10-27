import { Component, inject, OnInit } from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogActions, MatDialogContent, MatDialogRef} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { CliipboardService } from '../../services/cliipboard.service';
import { FormsModule } from '@angular/forms';
import {MatInput, MatLabel} from '@angular/material/input';
import { MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';

@Component({
  selector: 'app-dialog-prompt',
  templateUrl: './dialog-prompt.html',
  styleUrl: './dialog-prompt.css',
  imports: [
    MatDialogContent,
    MatDialogActions,
    MatButtonModule,
    FormsModule,
    MatLabel,
    MatFormFieldModule,
    MatInput,
    MatIconModule
  ]
})
export class DialogPrompt implements OnInit {
  readonly data = inject<any>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<DialogPrompt>);
  private _clipboardService = inject(CliipboardService);
  promptText = "";
  constructor() {
  }

  ngOnInit() {
  }

  gerarPrompt() {
    if(!this.data.commitID || !this.data.cardNumber || !this.data.description) return;

    let prompt = `
    Eu como desenvolvedor de software, solicito que crie um texto de descrição para Pull Request com base nos seguintes dados:

    CommitID: {commitId},
    CardNumber (Ticket): {cardNumber},
    Reclamação inicial: {description}

    Todo o texto gerado precisa ser em ingles, e conter uma sessão para Root Cause Analysis (RCA), detalhando o que causou o problema e como ele foi resolvido.

    Modelo do PR:

    Problem Description: XXX
    Solution: XXX
    Changes Made: XXX
    Files Modified: XXX
    Ticket: {cardNumber}

    Modelo do RCA:

    Causa Principal: XXX
    Contributing Factors: XXX
    Impacto: XXX
    Solução Aplicada: XXX
    Plano de Ação / Prevenção: XXX
    Arquivos modificados / Codigo Modificado/ Dados alterados na base de dados: X,X,X
    Ticket: {cardNumber}

    Regras gerais:

    Texto completamente em ingles
    Sessão para Pull Request
    Sessão para RCA
    Seguir os modelos acima
    `;

    if (this.data.description) {
      prompt = prompt.replace('{commitId}', this.data.commitID);
      prompt = prompt.replace('{cardNumber}', this.data.cardNumber);
      prompt = prompt.replace('{description}', this.data.description);
      this.promptText = prompt;
    }
  }

  copyPromptToClipboard() {
    this._clipboardService.copyFullDescriptionToClipboard(this.promptText)
  }


}
