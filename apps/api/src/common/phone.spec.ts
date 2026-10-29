import { looksLikePhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['012 345 678', '85512345678'],
    ['012345678', '85512345678'],
    ['+855 12 345 678', '85512345678'],
    ['(+855) 12-345-678', '85512345678'],
    ['85512345678', '85512345678'],
    ['00855 12 345 678', '85512345678'],
    ['096 7777 888', '855967777888'],
    ['+66 81 234 5678', '66812345678'],
  ])('%s -> %s', (input, out) => expect(normalizePhone(input)).toBe(out));

  it('rejects things that are not phone numbers', () => {
    expect(normalizePhone('admin@x.com')).toBeNull();
    expect(normalizePhone('E0001')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('tells phone numbers from employee IDs and emails', () => {
    expect(looksLikePhone('012 345 678')).toBe(true);
    expect(looksLikePhone('+85512345678')).toBe(true);
    expect(looksLikePhone('E0001')).toBe(false);
    expect(looksLikePhone('1001')).toBe(false);
    expect(looksLikePhone('a@b.com')).toBe(false);
  });
});
