declare module 'xlsx-populate' {
  interface Cell {
    value(): any;
    value(val: any): Cell;
    clear(): Cell;
    rowNumber(): number;
    columnNumber(): number;
  }

  interface Row {
    cell(colNum: number): Cell;
  }

  interface Range {
    forEach(callback: (cell: Cell) => void): void;
    startCell(): Cell;
    endCell(): Cell;
  }

  interface Sheet {
    row(rowNum: number): Row;
    usedRange(): Range | undefined;
    name(): string;
    cell(addr: string): Cell;
  }

  interface Workbook {
    sheet(index: number | string): Sheet;
    outputAsync(): Promise<Buffer>;
  }

  namespace XlsxPopulate {
    function fromFileAsync(path: string): Promise<Workbook>;
    function fromDataAsync(data: Buffer): Promise<Workbook>;
  }

  export = XlsxPopulate;
}
