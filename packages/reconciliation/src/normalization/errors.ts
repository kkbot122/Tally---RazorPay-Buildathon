export type NormalizationErrorCode = "INVALID_MONEY" | "INVALID_DATE";

export class NormalizationError extends Error {
  readonly code: NormalizationErrorCode;

  constructor(code: NormalizationErrorCode, message: string) {
    super(message);
    this.name = "NormalizationError";
    this.code = code;
  }
}
