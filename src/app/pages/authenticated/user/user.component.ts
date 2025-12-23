import { Component, OnInit } from '@angular/core';
import {RouterModule} from '@angular/router';

@Component({
  selector: 'app-user',
  templateUrl: './user.component.html',
  styleUrls: ['./user.component.css'],
  standalone: true,
  imports: [RouterModule]
})
export class UserComponent implements OnInit {

  constructor() { }

  ngOnInit() {
  }

}
