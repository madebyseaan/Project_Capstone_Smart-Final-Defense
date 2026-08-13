import ExcelJS from 'exceljs';

/**
 * Template Service - Fills Excel templates with dynamic data
 * Supports placeholders like {{SCHOOL_NAME}}, {{#STUDENTS}}...{{/STUDENTS}}
 */

interface TemplateData {
  [key: string]: any;
}

interface FillTemplateOptions {
  targetSheetName?: string;
  keepOnlyTargetSheet?: boolean;
}

export class TemplateService {
  
  /**
   * Fill an Excel template with data
   * @param templatePath - Path to the template file
   * @param data - Data object with values to replace placeholders
   * @param options - Optional sheet targeting for all-in-one workbooks
   * @returns Buffer containing the filled Excel file
   */
  async fillTemplate(
    templatePath: string,
    data: TemplateData,
    options: FillTemplateOptions = {}
  ): Promise<Buffer> {
    // Load the template workbook
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);

    const worksheetsToProcess = this.getWorksheetsToProcess(workbook, options.targetSheetName);
    worksheetsToProcess.forEach((worksheet) => {
      this.processWorksheet(worksheet, data);
    });

    // Keep only the targeted sheet when requested (useful for SF1-SF7 bundled templates)
    if (options.keepOnlyTargetSheet && options.targetSheetName) {
      const targetWorksheet = workbook.getWorksheet(options.targetSheetName);
      if (!targetWorksheet) {
        throw new Error(`Sheet '${options.targetSheetName}' not found in template`);
      }

      for (const worksheet of [...workbook.worksheets]) {
        if (worksheet.name !== options.targetSheetName) {
          workbook.removeWorksheet(worksheet.id);
        }
      }
    }
    
