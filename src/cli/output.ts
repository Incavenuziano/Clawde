/**
 * Output helpers para CLI: text vs json. Stdout = dados; stderr = mensagens humanas.
 * Nunca misturar (BLUEPRINT §6.2).
 */

export type OutputFormat = "text" | "json";

export function emit(
  format: OutputFormat,
  data: unknown,
  textRender?: (d: unknown) => string,
): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const text = textRender !== undefined ? textRender(data) : String(data);
  process.stdout.write(`${text}\n`);
}

export function emitErr(message: string): void {
  process.stderr.write(`${message}\n`);
}
