import 'dotenv/config';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';

import { prisma } from '../src/lib/prisma';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function colLetter(n: number): string {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

function buildRowXml(
  rowNum: number,
  cellStyleMap: Record<number, string>,
  values: Record<number, { v: string | number | null; type: 'n' | 's' }>,
  rowAttrs: string
): string {
  const maxCol = Math.max(...Object.keys(cellStyleMap).map(Number), ...Object.keys(values).map(Number));
  let cells = '';
  for (let c = 1; c <= maxCol; c++) {
    const ref = `${colLetter(c)}${rowNum}`;
    const sAttr = cellStyleMap[c] ? ` s="${cellStyleMap[c]}"` : '';
    const val = values[c];
    if (!val || val.v === null || val.v === undefined || val.v === '') {
      cells += `<c r="${ref}"${sAttr}/>`;
    } else if (val.type === 'n') {
      cells += `<c r="${ref}"${sAttr}><v>${val.v}</v></c>`;
    } else {
      cells += `<c r="${ref}"${sAttr} t="inlineStr"><is><t>${escapeXml(String(val.v))}</t></is></c>`;
    }
  }
  return `<row r="${rowNum}"${rowAttrs}>${cells}</row>`;
}

async function test() {
  const classAssignment = await prisma.classAssignment.findFirst({
    include: {
      teacher: { include: { user: true } },
      subject: true,
      section: { include: { enrollments: { where: { status: 'ENROLLED' }, include: { student: true } } } }
    }
  }) as any;

  if (!classAssignment) {
    console.log("No class assignment found");
    return;
  }

  const baseSubjectName = classAssignment.subject.name.replace(/\s+\d+$/, '').trim();
  const ecrTemplate = await prisma.eCRTemplate.findFirst({
    where: { OR: [{ subjectName: baseSubjectName, isActive: true }, { subjectName: classAssignment.subject.name, isActive: true }] }
  });

  if (!ecrTemplate || !fs.existsSync(ecrTemplate.filePath)) {
    console.log("No template found");
    return;
  }

  console.log("Template:", ecrTemplate.filePath);
  
  const zipBuf = fs.readFileSync(ecrTemplate.filePath);
  const zip = await JSZip.loadAsync(zipBuf);
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (!zip.file(sheetPath)) {
    const candidates = Object.keys(zip.files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/i.test(f)).sort();
    if (candidates.length > 0) sheetPath = candidates[0];
  }
  const ssFile = zip.file('xl/sharedStrings.xml');
  let ssXml = ssFile ? await ssFile.async('string') : '';
  let sheetXml = await zip.file(sheetPath)!.async('string');

  let studentListSSIdx = -1;
  let maleSSIdx = -1;
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch;
  let idx = 0;
  while ((siMatch = siRegex.exec(ssXml)) !== null) {
    const rawText = siMatch[1].replace(/<[^>]+>/g, '').trim();
    if (rawText.includes('{{STUDENT_LIST}}')) studentListSSIdx = idx; 
    if (rawText === 'MALE') maleSSIdx = idx;
    idx++;
  }
  
  console.log("SS Index for {{STUDENT_LIST}}:", studentListSSIdx);
  console.log("SS Index for MALE:", maleSSIdx);
  
  let studentListRowNum: number | null = null;
  if (studentListSSIdx >= 0) {
    const cellRe = new RegExp(`<c\\s[^>]*?r="[A-Z]+(\\d+)"[^>]*?>\\s*<v>\\s*${studentListSSIdx}\\s*<\\/v>[\\s\\S]*?<\\/c>`, 'm');
    const cm = cellRe.exec(sheetXml);
    if (cm) studentListRowNum = parseInt(cm[1]);
  }
  if (studentListRowNum === null) {
    const inlineRe = /<c\s[^>]*?r="[A-Z]+(\d+)"[^>]*?>[\s\S]*?\{\{STUDENT_LIST\}\}[\s\S]*?<\/c>/m;
    const im = inlineRe.exec(sheetXml);
    if (im) studentListRowNum = parseInt(im[1]);
  }
  
  let maleRowNum: number | null = null;
  if (maleSSIdx >= 0) {
    const cellRe = new RegExp(`<c\\s[^>]*?r="[A-Z]+(\\d+)"[^>]*?>\\s*<v>\\s*${maleSSIdx}\\s*<\\/v>[\\s\\S]*?<\\/c>`, 'm');
    const cm = cellRe.exec(sheetXml);
    if (cm) maleRowNum = parseInt(cm[1]);
  }
  
  console.log("Row Number:", studentListRowNum);
  console.log("MALE Row Number:", maleRowNum);
  
  if (studentListRowNum !== null) {
      const templateRowRe = new RegExp(`<row\\s[^>]*?r="${studentListRowNum}"([^>]*)>([\\s\\S]*?)<\\/row>`, 'm');
      const trMatch = templateRowRe.exec(sheetXml);
      console.log("Matched Template Row:", !!trMatch);
      if (trMatch) {
          console.log("Template Row attrs:", trMatch[1]);
          // console.log("Template Row Content:", trMatch[2].substring(0, 100));
      }
      
      const students = classAssignment.section.enrollments.map((e: any) => e.student);
      const newRows: string[] = [];
      students.forEach((student: any, i: number) => {
        const rn = studentListRowNum! + i;
        const vals: Record<number, { v: string | number | null; type: 'n' | 's' }> = {
          1: { v: i + 1, type: 'n' },
          2: { v: student.lrn, type: 's' },
          3: { v: student.lastName, type: 's' },
          4: { v: 100, type: 'n' },
        };
        newRows.push(buildRowXml(rn, {}, vals, ''));
      });
      console.log("Sample new row:", newRows[0]);
  }
}

test().catch(console.error).finally(() => prisma.$disconnect());
