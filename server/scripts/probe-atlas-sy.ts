import 'dotenv/config';
import http from 'http';

const ATLAS_BASE = 'http://100.88.55.125:5001/api/v1';

function get(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res: any) => {
      let body = '';
      res.on('data', (c: any) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode} ${url}: ${body.substring(0, 200)}`));
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`JSON parse error from ${url}`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const atlasToken = process.env.ATLAS_SYSTEM_TOKEN;
  const authHeader = { Authorization: `Bearer ${atlasToken}` };

  console.log('Probing ATLAS for school years...');
  try {
    const res = await get(`${ATLAS_BASE}/school-years`, authHeader);
    console.log('ATLAS School Years:', JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.log('ATLAS /school-years failed or not found:', err.message);
  }

  try {
    const res = await get(`${ATLAS_BASE}/schools/1/school-years`, authHeader);
    console.log('ATLAS /schools/1/school-years:', JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.log('ATLAS /schools/1/school-years failed or not found:', err.message);
  }
}

main().catch(console.error);
