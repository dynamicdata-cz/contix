# GitLab CI

Pipeline (`.gitlab-ci.yml`) běží při každém pushi:

| Fáze | Úloha | Obsah |
|---|---|---|
| check | `typecheck` | TypeScript všech balíčků (včetně testů) |
| check | `audit` | známé zranitelnosti závislostí – vysoká a kritická zastaví pipeline (`bun audit --audit-level=high`) |
| check | `test` | unit a integrační testy API proti PostgreSQL (služba `pgvector/pgvector:pg17`), JUnit report |
| e2e | `e2e` | Playwright – přihlášení, aktiva, rizika, SoA, průchod všemi stránkami menu, odhlášení (obraz `mcr.microsoft.com/playwright`) |
| build | `build` | sestavení webu a SBOM vydání `contix.cdx.json` (CycloneDX 1.6) jako artefakt |

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

## Zveřejnění vydání na GitHub (ADR-112, ADR-178)

GitLab je hlavní repozitář, GitHub dostává jen vydání (čistá historie, jeden commit s tagem na vydání).

**Postup vydání**

1. Verze v `packages/shared/src/ops.ts` a sekce v `CHANGELOG.md`, commit, push do GitLabu.
2. Tag vydání v GitLabu: `git tag -a v1.83.0 -m "CONTIX 1.83.0" && git push gitlab v1.83.0`
   (tag musí odpovídat verzi v `ops.ts`, jinak `publish.sh` skončí).
3. Pipeline tagu projde testy; v Build → Pipelines spusťte ručně úlohu **publish**. Export, kontrola a push na GitHub
   proběhnou skriptem `infra/scripts/publish.sh --require-deny --push`.
4. Na GitHubu vytvořte z tagu Release (poznámky = sekce z CHANGELOG).

**Nastavení CI (jednou)**

- GitHub → `dynamicdata-cz/contix` → Settings → Deploy keys → nový klíč `ssh-keygen -t ed25519 -C contix-publish`
  s **Allow write access** (jen tento repozitář).
- GitLab → Settings → Repository → Protected tags: `v*` (vytvářet smí jen Maintainer).
- GitLab → Settings → CI/CD → Variables (Protected, Masked kde jde):
  `GITHUB_DEPLOY_KEY` (typ File, soukromý klíč), `GITHUB_KNOWN_HOSTS` (řádek `github.com ssh-ed25519 …` ze zveřejněných
  otisků GitHubu), `CONTIX_PUBLISH_DENY` (typ File, seznam zákazů), `PUBLISH_NAME`, `PUBLISH_EMAIL`.
- Runner musí mít odchozí přístup na `github.com` port 22.

**Ručně (bez CI, např. první dohnání)**

```bash
git clone git@github.com:dynamicdata-cz/contix.git ~/contix-public        # jednou
mkdir -p ~/.config/contix && $EDITOR ~/.config/contix/publish-deny.txt  # interní IP, servery, zákazníci – jeden na řádek
infra/scripts/publish.sh ~/contix-public --ref v1.83.0 --require-deny     # export → kontrola → commit + tag
git -C ~/contix-public show --stat                                        # kontrola
git -C ~/contix-public push origin HEAD --follow-tags
```

Mezilehlé verze se nezveřejňují – veřejná historie přeskočí na nové vydání (změny jsou v `CHANGELOG.md`).

**Další repozitáře** (`contix-agent`): stejný skript s `--source ../contix-agent --ref v<verze>` (verze jen z tagu),
cíl `git@github.com:dynamicdata-cz/contix-agent.git`.

**Příspěvky z GitHubu** (issue, PR) se převezmou do GitLabu (`git am` / ručně) a vyjdou v dalším vydání; ve veřejném
repozitáři se nic nemerguje.

Kontrola (`apps/api/src/scripts/publish-scan.ts`) zastaví zveřejnění při nálezu tokenů, soukromých klíčů, souborů `.env`,
hesel v konfiguraci nebo položek ze seznamu zákazů. Seznam zákazů do repozitáře nepatří – zveřejnil by právě to, co chrání.
