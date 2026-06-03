const https = require('https');

function testRequest(label, url, headers) {
  return new Promise((resolve) => {
    console.log(`Running: ${label} using ${url}`);
    const req = https.get(url, {
      headers,
      timeout: 10000
    }, (res) => {
      console.log(`${label} Status Code:`, res.statusCode);
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`${label} response preview:`, data.slice(0, 150));
        resolve(res.statusCode);
      });
    });

    req.on('error', err => {
      console.log(`${label} Error:`, err.message);
      resolve(null);
    });
    
    req.on('timeout', () => {
      req.destroy();
      console.log(`${label} timed out`);
      resolve(null);
    });
  });
}

async function main() {
  const newHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://old.reddit.com/',
  };

  await testRequest('Direct JSON Fetch', 'https://www.reddit.com/r/SideProject/comments/1tu0cq9.json?raw_json=1', newHeaders);
}

main();
