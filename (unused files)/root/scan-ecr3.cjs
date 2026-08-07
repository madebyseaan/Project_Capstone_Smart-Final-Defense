const XLSX = require('xlsx');

// Scan the TEMPLATE (blank) that was uploaded
const filePath = 'c:\\Users\\Sean\\Downloads\\ECR_English 7_Gaius.xlsx';
console.log('Reading TEMPLATE:', filePath);
const wb = XLSX.readFile(filePath);
console.log('Sheets:', wb.SheetNames.join(', '));

// Scan INPUT DATA sheet structure
const inputSheet = wb.Sheets['INPUT DATA'];
if (inputSheet) {
  const range = XLSX.utils.decode_range(inputSheet['!ref']);
  console.log('\n=== INPUT DATA sheet ===');
  console.log(`Range: ${inputSheet['!ref']}`);
  console.log('\nFirst 20 rows (all columns):');
  for (let r = 0; r <= Math.min(19, range.e.r); r++) {
    let row = `Row ${r + 1}: `;
    for (let c = 0; c <= Math.min(10, range.e.c); c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = inputSheet[addr];
      if (cell && cell.v !== undefined) {
        const colName = c < 26 ? String.fromCharCode(65 + c) : 'A' + String.fromCharCode(65 + c - 26);
        row += `[${colName}:"${cell.v}" type:${cell.t}] `;
      }
    }
    if (row !== `Row ${r + 1}: `) console.log(row);
    else console.log(`Row ${r + 1}: (empty)`);
  }
  
  // Check for formulas in first row
  console.log('\nFirst row formulas:');
  for (let c = 0; c <= 5; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = inputSheet[addr];
    if (cell && cell.f) {
      const colName = String.fromCharCode(65 + c);
      console.log(`  ${colName}: formula="${cell.f}"`);
    }
  }
}

// Scan ENGLISH_Q1 cell B12 to see if it has a formula (references INPUT DATA?)
const q1Sheet = wb.Sheets['ENGLISH _Q1'];
if (q1Sheet) {
  console.log('\n=== ENGLISH_Q1 Cell B12 (first student slot) ===');
  const cellB12 = q1Sheet['B12'];
  console.log('B12:', JSON.stringify(cellB12));
  const cellA12 = q1Sheet['A12'];
  console.log('A12:', JSON.stringify(cellA12));
  const cellB11 = q1Sheet['B11'];
  console.log('B11 (MALE marker):', JSON.stringify(cellB11));
  
  console.log('\n=== Row 11 full scan ===');
  for (let c = 0; c <= 5; c++) {
    const addr = XLSX.utils.encode_cell({ r: 10, c });
    const cell = q1Sheet[addr];
    if (cell) {
      const colName = String.fromCharCode(65 + c);
      console.log(`  ${colName}: v="${cell.v}" f="${cell.f || 'none'}" t="${cell.t}"`);
    }
  }
  
  console.log('\n=== Row 12 full scan (first data row) ===');
  for (let c = 0; c <= 10; c++) {
    const addr = XLSX.utils.encode_cell({ r: 11, c });
    const cell = q1Sheet[addr];
    const colName = c < 26 ? String.fromCharCode(65 + c) : 'A' + String.fromCharCode(65 + c - 26);
    if (cell) {
      console.log(`  ${colName}: v="${cell.v}" f="${cell.f || 'none'}" t="${cell.t}"`);
    } else {
      console.log(`  ${colName}: (empty)`);
    }
  }
}
