const { HttpsProxyAgent } = require('https-proxy-agent');
const https = require('https');

const proxy = 'http://aaubcdkxstaticresidential:ecljgj60smyr@45.56.179.101:9305';
const agent = new HttpsProxyAgent(proxy);

https.get('https://www.reddit.com/r/SideProject/top.json?limit=5', { agent }, (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(data.slice(0, 500)));
}).on('error', err => console.log('Error:', err.message));
