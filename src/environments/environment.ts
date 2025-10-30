const protocol = 'http';
const protocolAuth = 'https';
const server = 'localhost';
const serverAuth = 'authapiservice.runasp.net';
const porta = '5083';
const host = `${protocol}://${server}:${porta}`;
const hostAuth = `${protocolAuth}://${serverAuth}`;

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