    // Write to buffer and return
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as unknown as Buffer;
  }

  private getWorksheetsToProcess(workbook: ExcelJS.Workbook, targetSheetName?: string): ExcelJS.Worksheet[] {
    if (!targetSheetName) {
      return workbook.worksheets;
    }

    const worksheet = workbook.getWorksheet(targetSheetName);
    if (!worksheet) {
      throw new Error(`Sheet '${targetSheetName}' not found in template`);
    }

    return [worksheet];
  }

  async getSheetNames(templatePath: string): Promise<string[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    return workbook.worksheets.map((sheet) => sheet.name);
  }
  
  /**
   * Process a worksheet and replace all placeholders
   */
  private processWorksheet(worksheet: ExcelJS.Worksheet, data: TemplateData) {
    const rowsToProcess: Array<{ rowIndex: number; row: ExcelJS.Row }> = [];
    
    // Collect all rows first (to avoid modifying while iterating)
    worksheet.eachRow((row, rowIndex) => {
      rowsToProcess.push({ rowIndex, row });
    });
    
    // Process rows for loop markers
    const loopRegions = this.findLoopRegions(rowsToProcess);
    
    // Apply loops (expand rows)
    for (const loop of loopRegions.reverse()) {
      this.expandLoop(worksheet, loop, data[loop.arrayKey]);
    }
    
    // Replace simple placeholders
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value && typeof cell.value === 'string') {
          cell.value = this.replacePlaceholders(cell.value, data);
        }
      });
    });
  }
  
  /**
   * Find loop regions marked with {{#ARRAY_NAME}} and {{/ARRAY_NAME}}
   */
  private findLoopRegions(
    rows: Array<{ rowIndex: number; row: ExcelJS.Row }>
  ): Array<{ startRow: number; endRow: number; arrayKey: string }> {
    const loops: Array<{ startRow: number; endRow: number; arrayKey: string }> = [];
    let loopStart: { rowIndex: number; arrayKey: string } | null = null;
    
    for (const { rowIndex, row } of rows) {
      row.eachCell((cell) => {
        const value = cell.value?.toString() || '';
        
        // Check for loop start: {{#STUDENTS}}
        const startMatch = value.match(/\{\{#(\w+)\}\}/);
        if (startMatch) {
          loopStart = { rowIndex, arrayKey: startMatch[1] };
        }
        
        // Check for loop end: {{/STUDENTS}}
        const endMatch = value.match(/\{\{\/(\w+)\}\}/);
        if (endMatch && loopStart && endMatch[1] === loopStart.arrayKey) {
          loops.push({
            startRow: loopStart.rowIndex,
            endRow: rowIndex,
            arrayKey: loopStart.arrayKey
          });
          loopStart = null;
        }
      });
    }
    
    return loops;
  }
  
  /**
   * Expand a loop region by duplicating rows for each array item
   */
  private expandLoop(
    worksheet: ExcelJS.Worksheet,
    loop: { startRow: number; endRow: number; arrayKey: string },
    arrayData: any[]
  ) {
    if (!Array.isArray(arrayData) || arrayData.length === 0) {
      // Remove the loop region if no data
      for (let i = loop.endRow; i >= loop.startRow; i--) {
        worksheet.spliceRows(i, 1);
      }
      return;
    }
    
    const templateRows: ExcelJS.Row[] = [];
    
    // Collect template rows (excluding start/end markers)
    for (let i = loop.startRow + 1; i < loop.endRow; i++) {
      const row = worksheet.getRow(i);
      templateRows.push(row);
    }
    
    // Remove original loop region
    for (let i = loop.endRow; i >= loop.startRow; i--) {
      worksheet.spliceRows(i, 1);
    }
    
    // Insert rows for each data item
    let insertIndex = loop.startRow;
    
    arrayData.forEach((item, itemIndex) => {
      templateRows.forEach((templateRow) => {
        // Insert new row
        const newRow = worksheet.insertRow(insertIndex, []);
        
        // Copy cell values and styles
        templateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const newCell = newRow.getCell(colNumber);
          
          // Copy value with placeholder replacement
          let cellValue = cell.value;
          if (cellValue && typeof cellValue === 'string') {
            // Replace item placeholders like {{LRN}}, {{FIRST_NAME}}
            cellValue = this.replacePlaceholders(cellValue, item);
            // Replace loop index {{INDEX}}
            cellValue = cellValue.replace(/\{\{INDEX\}\}/g, (itemIndex + 1).toString());
          }
          newCell.value = cellValue;
          
          // Copy formatting
          newCell.style = { ...cell.style };
          
          // Copy merged cells info (handled separately by ExcelJS)
        });
        
        // Copy row height
        newRow.height = templateRow.height;
        
        insertIndex++;
      });
    });
  }
  
  /**
   * Replace simple placeholders like {{SCHOOL_NAME}}, {{DATE}}
   */
  private replacePlaceholders(text: string, data: TemplateData): string {
    return text.replace(/\{\{([\w.-]+)\}\}/g, (match, key) => {
      // Handle nested keys like {{SECTION.NAME}}
      const keys = key.split('.');
      let value: any = data;
      
      for (const k of keys) {
        value = value?.[k];
      }
      
      return value !== undefined && value !== null ? String(value) : match;
    });
  }
  
  /**
   * Extract available placeholders from a template file
   */
  async extractPlaceholders(templatePath: string, targetSheetName?: string): Promise<string[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    
    const placeholders = new Set<string>();

    const worksheetsToProcess = this.getWorksheetsToProcess(workbook, targetSheetName);

    worksheetsToProcess.forEach((worksheet) => {
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.value && typeof cell.value === 'string') {
            const matches = cell.value.matchAll(/\{\{[#\/]?([\w.-]+)\}\}/g);
            for (const match of matches) {
              placeholders.add(match[1]);
            }
          }
        });
      });
    });
    
    return Array.from(placeholders).sort();
  }
  
  /**
   * Validate that a template file is valid
   */
  async validateTemplate(templatePath: string, targetSheetName?: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(templatePath);
      
      if (workbook.worksheets.length === 0) {
        return { valid: false, error: 'Template has no worksheets' };
      }
      
      // Check for balanced loop markers
      const loopStacks: { [key: string]: number } = {};

      const worksheetsToProcess = this.getWorksheetsToProcess(workbook, targetSheetName);

      worksheetsToProcess.forEach((worksheet) => {
        worksheet.eachRow((row) => {
          row.eachCell((cell) => {
            const value = cell.value?.toString() || '';
            
            // Check for loop start
            const startMatch = value.match(/\{\{#(\w+)\}\}/g);
            if (startMatch) {
              startMatch.forEach((m) => {
                const key = m.match(/\{\{#(\w+)\}\}/)![1];
                loopStacks[key] = (loopStacks[key] || 0) + 1;
              });
            }
            
            // Check for loop end
            const endMatch = value.match(/\{\{\/(\w+)\}\}/g);
            if (endMatch) {
              endMatch.forEach((m) => {
                const key = m.match(/\{\{\/(\w+)\}\}/)![1];
                loopStacks[key] = (loopStacks[key] || 0) - 1;
              });
            }
          });
        });
      });
      
      // Check if all loops are balanced
      for (const [key, count] of Object.entries(loopStacks)) {
        if (count !== 0) {
          return { valid: false, error: `Unbalanced loop markers for {{#${key}}}` };
        }
      }
      
      return { valid: true };
    } catch (error: any) {
      return { valid: false, error: error.message };
    }
  }
}

export default new TemplateService();
