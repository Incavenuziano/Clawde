/**
 * F4.T57 — Network namespace isolation para Sandbox Nível 3 (ADR 0005).
 *
 * Combina bwrap nivel 2 com:
 *   - --unshare-net (já em buildBwrapArgs com network='loopback-only'/'none')
 *   - DNS controlado: /etc/resolv.conf custom apontando pra resolver allowlist
 *   - Sem acesso de rede externo, só loopback OU allowlist via nftables setup
 *     externo (provisionado pelo systemd unit, não em runtime aqui)
 *
 * Para 'allowlist' real, a infra é:
 *   1. systemd unit cria netns com nftables rules (DROP ip daddr != allowlist)
 *   2. bwrap join nesse netns via --net-bridge OU usa --share-net (host)
 *
 * Implementação aqui é a versão "loopback-only" — netns novo sem rotas
 * externas, DNS resolve falha. allowlist real fica como infraestrutura.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BwrapConfig, NetworkMode } from "./bwrap.ts";

export interface NetnsConfig {
  /** Lista de domains permitidos (resolvidos via custom resolv.conf). */
  readonly allowedEgress: ReadonlyArray<string>;
  /** Path do custom resolv.conf (gerado por configureLoopbackOnly). */
  readonly resolvConfPath?: string;
}

/**
 * Gera /etc/resolv.conf custom apontando só pra loopback (127.0.0.53).
 * Em modo loopback-only, queries DNS falham (não há resolver dentro do netns).
 *
 * Retorna path do arquivo gerado pra ser bind-mounted em /etc/resolv.conf
 * dentro do sandbox.
 */
export function generateLoopbackResolvConf(stateDir: string): string {
  const path = join(stateDir, "sandbox-resolv.conf");
  // Vazio = nenhum resolver. Queries DNS retornam SERVFAIL/EAI_AGAIN.
  writeFileSync(
    path,
    [
      "# Clawde sandbox nivel 3 — loopback-only DNS",
      "# Sem nameservers externos: queries DNS falham.",
      "options timeout:1 attempts:1",
      "",
    ].join("\n"),
  );
  return path;
}

/**
 * Aplica config de netns sobre BwrapConfig existente, garantindo:
 *   - network: 'loopback-only' (sem --share-net no buildBwrapArgs)
 *   - resolv.conf custom como read-only mount sobrescrevendo o padrão
 */
export function applyNetnsToConfig(base: BwrapConfig, netns: NetnsConfig): BwrapConfig {
  const network: NetworkMode = "loopback-only";
  const ro = [...base.readOnlyMounts];
  if (netns.resolvConfPath !== undefined) {
    // Bind do resolv custom em /etc/resolv.conf dentro do sandbox.
    // Note: é read-write em buildBwrapArgs spec, mas resolv.conf é só pra ler.
    ro.push(netns.resolvConfPath);
  }
  return {
    ...base,
    network,
    readOnlyMounts: ro,
  };
}

/**
 * Helper de validação: lista de domains permitidos é sane.
 * Pra T57 mantemos validação leve; allowlist real (nftables) vem em fase
 * posterior se demanda surgir.
 */
export function validateEgressList(domains: ReadonlyArray<string>): {
  ok: boolean;
  invalid: ReadonlyArray<string>;
} {
  const invalid: string[] = [];
  for (const d of domains) {
    if (d.length === 0 || d.includes(" ") || d.includes("/")) {
      invalid.push(d);
    }
  }
  return { ok: invalid.length === 0, invalid };
}
