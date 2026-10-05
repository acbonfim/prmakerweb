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

  /**
   * Copia conteúdo formatado (HTML) com o texto puro como alternativa: colar em Teams/Outlook/DevOps
   * traz a tabela; colar em editor de texto traz o `text`. Sem suporte a ClipboardItem, copia só o texto.
   */
  async copyRichToClipboard(html: string, text: string): Promise<void> {
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
        this._snackBar.open('Copiado com sucesso', 'Ok', {direction : "ltr", horizontalPosition: "right", verticalPosition: "top"});
        return;
      }
    } catch (e) {
      console.error('Erro ao copiar HTML para a área de transferência:', e);
    }
    this.copyFullDescriptionToClipboard(text);
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
