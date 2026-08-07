import 'dotenv/config';

async function main() {
  const id = 55; // 2026-2027
  const url = `https://dev-jegs.buru-degree.ts.net/api/integration/v1/sections?schoolYearId=${id}&limit=200`;
  console.log(`--- Inspecting API Meta for SY ${id} ---`);
  try {
    const response = await fetch(url);
    const result: any = await response.json();
    console.log(`Total reported in meta: ${result.meta?.total}`);
    console.log(`Sections in this page: ${result.data?.length}`);
    
    // Check for a specific section name manually in the raw data
    const hasAFA = JSON.stringify(result.data).includes('AFA');
    console.log(`Contains "AFA": ${hasAFA}`);
    
    if (result.meta?.totalPages > 1) {
        console.log(`Warning: Multiple pages (${result.meta.totalPages}) even with limit=200!`);
    }
    
    // Search for AFA specifically
    const afa = result.data.filter((s: any) => s.name.includes('AFA'));
    console.log(`Found ${afa.length} AFA sections in this page.`);
    afa.forEach((s: any) => console.log(` - ${s.name} (Grade: ${s.gradeLevel?.name})`));

  } catch (err: any) {
    console.error(err.message);
  }
}

main().catch(console.error);
