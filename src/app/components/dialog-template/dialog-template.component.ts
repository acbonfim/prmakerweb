import {Component, inject, OnInit} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogActions, MatDialogContent} from '@angular/material/dialog';
import {MatButtonModule} from '@angular/material/button';

@Component({
  selector: 'app-dialog-template',
  templateUrl: './dialog-template.component.html',
  styleUrls: ['./dialog-template.component.css'],
  imports: [
    MatDialogContent,
    MatDialogActions,
    MatButtonModule
  ]
})
export class DialogTemplateComponent implements OnInit {

  readonly data = inject<any>(MAT_DIALOG_DATA);
  constructor() { }

  ngOnInit() {
    console.log(this.data);
  }

}
