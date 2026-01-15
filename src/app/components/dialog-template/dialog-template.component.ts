import {Component, inject, OnInit} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogActions, MatDialogContent, MatDialogRef} from '@angular/material/dialog';
import {MatButtonModule} from '@angular/material/button';
import {SafeHtmlPipe} from 'primeng/menu';
import {marked} from 'marked';

@Component({
  selector: 'app-dialog-template',
  templateUrl: './dialog-template.component.html',
  styleUrls: ['./dialog-template.component.css'],
  standalone: true,
  imports: [
    MatDialogContent,
    MatDialogActions,
    MatButtonModule,
    SafeHtmlPipe
  ]
})
export class DialogTemplateComponent implements OnInit {

  readonly data = inject<any>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<DialogTemplateComponent>);
   generatedText: string = '';
  constructor() {
    marked.setOptions({
      breaks: true,
      gfm: true
    });
  }

  ngOnInit() {
    this.generatedText = marked.parse(this.data.description) as string;
  }

}
