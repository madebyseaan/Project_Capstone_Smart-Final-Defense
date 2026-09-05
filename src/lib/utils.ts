import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const resp = (err as { response?: { data?: { message?: string } } }).response;
    if (resp?.data?.message) return resp.data.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function getAcronym(name: string): string {
  // Replace "high school" or "highschool" with a special marker that becomes "HS"
  const processedName = name.replace(/high\s*school/gi, 'HSPLACEHOLDER');
  
  const stopWords = new Set(['of', 'the', 'a', 'an', 'and', 'for', 'in', 'on', 'at', 'to', 'by', 'or', 'de', 'del', 'ng', 'sa']);
  const words = processedName.split(/\s+/).filter(w => w.length > 0 && !stopWords.has(w.toLowerCase()));
  
  if (words.length === 0) return name.toUpperCase();
  
  return words.map(w => {
    if (w === 'HSPLACEHOLDER') return 'HS';
    return w[0].toUpperCase();
  }).join('');
}
