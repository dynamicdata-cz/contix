#!/usr/bin/env python3
"""CONTIX – sonda bezpečnostních testů (v1.56, ADR-153), např. na Kali Linuxu.

Sonda se pravidelně ptá CONTIXu na úlohy. Úloha obsahuje jen ID testu, cíle a porty – příkaz si sonda
sestaví sama z vlastního katalogu níže (CONTIX nemůže sondě poslat libovolný příkaz). Cíle se ověřují
(IP, CIDR, název serveru, URL), argumenty se předávají bez shellu. Výstup nástroje jde zpět do CONTIXu,
kde se vyhodnotí.

Použití:
    python3 contix-probe.py --tools     vypíše dostupné nástroje
    python3 contix-probe.py --once      jeden dotaz na úlohu (a její provedení)
    python3 contix-probe.py --loop      běží trvale (služba systemd contix-probe)

Konfigurace: /etc/contix-probe.env (CONTIX_URL, CONTIX_TOKEN, CONTIX_CA) nebo proměnné prostředí.
Vyžaduje Python 3.6+; nástroje: nmap, testssl.sh, ssh-audit, nikto, netexec (v Kali jsou).
"""
import datetime
import http.cookies
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

VERSION = "1.1"
POLL_SECONDS = 30
MAX_OUT = 6 * 1024 * 1024

IPV4 = re.compile(r"^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$")
CIDR = re.compile(r"^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}/(1[6-9]|2\d|3[0-2])$")
HOST = re.compile(r"^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$")
URL = re.compile(r"^https?://[a-zA-Z0-9.-]+(:\d{1,5})?(/[^\s]*)?$")


def which(*names):
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    return None


TOOLS = {
    "nmap": lambda: which("nmap"),
    "testssl": lambda: which("testssl", "testssl.sh"),
    "ssh-audit": lambda: which("ssh-audit"),
    "nikto": lambda: which("nikto"),
    "netexec": lambda: which("nxc", "netexec", "crackmapexec"),
    "dig": lambda: which("dig"),
}


def tools():
    return {k: bool(f()) for k, f in TOOLS.items()}


def host_ok(t):
    return bool(IPV4.match(t) or HOST.match(t)) and not t.startswith("-")


def target_ok(t, kind):
    if t.startswith("-") or len(t) > 300:
        return False
    if kind == "url":
        return bool(URL.match(t))
    return bool(IPV4.match(t) or CIDR.match(t) or HOST.match(t))


def ports_arg(ports, default):
    p = [int(x) for x in (ports or default) if 0 < int(x) < 65536]
    return ",".join(str(x) for x in p)


def run(argv, timeout):
    t0 = time.time()
    try:
        p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, stdin=subprocess.DEVNULL)
        return p.returncode, p.stdout.decode("utf-8", "replace")[:MAX_OUT], p.stderr.decode("utf-8", "replace")[-20000:], int((time.time() - t0) * 1000)
    except subprocess.TimeoutExpired:
        return 124, "", "časový limit %ss vypršel" % timeout, int((time.time() - t0) * 1000)


def out(target, port, code, stdout, stderr, ms):
    return {"target": target, "port": port, "exitCode": code, "stdout": stdout, "stderr": stderr, "durationMs": ms}


def with_tempfile(suffix, fn):
    d = tempfile.mkdtemp(prefix="contix-")
    path = os.path.join(d, "out" + suffix)
    try:
        code, so, se, ms = fn(path)
        data = ""
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                data = f.read(MAX_OUT)
        return code, data, (se or so)[-20000:], ms
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ---------- testy (jediný seznam toho, co sonda smí spustit) ----------
def t_net_ports(targets, ports):
    code, so, se, ms = run([TOOLS["nmap"](), "-Pn", "-sT", "--top-ports", "1000", "-T3", "--open", "-oX", "-"] + targets, 7200)
    return [out(",".join(targets), None, code, so, se, ms)]


def t_net_services(targets, ports):
    p = ports_arg(ports, [21, 22, 25, 80, 110, 143, 443, 445, 3306, 3389, 5432, 8080, 8443])
    code, so, se, ms = run([TOOLS["nmap"](), "-Pn", "-sT", "-sV", "--version-light", "-p", p, "--open", "-oX", "-"] + targets, 7200)
    return [out(",".join(targets), None, code, so, se, ms)]


