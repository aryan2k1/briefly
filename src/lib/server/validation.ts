import { AppError } from "./errors.ts";
export function uuid(value: unknown, label = "Identifier"): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    throw new AppError(400, `${label} is invalid`);
  return value;
}
export function text(
  value: unknown,
  label: string,
  max: number,
  required = true,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim())
  )
    throw new AppError(
      400,
      `${label} must contain ${required ? "1" : "0"}–${max} characters`,
    );
  return value.trim();
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(400, "Expected a JSON object");
  return value as Record<string, unknown>;
}
export function fields(value: unknown, allowed: string[]) {
  const input = object(value);
  if (Object.keys(input).some((k) => !allowed.includes(k)))
    throw new AppError(400, "Unexpected input field");
  return input;
}
export function email(value: unknown) {
  const result = text(value, "Email", 254, false);
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    throw new AppError(400, "Email is invalid");
  return result;
}
export function version(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new AppError(400, "A positive record version is required");
  return Number(value);
}
