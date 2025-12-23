import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ShowLoadComponent } from './showLoad.component';
import {MatProgressBarModule} from '@angular/material/progress-bar';
import {MatCardModule} from '@angular/material/card';

@NgModule({
  imports: [
    CommonModule
    ,RouterModule,

  ],
})
export class ShowLoadModule { }
