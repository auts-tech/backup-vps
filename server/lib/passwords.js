import { randomInt } from "crypto";

// Upper, lower, digit and symbol, so MySQL's validate_password (MEDIUM/STRONG) and
// MariaDB's simple_password_check accept it. Symbols are limited to - _ . because
// they need no quoting in .env files, SQL strings, URLs or my.cnf.
const SETS = [
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "abcdefghijkmnopqrstuvwxyz",
  "23456789",
  "-_.",
];
const ALL = SETS.join("");
const pick = (set) => set[randomInt(set.length)];

export function strongPassword(length = 24) {
  const size = Math.max(length, 12);
  // Two characters from every class, the rest from all of them
  const chars = SETS.flatMap((set) => [pick(set), pick(set)]);
  while (chars.length < size) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  // Never start with a symbol (a leading "-" reads like a command-line flag)
  const first = chars.findIndex((c) => /[A-Za-z0-9]/.test(c));
  [chars[0], chars[first]] = [chars[first], chars[0]];
  return chars.join("");
}
