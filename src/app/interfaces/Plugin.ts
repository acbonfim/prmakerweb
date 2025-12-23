
export interface Plugin {
  name: string;
  id: string;
  externalId: string;
  key: any;
}

export interface Configuration {
  Token: string;
  Owner: string;
  Repo: string;
  Branch: string;
}

export interface PluginData {
  pluginId: number;
  plugin: Plugin;
  apiBaseUrl: string;
  credentialsJsonObject: string;
  options?: any;
  description: string;
  transactionName: string;
  transactionLocator: string;
  storeId: number;
  shoppingCartId: number;
  paymentServiceId: number;
  extraData?: any;
  usersPlugins?: any;
  id: number;
  externalId?: string;
  fromToClass: string;
  fromToCompany: string;
  key?: any;
  configurations?: Configuration;
}
