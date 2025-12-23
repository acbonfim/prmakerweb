import { Component, OnInit } from '@angular/core';
import {MatCardModule} from '@angular/material/card';
import {MatProgressBarModule} from '@angular/material/progress-bar';

@Component({
  selector: 'app-showLoad',
  templateUrl: './showLoad.component.html',
  styleUrls: ['./showLoad.component.css'],
  imports: [
    MatProgressBarModule,
    MatCardModule
  ]
})
export class ShowLoadComponent implements OnInit {

  constructor() { }

  ngOnInit() {
  }

}
