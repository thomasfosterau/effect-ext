/**
 * Gregorian calendar arithmetic shared by the date grammars. Not part of the
 * published API (`src/index.ts` does not export it).
 *
 * @since 0.1.0
 */

// Whether `year` is a Gregorian leap year.
const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

/**
 * The number of days in `month` (1–12) of `year`.
 *
 * @since 0.1.0
 */
export const daysInMonth = (year: number, month: number): number =>
  month === 2 ? (isLeapYear(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
