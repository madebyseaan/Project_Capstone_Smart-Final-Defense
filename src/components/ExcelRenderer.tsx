import React from 'react';
import './ExcelRenderer.css';

/**
 * ExcelRenderer - Renders Excel templates with pixel-perfect styling
 * Converts parsed Excel structure (from ExcelStyleParser) into HTML/CSS
 * Supports print-ready output that matches Excel format exactly
 */

interface CellStyle {
  backgroundColor?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'bold' | 'normal';
  fontStyle?: 'italic' | 'normal';
  textDecoration?: 'underline' | 'none';
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  border?: {
    top?: BorderStyle;
    right?: BorderStyle;
    bottom?: BorderStyle;
    left?: BorderStyle;
  };
  wrapText?: boolean;
  numberFormat?: string;
}

interface BorderStyle {
  style: string;
  color?: string;
}

interface ParsedCell {
  row: number;
  col: number;
  value: any;
  formula?: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'formula' | 'empty';
  style: CellStyle;
  mergeInfo?: {
    rowSpan: number;
    colSpan: number;
    isMaster: boolean;
  };
}

interface ParsedSheet {
  name: string;
  rowCount: number;
  colCount: number;
  cells: ParsedCell[];
  columnWidths: number[];
  rowHeights: number[];
  mergedCells: string[];
}

interface ExcelRendererProps {
  sheet: ParsedSheet;
  className?: string;
  scale?: number; // Scale factor for responsive sizing (default: 1)
  showGridlines?: boolean;
}

export const ExcelRenderer: React.FC<ExcelRendererProps> = ({
  sheet,
  className = '',
  scale = 1,
  showGridlines = true
}) => {
  // Build a 2D grid for easy cell lookup
  const cellGrid = React.useMemo(() => {
    const grid: Map<string, ParsedCell> = new Map();
    sheet.cells.forEach(cell => {
      const key = `${cell.row}-${cell.col}`;
      grid.set(key, cell);
    });
    return grid;
  }, [sheet.cells]);

  // Get cell at position
  const getCell = (row: number, col: number): ParsedCell | undefined => {
    return cellGrid.get(`${row}-${col}`);
  };

  // Build style object for a cell
  const buildCellStyles = (cell: ParsedCell): React.CSSProperties => {
    const style: React.CSSProperties = {};

    if (cell.style.backgroundColor) {
      style.backgroundColor = cell.style.backgroundColor;
    }
    if (cell.style.color) {
      style.color = cell.style.color;
    }
    if (cell.style.fontFamily) {
      style.fontFamily = cell.style.fontFamily;
    }
    if (cell.style.fontSize) {
      style.fontSize = `${cell.style.fontSize * scale}pt`;
    }
    if (cell.style.fontWeight) {
      style.fontWeight = cell.style.fontWeight;
    }
    if (cell.style.fontStyle) {
      style.fontStyle = cell.style.fontStyle;
    }
    if (cell.style.textDecoration) {
      style.textDecoration = cell.style.textDecoration;
    }
    if (cell.style.textAlign) {
      style.textAlign = cell.style.textAlign;
    }
    if (cell.style.verticalAlign) {
      style.verticalAlign = cell.style.verticalAlign;
    }
    if (cell.style.wrapText) {
      style.whiteSpace = 'normal';
      style.wordWrap = 'break-word';
    } else {
      style.whiteSpace = 'nowrap';
      style.overflow = 'hidden';
    }

    // Borders
    if (cell.style.border) {
      if (cell.style.border.top) {
        style.borderTop = `${cell.style.border.top.style} ${cell.style.border.top.color || '#000'}`;
      }
      if (cell.style.border.right) {
        style.borderRight = `${cell.style.border.right.style} ${cell.style.border.right.color || '#000'}`;
      }
      if (cell.style.border.bottom) {
        style.borderBottom = `${cell.style.border.bottom.style} ${cell.style.border.bottom.color || '#000'}`;
      }
      if (cell.style.border.left) {
        style.borderLeft = `${cell.style.border.left.style} ${cell.style.border.left.color || '#000'}`;
      }
    }

    return style;
  };

  // Format cell value based on type and format
  const formatCellValue = (cell: ParsedCell): string => {
    if (cell.value === null || cell.value === undefined || cell.value === '') {
      return '';
    }

    // Handle dates
    if (cell.type === 'date') {
      const date = new Date(cell.value);
      return date.toLocaleDateString();
    }

    // Handle numbers with formatting
    if (cell.type === 'number' && cell.style.numberFormat) {
      // Basic number formatting (can be enhanced)
      const num = parseFloat(cell.value);
      if (cell.style.numberFormat.includes('%')) {
        return `${(num * 100).toFixed(2)}%`;
      }
      if (cell.style.numberFormat.includes('0.00')) {
        return num.toFixed(2);
      }
    }

    return String(cell.value);
  };

  // Render rows
  const renderRows = () => {
    const rows: React.JSX.Element[] = [];
    
    for (let rowNum = 1; rowNum <= sheet.rowCount; rowNum++) {
      const cells: React.JSX.Element[] = [];
      const rowHeight = sheet.rowHeights[rowNum - 1] || 20;

      for (let colNum = 1; colNum <= sheet.colCount; colNum++) {
        const cell = getCell(rowNum, colNum);
        const colWidth = sheet.columnWidths[colNum - 1] || 64;

        // Skip if this cell is part of a merge but not the master
        if (cell && cell.mergeInfo && !cell.mergeInfo.isMaster) {
          continue;
        }

        const cellStyles = cell ? buildCellStyles(cell) : {};
        const cellValue = cell ? formatCellValue(cell) : '';

        cells.push(
          <td
            key={`${rowNum}-${colNum}`}
            className={`excel-cell ${cell ? `cell-type-${cell.type}` : ''}`}
            style={{
              ...cellStyles,
              width: `${colWidth * scale}px`,
              minWidth: `${colWidth * scale}px`,
              maxWidth: `${colWidth * scale}px`,
              height: `${rowHeight * scale}px`,
              border: showGridlines && !cell?.style.border ? '1px solid #d0d0d0' : undefined
            }}
            rowSpan={cell?.mergeInfo?.rowSpan || 1}
            colSpan={cell?.mergeInfo?.colSpan || 1}
          >
            {cellValue}
          </td>
        );
      }

      rows.push(
        <tr key={rowNum} className="excel-row">
          {cells}
        </tr>
      );
    }

    return rows;
  };

  return (
    <div className={`excel-renderer-container ${className}`}>
      <div className="excel-sheet" data-sheet-name={sheet.name}>
        <table 
          className="excel-table" 
          cellSpacing={0} 
          cellPadding={0}
          style={{
            borderCollapse: 'collapse',
            tableLayout: 'fixed'
          }}
        >
          <tbody>{renderRows()}</tbody>
        </table>
      </div>
    </div>
  );
};

export default ExcelRenderer;
