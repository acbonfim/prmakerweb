const protocol = 'https';
const server = 'localhost:5083';
const serverAuth = 'authapiservice.runasp.net';
const port = '80';
const host = `http://${server}`;
const hostAuth = `${protocol}://${serverAuth}`;

export const environment =
  {
    production: true,
    apiUrl: `${host}/api/v1/`,
    apiKeyWS: '123456789',
    urlWs: `${host}/ws/`,
    secretKey: 'as8&6ahh$#oa(23)K8t$#',
    urlApiAuth: `${hostAuth}/api/`,
    title: 'Title test'
  }
