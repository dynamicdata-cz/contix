# Monitoring

| Endpoint | Přístup | Obsah |
|---|---|---|
| `GET /api/health` | veřejný | `{"status":"ok","db":true,"version":…}`; 503 při výpadku DB – pro load balancer / uptime monitor |
| `GET /api/metrics` | `Authorization: Bearer $METRICS_TOKEN`; v Caddy blokováno | metriky Prometheus |
| Administrace → Provoz | `admin:settings` | stav DB, záloh, plánovače, upozornění, Wazuh, AI, APP_SECRET; historie záloh |

## Metriky

`contix_info{version}`, `contix_uptime_seconds`, `contix_db_up`, `contix_db_size_bytes`, `contix_db_latency_ms`,
`contix_backup_last_success_timestamp_seconds`, `contix_backup_last_size_bytes`,
`contix_scheduler_last_run_timestamp_seconds`, `contix_check_status{check}` (0 ok, 1 varování, 2 chyba, −1 vypnuto),
`contix_records{kind}`.

## Prometheus

```yaml
scrape_configs:
  - job_name: contix
    metrics_path: /api/metrics
    authorization: { credentials: "<METRICS_TOKEN>" }
    static_configs: [{ targets: ["api:3000"] }]   # z docker sítě contix_default
```

## Doporučená upozornění

```yaml
- alert: ContixBackupMissing
  expr: time() - contix_backup_last_success_timestamp_seconds > 26 * 3600
- alert: ContixDown
  expr: up{job="contix"} == 0 or contix_db_up == 0
- alert: ContixSchedulerStalled
  expr: time() - contix_scheduler_last_run_timestamp_seconds > 45 * 60
```

Wazuh: logy kontejnerů (JSON z Caddy, stdout API) lze sbírat Wazuh agentem na hostiteli (`/var/lib/docker/containers/*/*.log`).
