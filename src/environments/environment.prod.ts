const protocol = 'https';
const server = 'prformapi.runasp.net';
const serverAuth = 'authapiservice.runasp.net';
const port = '80';
const host = `${protocol}://${server}`;
const hostAuth = `${protocol}://${serverAuth}`;

export const environment =
  {
    production: true,
    apiUrl: `${host}/api/v1/`,
    apiKeyWS: '123456789',
    urlWs: `${host}/ws/`,
    secretKey: 'as8&6ahh$#oa(23)K8t$#',
    urlApiAuth: `${hostAuth}/api/`,
    title: 'Title test',
    // Integração com o Teams (login MSAL do próprio usuário para importar mensagens).
    // Fica inerte enquanto clientId estiver vazio (aguardando o app SPA + consentimento do admin).
    teamsGraph: {
      clientId: '',           // Application (client) ID do app registration (tipo SPA)
      tenantId: 'common',     // Directory (tenant) ID; 'common' funciona para multi-tenant
      redirectUri: ''         // vazio => usa a origem atual da aplicação
    }
  }