def t_win_smb(targets, ports):
    code, so, se, ms = run([TOOLS["nmap"](), "-Pn", "-sT", "-p", "445", "--script", "smb2-security-mode,smb-protocols", "-oX", "-"] + targets, 3600)
    return [out(",".join(targets), 445, code, so, se, ms)]


def expand_hosts(targets):
    """Testy po jednom hostiteli nepřijímají rozsahy CIDR."""
    return [t for t in targets if host_ok(t)]


def t_tls(targets, ports):
    res = []
    for h in expand_hosts(targets):
        for port in ports or [443]:
            code, data, se, ms = with_tempfile(".json", lambda path: run([TOOLS["testssl"](), "--quiet", "--color", "0", "--warnings", "off", "--jsonfile", path, "%s:%d" % (h, int(port))], 1800))
            res.append(out(h, int(port), code, data, se, ms))
    return res


def t_ssh(targets, ports):
    res = []
    for h in expand_hosts(targets):
        for port in ports or [22]:
            code, so, se, ms = run([TOOLS["ssh-audit"](), "-j", "-p", str(int(port)), h], 300)
            res.append(out(h, int(port), code, so, se, ms))
    return res


def t_nikto(targets, ports):
    res = []
    for u in targets:
        code, data, se, ms = with_tempfile(".json", lambda path: run([TOOLS["nikto"](), "-h", u, "-Format", "json", "-o", path, "-ask", "no", "-nointeractive", "-maxtime", "900s"], 1200))
        res.append(out(u, None, code, data, se, ms))
    return res


def t_null(targets, ports):
    res = []
    for h in expand_hosts(targets):
        code, so, se, ms = run([TOOLS["netexec"](), "smb", h, "-u", "", "-p", "", "--shares"], 300)
        res.append(out(h, 445, code, so, se, ms))
    return res


def t_ldap(targets, ports):
    res = []
    for h in expand_hosts(targets):
        code, so, se, ms = run([TOOLS["netexec"](), "ldap", h], 300)
        res.append(out(h, 389, code, so, se, ms))
    return res


def nmap_scripts(targets, ports, default_ports, scripts, udp=False, timeout=3600):
    argv = [TOOLS["nmap"](), "-Pn"]
    if udp:
        argv += ["-sU", "--privileged"]
    else:
        argv += ["-sT"]
    argv += ["-p", ports_arg(ports, default_ports), "--script", scripts, "-oX", "-"] + targets
    code, so, se, ms = run(argv, timeout)
    return [out(",".join(targets), None, code, so, se, ms)]


def t_net_udp(targets, ports):
    code, so, se, ms = run([TOOLS["nmap"](), "-Pn", "-sU", "--privileged", "--top-ports", "50", "-T3", "--open", "-oX", "-"] + targets, 7200)
    return [out(",".join(targets), None, code, so, se, ms)]


def t_win_rdp(targets, ports):
    return nmap_scripts(targets, ports, [3389], "rdp-enum-encryption")


def t_svc_ftp(targets, ports):
    return nmap_scripts(targets, ports, [21], "ftp-anon,ftp-syst")


def t_svc_smtp(targets, ports):
    return nmap_scripts(targets, ports, [25, 587], "smtp-commands,smtp-open-relay")


def t_svc_db(targets, ports):
    return nmap_scripts(targets, ports, [1433, 3306, 6379, 9200, 27017], "mysql-empty-password,ms-sql-empty-password,mongodb-info,redis-info,http-title")


def t_svc_snmp(targets, ports):
    return nmap_scripts(targets, ports, [161], "snmp-sysdescr", udp=True)


def t_svc_nfs(targets, ports):
    return nmap_scripts(targets, ports, [111, 2049], "nfs-showmount")


def t_svc_vnc(targets, ports):
    return nmap_scripts(targets, ports, [5900, 5901], "vnc-info")


def t_dns_axfr(targets, ports):
    res = []
    dig = TOOLS["dig"]()
    for zone in targets:
        if not HOST.match(zone) or IPV4.match(zone):
            res.append(out(zone, 53, 2, "", "cíl musí být název domény", 0))
            continue
        code, so, se, ms = run([dig, "+short", "NS", zone], 60)
        nss = [l.strip().rstrip(".") for l in so.splitlines() if HOST.match(l.strip().rstrip("."))][:6]
        parts = []
        total = ms
        for ns in nss:
            c2, s2, e2, m2 = run([dig, "axfr", zone, "@" + ns, "+time=10", "+tries=1"], 60)
            total += m2
            parts.append(";; NS %s\n%s" % (ns, s2[:200000]))
        res.append(out(zone, 53, code, "\n".join(parts), se if not nss else "", total))
    return res


