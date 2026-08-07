const XLSX = require('xlsx');

const filePath = 'c:\\Users\\Sean\\Downloads\\GRADE-7_GAIUS_ENGLISH.xlsx';
const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets['ENGLISH _Q1'];
const range = XLSX.utils.decode_range(sheet['!ref']);

console.log('=== HEADER ROWS (Columns A-AH, rows 8-10) ===');
for (let r = 7; r <= 9; r++) {
  let row = `Row ${r + 1}: `;
  for (let c = 0; c <= 33; c++) {
    const cellAddr = XLSX.utils.encode_cell({ r, c });
    const cell = sheet[cellAddr];
    if (cell && cell.v !== undefined && cell.v !== '') {
      row += `[${String.fromCharCode(65 + c)}${c >= 26 ? String.fromCharCode(65 + c - 26) : ''}:${cell.v}] `;
    }
  }
  console.log(row);
}

console.log('\n=== HIGHEST POSSIBLE SCORE row (row 10) ===');
let hpsRow = 'Row 10: ';
for (let c = 0; c <= 40; c++) {
  const cellAddr = XLSX.utils.encode_cell({ r: 9, c });
  const cell = sheet[cellAddr];
  if (cell && cell.v !== undefined && cell.v !== '') {
    const colName = c < 26 ? String.fromCharCode(65 + c) : 'A' + String.fromCharCode(65 + c - 26);
    hpsRow += `[${colName}:${cell.v}] `;
  }
}
console.log(hpsRow);

console.log('\n=== MALE row (row 11) ===');
for (let c = 0; c <= 5; c++) {
  const cellAddr = XLSX.utils.encode_cell({ r: 10, c });
  const cell = sheet[cellAddr];
  if (cell) console.log(`  ${String.fromCharCode(65 + c)}: "${cell.v}"`);
}

console.log('\n=== First MALE student (row 12) ===');
for (let c = 0; c <= 35; c++) {
  const cellAddr = XLSX.utils.encode_cell({ r: 11, c });
  const cell = sheet[cellAddr];
  if (cell && cell.v !== undefined && cell.v !== '') {
    const colName = c < 26 ? String.fromCharCode(65 + c) : 'A' + String.fromCharCode(65 + c - 26);
    console.log(`  ${colName} (col ${c + 1}): ${cell.v}`);
  }
}

console.log('\n=== Looking for FEMALE marker ===');
for (let r = 30; r <= 70; r++) {
  const cellB = sheet[XLSX.utils.encode_cell({ r, c: 1 })];
  if (cellB && cellB.v && typeof cellB.v === 'string' && cellB.v.toUpperCase().includes('FEMALE')) {
    console.log(`Found FEMALE at row ${r + 1}`);
    // Show next 2 rows
    for (let nr = r + 1; nr <= r + 2; nr++) {
      let nextRow = `  Row ${nr + 1}: `;
      for (let nc = 0; nc <= 35; nc++) {
        const addr = XLSX.utils.encode_cell({ r: nr, c: nc });
        const nextCell = sheet[addr];
        if (nextCell && nextCell.v !== undefined && nextCell.v !== '') {
          const colName = nc < 26 ? String.fromCharCode(65 + nc) : 'A' + String.fromCharCode(65 + nc - 26);
          nextRow += `[${colName}:${nextCell.v}] `;
        }
      }
      console.log(nextRow);
    }
    break;
  }
}
