// Türkçe sayı biçimi (binlik nokta, ondalık virgül).
export function fmtNum(value: number, digits = 2) {
  return new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: digits,
  }).format(value);
}
