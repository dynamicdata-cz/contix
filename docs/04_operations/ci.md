# GitLab CI

Pipeline (`.gitlab-ci.yml`) běží při každém pushi:

| Fáze | Úloha | Obsah |
|---|---|---|
| check | `typecheck` | TypeScript všech balíčků |
| check | `test` | unit a integrační testy API proti PostgreSQL (služba `pgvector/pgvector:pg17`), JUnit report |
| e2e | `e2e` | Playwright – přihlášení, aktiva, rizika, SoA, průchod všemi stránkami menu, odhlášení (obraz `mcr.microsoft.com/playwright`) |
| build | `build` | sestavení webu |

Výsledky testů se zobrazí v detailu pipeline (záložka Tests); u `e2e` je při chybě ke stažení HTML report
a trace (`playwright-report/`, `test-results/`).

## Runner (jednorázově)

Pipeline potřebuje **GitLab Runner s Docker executorem**. Pro test stačí na serveru s Dockerem (např. `contix-test`):

1. GitLab → projekt **<skupina>/contix → Settings → CI/CD → Runners → New project runner**
   (platforma Linux, „Run untagged jobs“) → zkopírujte token `glrt-…`.
2. Na serveru:

```bash
sudo docker run -d --name gitlab-runner --restart always \
  -v /srv/gitlab-runner/config:/etc/gitlab-runner \
  -v /var/run/docker.sock:/var/run/docker.sock \
  gitlab/gitlab-runner:latest

sudo docker exec -it gitlab-runner gitlab-runner register --non-interactive \
  --url http://192.0.2.5 \
  --token glrt-XXXXXXXX \
  --executor docker --docker-image oven/bun:1 --description "contix-docker"
```

`--url` = adresa webového rozhraní GitLabu (ta, kterou otevíráte v prohlížeči, ne SSH port 2222).
Runner musí stahovat obrazy z Docker Hubu a `mcr.microsoft.com`.

3. Kontrola: Settings → CI/CD → Runners – runner je zelený; spusťte pipeline (Build → Pipelines → Run pipeline).

> Runner spouští kód z repozitáře s přístupem k Dockeru na hostiteli – u zákazníka ho na produkční server CONTIX
> neinstalujte; testovací server je v pořádku.

## Lokálně

```bash
bun run typecheck
TEST_DATABASE_URL=postgres://contix:contix@localhost:5432/contix_test bun test
E2E_DATABASE_URL=postgres://contix:contix@localhost:5432/contix_e2e bun run e2e   # databáze *_e2e se vyprázdní
```

Prohlížeč pro e2e: `bunx playwright install chromium` (jednou).

## GitHub Actions (veřejný repozitář, v1.15)

Veřejný repozitář má obdobu této pipeline v `.github/workflows/ci.yml` (kontrola typů, unit + integrační testy s PostgreSQL,
e2e v obrazu Playwright, build) – běží na runnerech GitHubu, nic se nenastavuje. Soubor `.gitlab-ci.yml` se do veřejného
repozitáře nepřenáší (`export-ignore` v `.gitattributes`).

Zveřejnění vydání z interního repozitáře:

```bash
git clone git@github.com:dynamicdata-cz/contix.git ~/contix-public        # jednou
mkdir -p ~/.config/contix && $EDITOR ~/.config/contix/publish-deny.txt  # interní IP, servery, zákazníci – jeden na řádek
infra/scripts/publish.sh ~/contix-public            # export → kontrola → commit „CONTIX <verze>“ + tag v<verze>
git -C ~/contix-public push origin HEAD --follow-tags   # po kontrole (nebo rovnou volbou --push)
```

Kontrola (`apps/api/src/scripts/publish-scan.ts`) zastaví zveřejnění při nálezu tokenů, soukromých klíčů, souborů `.env`,
hesel v konfiguraci nebo položek z lokálního seznamu zákazů. Seznam zákazů do repozitáře nepatří – zveřejnil by právě to, co chrání.
