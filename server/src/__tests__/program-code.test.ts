import { describe, expect, it } from 'vitest';
import { normalizeProgramCode } from '../lib/programCode';

describe('normalizeProgramCode', () => {
  it('maps known DepEd programs to canonical codes', () => {
    expect(normalizeProgramCode('Regular')).toBe('REGULAR');
    expect(normalizeProgramCode('Special Program in the Arts')).toBe('SPA');
    expect(normalizeProgramCode('Special Program in Sports')).toBe('SPS');
    expect(normalizeProgramCode('Science, Technology and Engineering')).toBe('STE');
    expect(normalizeProgramCode('STE')).toBe('STE');
    expect(normalizeProgramCode('Special Program in Foreign Language')).toBe('SPFL');
    expect(normalizeProgramCode('Special Program in Journalism')).toBe('SPJ');
    expect(normalizeProgramCode('Special Education')).toBe('SPED');
    expect(normalizeProgramCode('Open High School Program')).toBe('OHSP');
  });

  it('preserves unknown upstream programs instead of collapsing to REGULAR', () => {
    expect(normalizeProgramCode('ROBOTICS')).toBe('ROBOTICS');
    expect(normalizeProgramCode('Special Program in Robotics')).toBe('SPR');
  });

  it('falls back to REGULAR for empty values', () => {
    expect(normalizeProgramCode(null)).toBe('REGULAR');
    expect(normalizeProgramCode('   ')).toBe('REGULAR');
  });
});
