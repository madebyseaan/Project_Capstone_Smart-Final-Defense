const XLSX = require('xlsx');

const filePath = 'c:\\Users\\Sean\\Downloads\\GRADE-7_GAIUS_ENGLISH.xlsx';
console.log('Reading:', filePath);

const workbook = XLSX.readFile(filePath);
console.log('\n=== SHEETS ===');
console.log(workbook.SheetNames.join(', '));

// Read ENGLISH_Q1 sheet
const sheetName = workbook.SheetNames.find(s => s.includes('Q1') || s.includes('ENGLISH'));
if (sheetName) {
  console.log(`\n=== Sheet: ${sheetName} ===`);
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  
  console.log(`Range: ${sheet['!ref']} (${range.e.r + 1} rows, ${range.e.c + 1} cols)`);
  
  // Show first 15 rows
  console.log('\n=== First 15 rows (columns A-M) ===');
  for (let r = 0; r <= Math.min(15, range.e.r); r++) {
    let row = `Row ${r + 1}: `;
    for (let c = 0; c <= Math.min(12, range.e.c); c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[cellAddr];
      if (cell) {
        const val = cell.v;
        if (val !== undefined && val !== '') {
          row += `[${String.fromCharCode(65 + c)}:${val}] `;
        }
      }
    }
    if (row.length > 10) console.log(row);
  }
  
  // Find MALE section
  console.log('\n=== Looking for MALE section ===');
  for (let r = 0; r <= Math.min(50, range.e.r); r++) {
    for (let c = 0; c <= 5; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[cellAddr];
      if (cell && cell.v && typeof cell.v === 'string' && cell.v.toUpperCase() === 'MALE') {
        console.log(`Found MALE at row ${r + 1}, col ${String.fromCharCode(65 + c)}`);
        // Show next 5 rows
        for (let nr = r + 1; nr <= Math.min(r + 5, range.e.r); nr++) {
          let nextRow = `  Row ${nr + 1}: `;
          for (let nc = 0; nc <= 12; nc++) {
            const addr = XLSX.utils.encode_cell({ r: nr, c: nc });
            const nextCell = sheet[addr];
            if (nextCell && nextCell.v !== undefined && nextCell.v !== '') {
              nextRow += `[${String.fromCharCode(65 + nc)}:${nextCell.v}] `;
            }
          }
          console.log(nextRow);
        }
        break;
      }
    }
  }
  
  // Find FEMALE section
  console.log('\n=== Looking for FEMALE section ===');
  for (let r = 0; r <= Math.min(100, range.e.r); r++) {
    for (let c = 0; c <= 5; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[cellAddr];
      if (cell && cell.v && typeof cell.v === 'string' && cell.v.toUpperCase() === 'FEMALE') {
        console.log(`Found FEMALE at row ${r + 1}, col ${String.fromCharCode(65 + c)}`);
        // Show next 3 rows
        for (let nr = r + 1; nr <= Math.min(r + 3, range.e.r); nr++) {
          let nextRow = `  Row ${nr + 1}: `;
          for (let nc = 0; nc <= 12; nc++) {
            const addr = XLSX.utils.encode_cell({ r: nr, c: nc });
            const nextCell = sheet[addr];
            if (nextCell && nextCell.v !== undefined && nextCell.v !== '') {
              nextRow += `[${String.fromCharCode(65 + nc)}:${nextCell.v}] `;
            }
          }
          console.log(nextRow);
        }
        break;
      }
    }
  }
}

console.log('\n=== DONE ===');
