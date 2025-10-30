import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root',
})
export class CliipboardService {
  private _snackBar = inject(MatSnackBar);

  constructor() { }

  copyFullDescriptionToClipboard(fullDescription: string) {
    if (!fullDescription) {
      this._snackBar.open('Nenhuma descrição para copiar', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"})
      return;
    }

    try {
      navigator.clipboard.writeText(fullDescription)
        .then(() => {
          this._snackBar.open('Copiado com sucesso', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"})
        })
        .catch(err => {
          console.error('Erro ao copiar para a área de transferência:', err);
          this.fallbackCopyToClipboard(fullDescription!);
        });
    } catch (e) {
      console.error('Erro ao copiar para a área de transferência:', e);
      this.fallbackCopyToClipboard(fullDescription!);
    }


  }

  private fallbackCopyToClipboard(text: string) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);

    const selected = document.getSelection()?.rangeCount && document.getSelection()?.getRangeAt(0);

    textArea.select();
    textArea.setSelectionRange(0, textArea.value.length);

    try {
      const successful = document.execCommand('copy');
      if (successful) {
        this._snackBar.open('Copiado com sucesso', 'Ok',
          {direction: "ltr", horizontalPosition: "right", verticalPosition: "top"});
      }
    } catch (err) {
      console.error('Erro ao copiar usando fallback:', err);
    }

    document.body.removeChild(textArea);

    if (selected) {
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(selected);
      }
  }

}
