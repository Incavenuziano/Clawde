/**
 * `clawde-receiver`: daemon HTTP minimal always-on (BLUEPRINT §3, ADR 0002).
 *
 * Bun.serve em TCP (127.0.0.1:18790) + unix socket (/run/clawde/receiver.sock).
 * Roteamento simples: rotas registradas via registerRoute, despachadas por
 * (method, pathname).
 *
 * Sinais:
 *   - SIGTERM: drain (recusa novos com 503; finaliza in-flight; close DB).
 *   - SIGHUP: reload config (handler injetado pelo main).
 */

import type { Server } from "bun";
import type { Logger } from "@clawde/log";

export interface RouteContext {
  readonly request: Request;
  readonly url: URL;
  readonly remoteAddr: string;
}

export type RouteHandler = (ctx: RouteContext) => Promise<Response> | Response;

export interface RouteKey {
  readonly method: string;
  readonly path: string;
}

export interface ReceiverConfig {
  readonly listenTcp?: string; // "127.0.0.1:18790"
  readonly listenUnix?: string; // path to socket
  readonly logger: Logger;
}

export interface ReceiverHandle {
  readonly tcpServer?: Server;
  readonly unixServer?: Server;
  stop(): Promise<void>;
  setDraining(value: boolean): void;
  isDraining(): boolean;
  registerRoute(key: RouteKey, handler: RouteHandler): void;
}

function parseHostPort(addr: string): { hostname: string; port: number } {
  const lastColon = addr.lastIndexOf(":");
  const hostname = addr.slice(0, lastColon);
  const port = Number.parseInt(addr.slice(lastColon + 1), 10);
  return { hostname, port };
}

/**
 * Cria receiver. Registra rotas via handle.registerRoute antes de chamar Bun.serve.
 *
 * Uso típico:
 *   const handle = createReceiver({ listenTcp: "127.0.0.1:18790", logger });
 *   handle.registerRoute({method:"GET", path:"/health"}, healthHandler);
 *   await handle.stop(); // SIGTERM-style cleanup
 */
export function createReceiver(config: ReceiverConfig): ReceiverHandle {
  const routes = new Map<string, RouteHandler>();
  let draining = false;

  function routeKey(method: string, path: string): string {
    return `${method.toUpperCase()} ${path}`;
  }

  async function dispatch(req: Request, remoteAddr: string): Promise<Response> {
    const url = new URL(req.url);
    // Em draining, /health continua respondendo (com schema HealthDegraded).
    // Outras rotas retornam 503 simples imediatamente.
    if (draining && url.pathname !== "/health") {
      return new Response(JSON.stringify({ error: "draining" }), {
        status: 503,
        headers: { "Content-Type": "application/json", "Retry-After": "30" },
      });
    }
    const handler = routes.get(routeKey(req.method, url.pathname));
    if (handler === undefined) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    try {
      return await handler({ request: req, url, remoteAddr });
    } catch (err) {
      config.logger.error("route handler error", {
        path: url.pathname,
        error: (err as Error).message,
      });
      return new Response(JSON.stringify({ error: "internal" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  let tcpServer: Server | undefined;
  let unixServer: Server | undefined;

  if (config.listenTcp !== undefined) {
    const { hostname, port } = parseHostPort(config.listenTcp);
    tcpServer = Bun.serve({
      hostname,
      port,
      fetch: (req, server) =>
        dispatch(req, server.requestIP(req)?.address ?? "unknown"),
    });
    config.logger.info("receiver TCP listening", { addr: config.listenTcp });
  }

  if (config.listenUnix !== undefined) {
    unixServer = Bun.serve({
      unix: config.listenUnix,
      fetch: (req) => dispatch(req, "unix-socket"),
    });
    config.logger.info("receiver unix socket listening", { path: config.listenUnix });
  }

  return {
    tcpServer,
    unixServer,
    registerRoute(key: RouteKey, handler: RouteHandler): void {
      routes.set(routeKey(key.method, key.path), handler);
    },
    setDraining(value: boolean): void {
      draining = value;
      config.logger.info(value ? "receiver draining" : "receiver active");
    },
    isDraining(): boolean {
      return draining;
    },
    async stop(): Promise<void> {
      draining = true;
      // Bun.serve não tem await graceful; stop() retorna sync.
      tcpServer?.stop();
      unixServer?.stop();
      config.logger.info("receiver stopped");
    },
  };
}
