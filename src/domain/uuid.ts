/**
 * UUID v5 determinístico (RFC 4122 §4.3) com namespace fixo do Clawde.
 *
 * v5 = SHA-1(namespace || name), formatado como UUID com bits de versão/variante.
 * Usado para gerar session IDs estáveis a partir de (agent, workingDir, [intent]).
 *
 * Implementação intencionalmente sem deps externas (`crypto.subtle`/`Bun.CryptoHasher`).
 */

import { createHash } from "node:crypto";

/**
 * Namespace fixo do Clawde. Gerado uma vez (UUID v4) e congelado.
 * Mudar este valor invalida todos os session IDs determinísticos previamente gerados.
 */
export const CLAWDE_UUID_NAMESPACE = "5b1f4f8e-c3c7-4f2a-8a5e-7e6c4b3d2a1f";

/**
 * Converte UUID string → 16 bytes (Uint8Array).
 */
function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) {
    throw new Error(`invalid UUID: ${uuid}`);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const slice = hex.slice(i * 2, i * 2 + 2);
    bytes[i] = Number.parseInt(slice, 16);
  }
  return bytes;
}

/**
 * Formata 16 bytes como UUID canônico (8-4-4-4-12).
 */
function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length < 16) {
    throw new Error(`expected ≥16 bytes, got ${bytes.length}`);
  }
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    const byte = bytes[i] ?? 0;
    hex.push(byte.toString(16).padStart(2, "0"));
  }
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/**
 * UUID v5: SHA-1(namespace_bytes || name_utf8), com bits de versão (5) e variante (RFC 4122).
 */
export function uuidV5(name: string, namespace: string = CLAWDE_UUID_NAMESPACE): string {
  const nsBytes = uuidToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);

  const concat = new Uint8Array(nsBytes.length + nameBytes.length);
  concat.set(nsBytes, 0);
  concat.set(nameBytes, nsBytes.length);

  const hash = createHash("sha1").update(concat).digest();
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = hash[i] ?? 0;
  }

  // Set version (5) in high nibble of byte 6.
  out[6] = ((out[6] ?? 0) & 0x0f) | 0x50;
  // Set variant (10xxxxxx, RFC 4122) in high bits of byte 8.
  out[8] = ((out[8] ?? 0) & 0x3f) | 0x80;

  return bytesToUuid(out);
}
