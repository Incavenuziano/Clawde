import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  HARDENING_DIRECTIVES,
  renderPathUnit,
  renderServiceUnit,
  renderTimerUnit,
} from "@clawde/sandbox";

describe("sandbox/systemd renderServiceUnit", () => {
  test("inclui hardening completo (ADR 0005 nivel 1)", () => {
    const content = renderServiceUnit({
      name: "clawde-worker",
      description: "Worker test",
      execStart: "/usr/bin/echo ok",
      readWritePaths: ["/var/lib/clawde"],
    });
    for (const directive of HARDENING_DIRECTIVES) {
      expect(content).toContain(directive);
    }
    expect(content).toContain("ReadWritePaths=/var/lib/clawde");
    expect(content).toContain("ExecStart=/usr/bin/echo ok");
    expect(content).toContain("[Install]");
  });

  test("Type default oneshot", () => {
    const content = renderServiceUnit({
      name: "x",
      description: "x",
      execStart: "/bin/true",
    });
    expect(content).toContain("Type=oneshot");
  });

  test("Type custom respeitado", () => {
    const content = renderServiceUnit({
      name: "x",
      description: "x",
      execStart: "/bin/true",
      type: "simple",
    });
    expect(content).toContain("Type=simple");
  });

  test("After incluído quando fornecido", () => {
    const content = renderServiceUnit({
      name: "x",
      description: "x",
      execStart: "/bin/true",
      after: ["network.target", "clawde-receiver.service"],
    });
    expect(content).toContain("After=network.target clawde-receiver.service");
  });
});

describe("sandbox/systemd renderPathUnit + renderTimerUnit", () => {
  test("renderPathUnit gera Path section com PathChanged + Unit", () => {
    const content = renderPathUnit({
      name: "clawde-worker",
      description: "Worker trigger",
      pathChanged: "%h/.clawde/state.db",
      serviceUnit: "clawde-worker.service",
    });
    expect(content).toContain("[Path]");
    expect(content).toContain("PathChanged=%h/.clawde/state.db");
    expect(content).toContain("Unit=clawde-worker.service");
  });

  test("renderTimerUnit gera Timer section com OnCalendar", () => {
    const content = renderTimerUnit({
      name: "clawde-smoke",
      description: "Daily smoke",
      onCalendar: "*-*-* 04:00:00",
      serviceUnit: "clawde-smoke.service",
      persistent: true,
    });
    expect(content).toContain("[Timer]");
    expect(content).toContain("OnCalendar=*-*-* 04:00:00");
    expect(content).toContain("Persistent=true");
  });

  test("Persistent default false", () => {
    const content = renderTimerUnit({
      name: "x",
      description: "x",
      onCalendar: "hourly",
      serviceUnit: "x.service",
    });
    expect(content).toContain("Persistent=false");
  });
});

describe("deploy/systemd unit files reais", () => {
  function readUnit(name: string): string {
    return readFileSync(join(import.meta.dirname, "../../../deploy/systemd", name), "utf-8");
  }

  test("clawde-worker.service tem hardening completo", () => {
    const content = readUnit("clawde-worker.service");
    expect(content).toContain("PrivateTmp=yes");
    expect(content).toContain("NoNewPrivileges=yes");
    expect(content).toContain("MemoryDenyWriteExecute=yes");
    expect(content).toContain("ReadWritePaths=%h/.clawde /tmp");
  });

  test("clawde-worker.path watcha queue.signal fallback", () => {
    const content = readUnit("clawde-worker.path");
    expect(content).toContain("PathChanged=%h/.clawde/run/queue.signal");
    expect(content).toContain("Unit=clawde-worker.service");
  });

  test("clawde-smoke.timer roda 04:00 diariamente", () => {
    const content = readUnit("clawde-smoke.timer");
    expect(content).toContain("OnCalendar=*-*-* 04:00:00");
    expect(content).toContain("Persistent=true");
  });

  test("clawde-integrity.timer roda 02:30 diariamente", () => {
    const content = readUnit("clawde-integrity.timer");
    expect(content).toContain("OnCalendar=*-*-* 02:30:00");
    expect(content).toContain("Unit=clawde-integrity.service");
  });

  test("clawde-integrity.service chama diagnose db json", () => {
    const content = readUnit("clawde-integrity.service");
    expect(content).toContain("ExecStart=%h/.clawde/dist/clawde diagnose db --output json");
  });

  test("clawde-events-retention.timer roda mensal dia 1 às 04:00", () => {
    const content = readUnit("clawde-events-retention.timer");
    expect(content).toContain("OnCalendar=*-*-01 04:00:00");
    expect(content).toContain("Unit=clawde-events-retention.service");
  });

  test("clawde-events-retention.service exporta e purga com abort em falha", () => {
    const content = readUnit("clawde-events-retention.service");
    expect(content).toContain("clawde events export --since-cutoff 90d &&");
    expect(content).toContain("clawde events purge --before $(date -d '90 days ago' -I) --confirm");
  });

  test("clawde-backup-hourly.timer roda hourly", () => {
    const content = readUnit("clawde-backup-hourly.timer");
    expect(content).toContain("OnCalendar=hourly");
    expect(content).toContain("Unit=clawde-backup-hourly.service");
  });

  test("clawde-backup-daily.timer roda diariamente às 03:00", () => {
    const content = readUnit("clawde-backup-daily.timer");
    expect(content).toContain("OnCalendar=*-*-* 03:00:00");
    expect(content).toContain("Unit=clawde-backup-daily.service");
  });

  test("clawde-backup-weekly.timer roda domingos às 03:30", () => {
    const content = readUnit("clawde-backup-weekly.timer");
    expect(content).toContain("OnCalendar=Sun *-*-* 03:30:00");
    expect(content).toContain("Unit=clawde-backup-weekly.service");
  });

  test("backup services executam snapshot + prune", () => {
    const hourly = readUnit("clawde-backup-hourly.service");
    const daily = readUnit("clawde-backup-daily.service");
    const weekly = readUnit("clawde-backup-weekly.service");

    expect(hourly).toContain("backup-snapshot.sh %h/.clawde/backups/hourly/");
    expect(hourly).toContain("backup-prune.sh %h/.clawde/backups/");

    expect(daily).toContain("backup-snapshot.sh %h/.clawde/backups/daily/");
    expect(daily).toContain("backup-prune.sh %h/.clawde/backups/");

    expect(weekly).toContain("backup-snapshot.sh %h/.clawde/backups/weekly/");
    expect(weekly).toContain("backup-prune.sh %h/.clawde/backups/");
  });

  test("backup scripts têm exec bit", () => {
    const snapshotPath = join(import.meta.dirname, "../../../scripts/backup-snapshot.sh");
    const prunePath = join(import.meta.dirname, "../../../scripts/backup-prune.sh");
    expect(statSync(snapshotPath).mode & 0o111).toBeGreaterThan(0);
    expect(statSync(prunePath).mode & 0o111).toBeGreaterThan(0);
  });
});
