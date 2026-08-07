import 'dotenv/config';

async function main() {
  const id = 55; // 2026-2027
  const url = `https://dev-jegs.buru-degree.ts.net/api/integration/v1/sections?schoolYearId=${id}&limit=200`;
  try {
    const response = await fetch(url);
    const result: any = await response.json();
    
    // Find where "AFA" is appearing
    const raw = JSON.stringify(result.data);
    const index = raw.indexOf('AFA');
    console.log(`AFA found at index ${index}: ...${raw.slice(index - 50, index + 100)}...`);

  } catch (err: any) {
    console.error(err.message);
  }
}

main().catch(console.error);
