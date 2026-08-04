/**
 * Convert a non-negative integer rupiah amount to Indonesian words.
 * Follows Indonesian number-to-words convention (satuan / puluhan / ratusan /
 * ribuan / juta / milyar / triliun). "Sebelas" for 11, "Seratus" for 100,
 * "Seribu" for 1000 (contracted from "satu ribu"), "Sepuluh" for 10.
 * Always appends " Rupiah".
 */
export function terbilangRupiah(n: number): string {
  if (n < 0) throw new Error('terbilangRupiah expects a non-negative number');
  const rounded = Math.round(n);
  if (rounded === 0) return 'Nol Rupiah';
  return capitalize(spellNumber(rounded)) + ' Rupiah';
}

const ONES = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan'];

/** Numbers < 1000. */
function under1000(n: number): string {
  if (n === 0) return '';
  if (n < 10) return ONES[n];
  if (n < 12) return n === 10 ? 'Sepuluh' : 'Sebelas';
  if (n < 20) return `${ONES[n - 10]} Belas`;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return ones === 0 ? `${ONES[tens]} Puluh` : `${ONES[tens]} Puluh ${ONES[ones]}`;
  }
  // n < 1000
  const hundreds = Math.floor(n / 100);
  const rem = n % 100;
  const hundredsPart = hundreds === 1 ? 'Seratus' : `${ONES[hundreds]} Ratus`;
  return rem === 0 ? hundredsPart : `${hundredsPart} ${under1000(rem)}`;
}

/** Any non-negative integer. */
function spellNumber(n: number): string {
  if (n < 1000) return under1000(n);

  const scales: Array<{ value: number; word: string }> = [
    { value: 1e12, word: 'Triliun' },
    { value: 1e9,  word: 'Milyar' },
    { value: 1e6,  word: 'Juta' },
    { value: 1e3,  word: 'Ribu' },
  ];
  let out = '';
  let rem = n;
  for (const { value, word } of scales) {
    if (rem >= value) {
      const count = Math.floor(rem / value);
      rem = rem % value;
      // Special case: 1000 → "Seribu" (contraction), not "Satu Ribu"
      const countWord = count === 1 && word === 'Ribu' ? 'Se' : `${spellNumber(count)} `;
      const scalePhrase = countWord === 'Se' ? 'Seribu' : `${countWord}${word}`.trim();
      out = out ? `${out} ${scalePhrase}` : scalePhrase;
    }
  }
  if (rem > 0) {
    out = out ? `${out} ${under1000(rem)}` : under1000(rem);
  }
  return out;
}

function capitalize(s: string): string {
  return s
    .split(' ')
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}
