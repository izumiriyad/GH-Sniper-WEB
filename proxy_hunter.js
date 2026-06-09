const axios = require('axios');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');

const GH_TEST_URL = 'https://api-managed-delivery-gtm.grubhub.com/healthcheck';
const PROXY_SOURCES = [
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=US&ssl=all&anonymity=all',
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'
];

async function huntProxies() {
  console.log('🔥 COOK45 PROXY HUNTER — Scavenging open US proxies...');
  let proxies = new Set();
  
  for (const url of PROXY_SOURCES) {
    try {
      const res = await axios.get(url, { timeout: 10000 });
      const list = res.data.split('\n').map(p => p.trim()).filter(p => p.includes(':'));
      list.forEach(p => proxies.add(p));
      console.log(`[+] Pulled ${list.length} proxies from ${url}`);
    } catch (e) {
      console.log(`[-] Failed to pull from ${url}`);
    }
  }

  const proxyArray = Array.from(proxies);
  console.log(`\n🎯 Testing ${proxyArray.length} unique proxies against GrubHub WAF... (This will take a minute)`);
  
  let working = [];
  const BATCH_SIZE = 50;

  for (let i = 0; i < proxyArray.length; i += BATCH_SIZE) {
    const batch = proxyArray.slice(i, i + BATCH_SIZE);
    
    const tests = batch.map(async (proxy) => {
      try {
        const agent = new HttpsProxyAgent(`http://${proxy}`);
        const res = await axios.head(GH_TEST_URL, {
          httpsAgent: agent,
          timeout: 4000,
          validateStatus: () => true
        });
        
        if (res.status === 200 || res.status === 401) { // 401 is good, means GH API responded, not WAF block
          console.log(`[✅] WORKING RESIDENTIAL/ELITE PROXY FOUND: http://${proxy}`);
          working.push(`http://${proxy}`);
        }
      } catch (e) {
        // Failed, ignore
      }
    });

    await Promise.all(tests);
    process.stdout.write(`\rTested ${Math.min(i + BATCH_SIZE, proxyArray.length)}/${proxyArray.length}... Found ${working.length} working.`);
  }

  console.log('\n\n🏆 DONE. Working Proxies:');
  working.forEach(p => console.log(p));
  
  if (working.length > 0) {
    fs.writeFileSync('working_proxies.txt', working.join(','));
    console.log('\nSaved to working_proxies.txt. Copy this to your PROXY_URLS variable in Railway!');
  } else {
    console.log('\n❌ FUCK. None of the public US proxies bypassed the WAF. You NEED a paid residential proxy.');
  }
}

huntProxies();