SENSITIVE_PATHS = [
    "/.git/HEAD", "/.env", "/.svn/entries", "/.DS_Store", "/server-status", "/phpinfo.php", "/info.php",
    "/actuator/env", "/actuator/heapdump", "/backup.zip", "/backup.sql", "/wp-config.php.bak", "/config.php.bak",
    "/.htpasswd", "/phpmyadmin/", "/adminer.php", "/.well-known/security.txt", "/crossdomain.xml",
    "/elmah.axd", "/trace.axd", "/WEB-INF/web.xml",
]


def t_web_paths(targets, ports):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), NoRedirect)
    res = []
    for u in targets:
        t0 = time.time()
        base = re.match(r"^(https?://[^/]+)", u).group(1)
        o = {"url": base + "/", "checks": []}
        for path in SENSITIVE_PATHS:
            req = urllib.request.Request(base + path, method="GET", headers={"User-Agent": "contix-probe/" + VERSION, "Range": "bytes=0-4095"})
            try:
                try:
                    r = opener.open(req, timeout=15)
                except urllib.error.HTTPError as e:
                    r = e
                status = r.status if hasattr(r, "status") else r.code
                body = r.read(4096) if status in (200, 206) else b""
                o["checks"].append({"path": path, "status": 200 if status == 206 else status, "size": len(body), "snippet": body[:1500].decode("utf-8", "replace")})
            except Exception as e:
                if not o["checks"]:
                    o["error"] = str(e)[:300]
                    break
        res.append(out(u, None, 0, json.dumps(o, ensure_ascii=False), "", int((time.time() - t0) * 1000)))
    return res


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def fetch_headers(url, ctx):
    req = urllib.request.Request(url, method="GET", headers={"User-Agent": "contix-probe/" + VERSION})
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), NoRedirect)
    try:
        r = opener.open(req, timeout=20)
    except urllib.error.HTTPError as e:
        r = e
    hdrs = r.headers
    cookies = []
    for raw in hdrs.get_all("Set-Cookie") or []:
        low = raw.lower()
        name = raw.split("=", 1)[0].strip()
        ss = re.search(r"samesite=(\w+)", low)
        cookies.append({"name": name[:100], "secure": "; secure" in low or low.endswith("secure"), "httponly": "httponly" in low, "samesite": ss.group(1) if ss else ""})
    return r.status if hasattr(r, "status") else r.code, {k: v for k, v in hdrs.items() if k.lower() != "set-cookie"}, cookies, hdrs.get("Location")


def t_headers(targets, ports):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # kontrola hlaviček, ne certifikátu (to dělá test TLS)
    res = []
    for u in targets:
        t0 = time.time()
        o = {"url": u}
        try:
            status, headers, cookies, loc = fetch_headers(u, ctx)
            final = u
            if status in (301, 302, 303, 307, 308) and loc and loc.startswith("https://") and u.startswith("http://"):
                final = loc
                status, headers, cookies, loc = fetch_headers(loc, ctx)
            o.update({"finalUrl": final, "status": status, "headers": headers, "cookies": cookies})
            if u.startswith("https://"):
                plain = "http://" + u[len("https://"):].split("/")[0].split(":")[0] + "/"
                try:
                    st, _, _, l2 = fetch_headers(plain, ctx)
                    o["httpRedirectsToHttps"] = bool(st in (301, 302, 307, 308) and l2 and l2.startswith("https://"))
                except Exception:
                    o["httpRedirectsToHttps"] = None  # port 80 zavřený = v pořádku
        except Exception as e:
            o["error"] = str(e)[:300]
        res.append(out(u, None, 0, json.dumps(o, ensure_ascii=False), "", int((time.time() - t0) * 1000)))
    return res


