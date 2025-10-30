import { Component, OnInit } from '@angular/core';
import {TableModule} from 'primeng/table';
import {TagModule} from 'primeng/tag';
import {InputTextModule} from 'primeng/inputtext';
import {SelectModule} from 'primeng/select';
import {CommonModule} from '@angular/common';
import {ToastModule} from 'primeng/toast';
import {ButtonModule} from 'primeng/button';
import {MessageService, SelectItem} from 'primeng/api';
import {FormsModule} from '@angular/forms';
import {LoadingBarModule, LoadingBarService} from '@ngx-loading-bar/core';
import {MatCardModule} from '@angular/material/card';
import {ProductService} from '../../../services/ProductService.service';


export interface Product {
  id?: string;
  code?: string;
  name?: string;
  description?: string;
  price?: number;
  quantity?: number;
  inventoryStatus?: string;
  category?: string;
  image?: string;
  rating?: number;
}

@Component({
  selector: 'app-client-access',
  templateUrl: './client-access.component.html',
  styleUrls: ['./client-access.component.css'],
  standalone: true,
  imports: [TableModule, ToastModule, CommonModule, TagModule, SelectModule, ButtonModule, InputTextModule, CommonModule, FormsModule, LoadingBarModule,
    MatCardModule

  ],
  providers: [MessageService, ProductService]
})
export class ClientAccessComponent implements OnInit {


  products!: Product[];

  statuses!: SelectItem[];

  clonedProducts: { [s: string]: Product } = {};

  loginCredentials = {
    username: 'teste',
    password: 'teste',
    redirectURL: '/board/main/posts'
  };

  constructor(private productService: ProductService, private messageService: MessageService,
              private loadingBar: LoadingBarService,
              ) {}

  ngOnInit() {
    this.loadingBar.start();
    this.productService.getProductsMini()
      .then((data: any) => {
      this.products = data;
        this.loadingBar.stop();
    });



    this.statuses = [
      { label: 'In Stock', value: 'INSTOCK' },
      { label: 'Low Stock', value: 'LOWSTOCK' },
      { label: 'Out of Stock', value: 'OUTOFSTOCK' }
    ];
  }




  onRowEditInit(product: Product) {
    this.clonedProducts[product.id as string] = { ...product };
  }

  onRowEditSave(product: Product) {
    if (product.price! > 0) {
      delete this.clonedProducts[product.id as string];
      this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Product is updated' });
    } else {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Invalid Price' });
    }
  }

  onRowEditCancel(product: Product, index: number) {
    this.products[index] = this.clonedProducts[product.id as string];
    delete this.clonedProducts[product.id as string];
  }

  getSeverity(status: string) {
    switch (status) {
      case 'INSTOCK':
        return 'success';
      case 'LOWSTOCK':
        return 'warn';
      case 'OUTOFSTOCK':
        return 'danger';
        default:
          return 'info';
    }
  }

}
