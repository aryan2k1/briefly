export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function request<T>(
  path: string,
  parser: (value: unknown) => T,
  options: {
    method?: "GET" | "POST" | "PATCH";
    body?: unknown;
    csrfToken?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.csrfToken) headers["x-csrf-token"] = options.csrfToken;
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    credentials: "same-origin",
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "The request could not be completed.";
    throw new ApiError(message, response.status);
  }
  return parser(result);
}

export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
export const unauthorized = (error: unknown) =>
  error instanceof ApiError && error.status === 401;