TESTS = {
    "net.ports": ("host", "nmap", t_net_ports),
    "net.services": ("host", "nmap", t_net_services),
    "win.smb": ("host", "nmap", t_win_smb),
    "tls.testssl": ("host", "testssl", t_tls),
    "ssh.audit": ("host", "ssh-audit", t_ssh),
    "web.headers": ("url", None, t_headers),
    "web.nikto": ("url", "nikto", t_nikto),
    "win.null": ("host", "netexec", t_null),
    "win.ldap": ("host", "netexec", t_ldap),
    "net.udp": ("host", "nmap", t_net_udp),
    "web.paths": ("url", None, t_web_paths),
    "win.rdp": ("host", "nmap", t_win_rdp),
    "svc.ftp": ("host", "nmap", t_svc_ftp),
    "svc.smtp": ("host", "nmap", t_svc_smtp),
    "svc.db": ("host", "nmap", t_svc_db),
    "svc.snmp": ("host", "nmap", t_svc_snmp),
    "svc.nfs": ("host", "nmap", t_svc_nfs),
    "svc.vnc": ("host", "nmap", t_svc_vnc),
    "dns.axfr": ("host", "dig", t_dns_axfr),
}


# ---------- komunikace s CONTIXem ----------
def env():
    vals = {}
    try:
        with open("/etc/contix-probe.env", "r", encoding="utf-8") as f:
            for line in f:
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.split("=", 1)
                    vals[k.strip()] = v.strip().strip('"')
    except Exception:
        pass
    vals.update({k: v for k, v in os.environ.items() if k.startswith("CONTIX_")})
    return vals


def api(e, path, body):
    ctx = ssl.create_default_context(cafile=e.get("CONTIX_CA") or None)
    if e.get("CONTIX_INSECURE") == "1":
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(e["CONTIX_URL"].rstrip("/") + path, data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + e["CONTIX_TOKEN"], "User-Agent": "contix-probe/" + VERSION})
    with urllib.request.urlopen(req, context=ctx, timeout=120) as r:
        return json.loads(r.read().decode("utf-8") or "null")


def execute(job):
    test = TESTS.get(job.get("testId"))
    if not test:
        return [], "Sonda nezná test %s – aktualizujte ji instalátorem." % job.get("testId")
    kind, tool, fn = test
    targets = [str(t).strip() for t in job.get("targets") or []]
    bad = [t for t in targets if not target_ok(t, kind)]
    if bad or not targets:
        return [], "Neplatné cíle: %s" % ", ".join(bad[:5])
    if tool and not TOOLS[tool]():
        return [], "Na sondě chybí nástroj %s (apt install %s)." % (tool, {"testssl": "testssl.sh", "netexec": "netexec"}.get(tool, tool))
    try:
        ports = [int(p) for p in job.get("ports") or [] if 0 < int(p) < 65536][:100]
    except Exception:
        return [], "Neplatné porty."
    return fn(targets, ports), None


def once(e, verbose=False):
    job = api(e, "/api/public/probe/poll", {"version": VERSION, "hostname": socket.gethostname(), "tools": tools()})
    if not job or not job.get("runId"):
        if verbose:
            print("Spojení v pořádku, žádná úloha ve frontě.")
        return False
    started = datetime.datetime.now().isoformat(timespec="seconds")
    print("%s úloha %s: %s %s" % (started, job["runId"], job.get("testId"), ",".join(job.get("targets") or [])), flush=True)
    try:
        outputs, err = execute(job)
    except Exception as ex:
        outputs, err = [], "Chyba sondy: %s" % ex
    res = api(e, "/api/public/probe/result", {"runId": job["runId"], "outputs": outputs, "error": err})
    print("  → %s" % json.dumps(res, ensure_ascii=False), flush=True)
    return True


def main():
    if "--tools" in sys.argv:
        for k, v in tools().items():
            print("  %-10s %s" % (k, "ano" if v else "chybí"))
        return 0
    e = env()
    if not e.get("CONTIX_URL") or not e.get("CONTIX_TOKEN"):
        print("Chybí CONTIX_URL nebo CONTIX_TOKEN (/etc/contix-probe.env).", file=sys.stderr)
        return 2
    if "--loop" in sys.argv:
        while True:
            try:
                if not once(e):
                    time.sleep(POLL_SECONDS)
            except urllib.error.HTTPError as ex:
                print("CONTIX odmítl: HTTP %s" % ex.code, file=sys.stderr, flush=True)
                time.sleep(POLL_SECONDS * 4)
            except Exception as ex:
                print("CONTIX nedostupný: %s" % ex, file=sys.stderr, flush=True)
                time.sleep(POLL_SECONDS * 2)
    try:
        once(e, verbose=True)
        return 0
    except urllib.error.HTTPError as ex:
        print("CONTIX odmítl: HTTP %s %s" % (ex.code, ex.read().decode("utf-8", "replace")[:300]), file=sys.stderr)
        return 1
    except Exception as ex:
        print("CONTIX nedostupný: %s" % ex, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
