const XlsxPopulate = require('xlsx-populate');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    // Just list all files in uploads/templates
    const templatesDir = path.join(__dirname, 'uploads', 'templates');
    
    if (!fs.existsSync(templatesDir)) {
      console.log('Templates directory not found:', templatesDir);
      process.exit(0);
    }
    
    const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.xlsx'));
    console.log(`Found ${files.length} template files\n`);
    
    for (const file of files) {
      const filePath = path.join(templatesDir, file);
      console.log(`Processing: ${file}`);
      
      const wb = await XlsxPopulate.fromFileAsync(filePath);
      let sheetIndex = 0;
      let injected = false;
      
      while (true) {
        try {
          const sheet = wb.sheet(sheetIndex);
          const range = sheet.usedRange();
          if (!range) { sheetIndex++; continue; }
          
          let injected = false;
          
          range.forEach(cell => {
            const val = cell.value();
            const addr = cell.address();
            
            if (typeof val === 'string') {
              const upper = val.toUpperCase().trim();
              
              if (upper === 'REGION' || upper.startsWith('REGION')) {
                const nextCell = cell.columnIndex() + 1;
                const targetCell = sheet.row(cell.rowNumber()).cell(nextCell);
                if (!targetCell.value()) {
                  targetCell.value('{{REGION}}');
                  injected = true;
                  console.log(`  ✓ ${addr} → next cell = {{REGION}}`);
                }
              } else if (upper === 'DIVISION' || upper.startsWith('DIVISION')) {
                const nextCell = cell.columnIndex() + 1;
                const targetCell = sheet.row(cell.rowNumber()).cell(nextCell);
                if (!targetCell.value()) {
                  targetCell.value('{{DIVISION}}');
                  injected = true;
                  console.log(`  ✓ ${addr} → next cell = {{DIVISION}}`);
                }
              } else if (upper === 'SCHOOL NAME' || upper.startsWith('SCHOOL NAME')) {
                const nextCell = cell.columnIndex() + 1;
                const targetCell = sheet.row(cell.rowNumber()).cell(nextCell);
                if (!targetCell.value()) {
                  targetCell.value('{{SCHOOL_NAME}}');
                  injected = true;
                  console.log(`  ✓ ${addr} → next cell = {{SCHOOL_NAME}}`);
                }
              } else if (upper === 'SCHOOL ID' || upper.startsWith('SCHOOL ID')) {
                const nextCell = cell.columnIndex() + 1;
                const targetCell = sheet.row(cell.rowNumber()).cell(nextCell);
                if (!targetCell.value()) {
                  targetCell.value('{{SCHOOL_ID}}');
                  injected = true;
                  console.log(`  ✓ ${addr} → next cell = {{SCHOOL_ID}}`);
                }
              } else if (upper === 'SCHOOL YEAR' || upper.startsWith('SCHOOL YEAR')) {
                const nextCell = cell.columnIndex() + 1;
                const targetCell = sheet.row(cell.rowNumber()).cell(nextCell);
                if (!targetCell.value()) {
                  targetCell.value('{{SCHOOL_YEAR}}');
                  injected = true;
                  console.log(`  ✓ ${addr} → next cell = {{SCHOOL_YEAR}}`);
                }
              } else if (upper === 'TEACHER' || upper.startsWith('TEACHER')) {
                const nextCell = cell.columnIndex() + 1;
                const targetCell = sheet.row(cell.rowNumber()).cell(nextCell);
                if (!targetCell.value()) {
                  targetCell.value('{{TEACHER_NAME}}');
                  injected = true;
                  console.log(`  ✓ ${addr} → next cell = {{TEACHER_NAME}}`);
                }
              } else if (upper === 'SUBJECT' && !upper.includes('TYPE')) {
                const nextCell = cell.columnIndex() + 1;
                const targetCell = sheet.row(cell.rowNumber()).cell(nextCell);
                if (!targetCell.value()) {
                  targetCell.value('{{SUBJECT}}');
                  injected = true;
                  console.log(`  ✓ ${addr} → next cell = {{SUBJECT}}`);
                }
              }
            }
          });
          
          if (injected) {
            await wb.toFileAsync(t.filePath);
            console.log(`✓ Saved: ${t.subjectName}\n`);
            foundSheet = true;
            break;
          }
          
          sheetIndex++;
        } catch (e) {
          break;
        }
      }
      
      if (!foundSheet) {
        console.log(`⚠ ${t.subjectName}: no sheet updated\n`);
      }
    }
    
    await prisma.$disconnect();
    console.log('✓ Done: all templates patched');
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
})();
