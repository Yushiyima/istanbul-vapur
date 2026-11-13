/**
 * Tüm denge sayıları burada. Kod içine sihirli sayı gömme.
 * Mesafeler metre cinsindendir.
 */

export const PIER = {
  /** Tıklanan nokta kıyıdan bundan uzaksa iskele konmaz. */
  maxSnapDistanceM: 300,
  /** İki iskele arası en az mesafe. */
  minSpacingM: 400,
  /** Yanaşma noktası kıyıdan su tarafına bu kadar içeride. */
  dockOffsetM: 30,
  /** Yürüme kapsama yarıçapı. */
  coverageRadiusM: 800,
  /** Yeni iskele bir tarihi iskeleye bu kadar yakınsa onun adını/özelliğini alır. */
  historicMatchRadiusM: 150,
  /** Tarihi iskele koordinatı kıyıdan bundan uzaksa konsola uyarı basılır. */
  historicWarnDistanceM: 150,
  /** Başlangıç yanaşma yeri sayısı (Aşama 2+). */
  initialBerths: 2,
} as const;

export const UI = {
  toastDurationMs: 2600,
  coverageCircleSteps: 64,
} as const;
