#!/usr/bin/env python3
"""CONTIX – sběrač inventáře z linuxového serveru (v1.51, ADR-148; 1.1 od CONTIXu 1.55).

Jen čte: účty (a poslední přihlášení), otisky SSH klíčů (ne celé klíče), nastavení SSH serveru, Docker kontejnery
a image, služby systemd, naslouchající porty, stav firewallu (iptables / nftables / ufw / firewalld),
čekající aktualizace a potřebu restartu. Výsledek pošle do CONTIXu.

Použití (jako root, aby šly číst authorized_keys všech účtů a pravidla firewallu):
    CONTIX_URL=https://contix.firma.cz CONTIX_TOKEN=ctxh_... python3 contix-collect.py
    python3 contix-collect.py --dry-run          # jen vypíše JSON, nic neodešle

Proměnné: CONTIX_URL, CONTIX_TOKEN (nebo soubor /etc/contix-collect.env s řádky KLÍČ=hodnota),
          CONTIX_CA (vlastní certifikační autorita), CONTIX_INSECURE=1 (neověřovat TLS – jen pro test).
Vyžaduje jen Python 3.6+ (standardní knihovna).
"""
import base64
import datetime
import hashlib
import json
import os
import platform
import re
import shutil
import socket
import ssl
import struct
import subprocess
import sys
import urllib.request

VERSION = "1.2"
NOLOGIN = ("nologin", "false", "sync", "halt", "shutdown")
KEY_TYPES = re.compile(r"^(ssh-(rsa|dss|ed25519)|ecdsa-sha2-\S+|sk-\S+@openssh\.com|ssh-ed448)$")


def run(cmd, timeout=30, ok=(0,)):
    """Výstup příkazu, nebo None (příkaz chybí / selhal)."""
    if not shutil.which(cmd[0]):
        return None
    try:
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
        return p.stdout.decode("utf-8", "replace") if p.returncode in ok else None
    except Exception:
        return None


def rc(cmd, timeout=30):
    """Návratový kód příkazu, nebo None."""
    if not shutil.which(cmd[0]):
        return None
    try:
        return subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout).returncode
    except Exception:
        return None


def read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception:
        return None


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if text is not None else None


# ---------- hostitel ----------
def host_info():
    osr = read("/etc/os-release") or ""
    pretty = re.search(r'^PRETTY_NAME="?([^"\n]*)"?', osr, re.M)
    ips = []
    out = run(["ip", "-o", "addr", "show"])
    for line in (out or "").splitlines():
        m = re.search(r"\binet6?\s+([0-9a-fA-F:.]+)/", line)
        if m and not m.group(1).startswith(("127.", "::1", "fe80")):
            ips.append(m.group(1))
    return {
        "hostname": socket.gethostname(),
        "fqdn": socket.getfqdn() or None,
        "machineId": (read("/etc/machine-id") or "").strip() or None,
        "os": pretty.group(1) if pretty else None,
        "kernel": platform.release(),
        "ips": ips[:64],
    }


# ---------- účty ----------
def users():
    groups = {}
    for line in (read("/etc/group") or "").splitlines():
        parts = line.split(":")
        if len(parts) >= 4:
            groups[parts[0]] = set(filter(None, parts[3].split(",")))
    gid_names = {}
    for line in (read("/etc/group") or "").splitlines():
        parts = line.split(":")
        if len(parts) >= 3 and parts[2].isdigit():
            gid_names[int(parts[2])] = parts[0]
    admins = set().union(*(groups.get(g, set()) for g in ("sudo", "wheel", "admin")))
    shadow = {}
    for line in (read("/etc/shadow") or "").splitlines():
        parts = line.split(":")
        if len(parts) >= 2:
            shadow[parts[0]] = parts[1]
    out = []
    for line in (read("/etc/passwd") or "").splitlines():
        p = line.split(":")
        if len(p) < 7 or not p[2].isdigit():
            continue
        name, uid, gid, home, shell = p[0], int(p[2]), int(p[3]) if p[3].isdigit() else -1, p[5], p[6]
        if uid != 0 and shell.rsplit("/", 1)[-1] in NOLOGIN:
            continue
        pw = shadow.get(name)
        out.append({
            "name": name,
            "uid": uid,
            "shell": shell,
            "home": home,
            "sudo": name in admins or gid_names.get(gid) in ("sudo", "wheel", "admin"),
            "locked": pw is not None and (pw.startswith("!") or pw in ("*", "!!", "")),
            "lastLogin": None,
            "_home": home,
        })
    return out


def last_logins():
    """Poslední přihlášení podle lastlog (chybí-li, nic)."""
    out = {}
    for line in (run(["lastlog"]) or "").splitlines()[1:]:
        p = line.split(None, 1)
        if len(p) == 2 and "**" not in p[1]:
            m = re.search(r"(\w{3} \w{3}\s+\d+ [\d:]+ [+-]?\d{4} \d{4})", p[1])
            out[p[0]] = (m.group(1) if m else p[1].strip())[-40:]
    return out


# ---------- SSH server (efektivní nastavení) ----------
def sshd():
    out = run(["sshd", "-T"]) or run(["/usr/sbin/sshd", "-T"])
    if not out:
        return None
    v = {}
    ports, allow = [], []
    for line in out.splitlines():
        k, _, val = line.strip().partition(" ")
        if k == "port" and val.isdigit():
            ports.append(int(val))
        elif k == "allowusers":
            allow.extend(val.split())
        else:
            v[k] = val.strip()
    yn = lambda k: None if k not in v else v[k].lower() == "yes"
    mat = v.get("maxauthtries")
    return {
        "permitRootLogin": v.get("permitrootlogin"),
        "passwordAuthentication": yn("passwordauthentication"),
        "permitEmptyPasswords": yn("permitemptypasswords"),
        "pubkeyAuthentication": yn("pubkeyauthentication"),
        "x11Forwarding": yn("x11forwarding"),
        "maxAuthTries": int(mat) if mat and mat.isdigit() else None,
        "ports": ports[:20],
        "allowUsers": allow[:200],
    }


# ---------- systém: běh, restart, aktualizace ----------
def system():
    up = None
    try:
        up = int(float((read("/proc/uptime") or "0").split()[0]))
    except Exception:
        pass
    booted = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=up)).isoformat() if up else None
    reboot = None
    if os.path.exists("/var/run/reboot-required"):
        reboot = True
    elif shutil.which("needs-restarting"):
        code = rc(["needs-restarting", "-r"])
        reboot = code == 1 if code is not None else None
    elif shutil.which("apt-get"):
        reboot = False
    pm, pending, security, auto, updates = None, None, None, None, []
    if shutil.which("apt-get"):
        pm = "apt"
        sim = run(["apt-get", "-s", "-o", "Debug::NoLocking=1", "upgrade"], timeout=120) or ""
        for line in sim.splitlines():
            m = re.match(r"^Inst (\S+) (?:\[[^]]*\] )?\((\S+) ([^)]*)\)", line)
            if m:
                updates.append({"name": m.group(1), "version": m.group(2), "security": "-security" in m.group(3).lower() or "security" in m.group(3).lower()})
        pending = len(updates)
        security = sum(1 for u in updates if u["security"])
        au = read("/etc/apt/apt.conf.d/20auto-upgrades") or ""
        auto = bool(re.search(r'Unattended-Upgrade\s+"1"', au)) and os.path.exists("/usr/bin/unattended-upgrade")
    elif shutil.which("dnf") or shutil.which("yum"):
        pm = "dnf" if shutil.which("dnf") else "yum"
        out = run([pm, "-q", "check-update"], timeout=180, ok=(0, 100))
        if out is not None:
            for line in out.splitlines():
                p = line.split()
                if len(p) >= 3 and "." in p[0] and not line.startswith(" "):
                    updates.append({"name": p[0], "version": p[1], "security": False})
            sec = run([pm, "-q", "updateinfo", "list", "--security"], timeout=180, ok=(0, 100)) or ""
            secpk = set(l.split()[-1] for l in sec.splitlines() if l.split())
            for u in updates:
                base = u["name"].rsplit(".", 1)[0]
                u["security"] = any(x.startswith(base + "-") for x in secpk)
            pending = len(updates)
            security = sum(1 for u in updates if u["security"])
        auto = any((run(["systemctl", "is-enabled", t]) or "").strip() == "enabled" for t in ("dnf-automatic-install.timer", "dnf-automatic.timer", "yum-cron"))
    updates.sort(key=lambda u: (not u["security"], u["name"]))
    return {"bootedAt": booted, "uptimeSeconds": up, "rebootRequired": reboot, "packageManager": pm, "updatesPending": pending, "securityUpdates": security, "autoUpdates": auto, "updates": [{k: (str(v)[:200] if k != "security" else v) for k, v in u.items()} for u in updates[:50]]}


# ---------- SSH klíče (jen otisk, typ, délka, komentář, omezení) ----------
def key_bits(ktype, blob):
    try:
        if ktype == "ssh-rsa":
            off = 0
            parts = []
            for _ in range(3):
                (n,) = struct.unpack(">I", blob[off:off + 4])
                parts.append(blob[off + 4:off + 4 + n])
                off += 4 + n
            mod = parts[2].lstrip(b"\x00")
            return len(mod) * 8 - (8 - mod[0].bit_length()) if mod else None
        if ktype == "ssh-dss":
            return 1024
        if ktype.endswith("ed25519") or "ed25519" in ktype:
            return 256
        m = re.search(r"nistp(\d+)", ktype)
        return int(m.group(1)) if m else None
    except Exception:
        return None


def split_options(text):
    opts, cur, q = [], "", False
    for ch in text:
        if ch == '"':
            q = not q
        if ch == "," and not q:
            opts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur:
        opts.append(cur)
    return [o[:300] for o in opts][:20]


def parse_key_line(line):
    tokens = line.split()
    for i, t in enumerate(tokens):
        if KEY_TYPES.match(t) and i + 1 < len(tokens):
            try:
                blob = base64.b64decode(tokens[i + 1])
            except Exception:
                return None
            fp = "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")
            opts = split_options(line[: line.find(t)].strip()) if i > 0 else []
            return {"type": t, "bits": key_bits(t, blob), "fingerprint": fp, "comment": " ".join(tokens[i + 2:])[:300], "options": opts}
    return None


def ssh_keys(accounts):
    out = []
    seen = set()
    for u in accounts:
        for fn in ("authorized_keys", "authorized_keys2"):
            path = os.path.join(u["_home"], ".ssh", fn)
            if path in seen:
                continue
            seen.add(path)
            for line in (read(path) or "").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                k = parse_key_line(line)
                if k:
                    k["user"] = u["name"]
                    out.append(k)
    return out


# ---------- Docker ----------
def docker():
    containers, images = [], []
    ps = run(["docker", "ps", "--all", "--format", "{{json .}}"])
    if ps is None:
        return containers, images
    for line in ps.splitlines():
        try:
            c = json.loads(line)
        except Exception:
            continue
        info = {}
        raw = run(["docker", "inspect", c.get("ID", "")])
        if raw:
            try:
                info = json.loads(raw)[0]
            except Exception:
                info = {}
        hc = info.get("HostConfig") or {}
        cfg = info.get("Config") or {}
        labels = cfg.get("Labels") or {}
        containers.append({
            "name": (c.get("Names") or "")[:255] or c.get("ID", "?"),
            "image": (c.get("Image") or "")[:500],
            "imageId": (info.get("Image") or "")[:100] or None,
            "status": (c.get("Status") or "")[:100],
            "privileged": bool(hc.get("Privileged")),
            "user": (cfg.get("User") or "")[:100],
            "ports": [p.strip() for p in (c.get("Ports") or "").split(",") if p.strip()][:100],
            "project": labels.get("com.docker.compose.project"),
            # 1.2: bezpečnostní podrobnosti (bez proměnných prostředí a příkazů)
            "id": (info.get("Id") or "")[:12] or None,
            "state": ((info.get("State") or {}).get("Status") or "")[:40] or None,
            "health": (((info.get("State") or {}).get("Health") or {}).get("Status") or "")[:40] or None,
            "restart": ((hc.get("RestartPolicy") or {}).get("Name") or "")[:40] or None,
            "readOnlyRootfs": bool(hc.get("ReadonlyRootfs")),
            "noNewPrivileges": any(o.startswith("no-new-privileges") and not o.endswith("false") for o in (hc.get("SecurityOpt") or [])),
            "networkMode": (hc.get("NetworkMode") or "")[:200] or None,
            "pidMode": (hc.get("PidMode") or "")[:200] or None,
            "ipcMode": (hc.get("IpcMode") or "")[:200] or None,
            "capAdd": [str(x)[:60] for x in (hc.get("CapAdd") or [])][:100],
            "capDrop": [str(x)[:60] for x in (hc.get("CapDrop") or [])][:100],
            "securityOpt": [str(x)[:200] for x in (hc.get("SecurityOpt") or [])][:50],
            "apparmor": (info.get("AppArmorProfile") or "")[:200] or None,
            "mounts": [{"type": (m.get("Type") or "")[:20], "source": ((m.get("Name") if m.get("Type") == "volume" and m.get("Name") else m.get("Source")) or "")[:300], "destination": (m.get("Destination") or "")[:300], "rw": bool(m.get("RW", True))} for m in (info.get("Mounts") or [])][:200],
            "memoryLimit": hc.get("Memory") or 0,
            "pidsLimit": max(0, hc.get("PidsLimit") or 0),
            "healthcheck": bool(((cfg.get("Healthcheck") or {}).get("Test") or ["NONE"])[0] != "NONE"),
            "service": labels.get("com.docker.compose.service"),
        })
    for line in (run(["docker", "image", "ls", "--format", "{{json .}}"]) or "").splitlines():
        try:
            i = json.loads(line)
        except Exception:
            continue
        images.append({"repo": i.get("Repository", ""), "tag": i.get("Tag", ""), "id": i.get("ID", ""), "created": i.get("CreatedAt")})
    return containers, images


# ---------- služby a porty ----------
def services():
    enabled = {}
    for line in (run(["systemctl", "list-unit-files", "--type=service", "--no-legend", "--no-pager"]) or "").splitlines():
        p = line.split()
        if len(p) >= 2:
            enabled[p[0]] = p[1] == "enabled"
    out = []
    for line in (run(["systemctl", "list-units", "--type=service", "--all", "--no-legend", "--plain", "--no-pager"]) or "").splitlines():
        p = line.split()
        if len(p) >= 4 and p[0].endswith(".service"):
            out.append({"name": p[0], "state": p[3], "enabled": enabled.get(p[0])})
    return out


def listening():
    out = []
    for line in (run(["ss", "-tulnpH"]) or "").splitlines():
        p = line.split()
        if len(p) < 5:
            continue
        addr, _, port = p[4].rpartition(":")
        if not port.isdigit():
            continue
        proc = re.search(r'users:\(\("([^"]+)"', line)
        out.append({"proto": p[0], "address": addr.strip("[]"), "port": int(port), "process": proc.group(1) if proc else None})
    return out


# ---------- firewall ----------
def norm_ipt(text):
    lines = []
    for l in (text or "").splitlines():
        l = re.sub(r"\[\d+:\d+\]", "", l).strip()
        if l and not l.startswith("#"):
            lines.append(l)
    return "\n".join(lines)


def firewall():
    # firewalld: běžící vs. trvalá konfigurace
    if (run(["firewall-cmd", "--state"]) or "").strip() == "running":
        rt = run(["firewall-cmd", "--list-all-zones"])
        perm = run(["firewall-cmd", "--permanent", "--list-all-zones"])
        target = re.search(r"target:\s*(\S+)", run(["firewall-cmd", "--list-all"]) or "")
        t = (target.group(1).lower() if target else "")
        return {"tool": "nftables" if shutil.which("nft") else "iptables", "rulesHash": sha(rt), "savedHash": sha(perm), "defaultInput": "accept" if t == "accept" else ("reject" if t in ("reject", "default", "%%reject%%") else ("drop" if t == "drop" else None)), "ruleCount": (rt or "").count("\n")}
    # ufw: pravidla se ukládají vždy
    ufw = run(["ufw", "status", "verbose"])
    if ufw and "Status: active" in ufw:
        d = re.search(r"Default:\s*(\w+) \(incoming\)", ufw)
        h = sha(ufw)
        return {"tool": "iptables", "rulesHash": h, "savedHash": h, "defaultInput": {"deny": "drop", "reject": "reject", "allow": "accept"}.get(d.group(1) if d else "", None), "ruleCount": ufw.count("\n")}
    nft = run(["nft", "list", "ruleset"])
    if nft and nft.strip() and "hook input" in nft:
        pol = re.search(r"hook input[^;]*;[^}]*?policy (accept|drop)", nft, re.S)
        saved = read("/etc/nftables.conf") or read("/etc/sysconfig/nftables.conf")
        enabled = (run(["systemctl", "is-enabled", "nftables"]) or "").strip() == "enabled"
        # nft nelze porovnat textově – uložené = existuje konfigurace s tabulkami a služba se spouští při startu
        persistent = enabled and saved is not None and "table" in saved
        h = sha(nft)
        return {"tool": "nftables", "rulesHash": h, "savedHash": h if persistent else sha(saved), "defaultInput": pol.group(1) if pol else "accept", "ruleCount": nft.count("\n")}
    ipt = run(["iptables-save"])
    if ipt and re.search(r"^-A ", ipt, re.M) or (ipt and re.search(r":INPUT (DROP|REJECT)", ipt)):
        pol = re.search(r"^:INPUT (\w+)", ipt, re.M)
        saved = read("/etc/iptables/rules.v4") or read("/etc/sysconfig/iptables")
        return {"tool": "iptables", "rulesHash": sha(norm_ipt(ipt)), "savedHash": sha(norm_ipt(saved)) if saved is not None else None, "defaultInput": (pol.group(1).lower() if pol else "accept"), "ruleCount": len(re.findall(r"^-A ", ipt, re.M))}
    return {"tool": "none", "rulesHash": None, "savedHash": None, "defaultInput": None, "ruleCount": 0}


def collect():
    accounts = users()
    ll = last_logins()
    for u in accounts:
        u["lastLogin"] = ll.get(u["name"])
    containers, images = docker()
    inv = {
        "collectorVersion": VERSION,
        "collectedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "host": host_info(),
        "users": [{k: v for k, v in u.items() if not k.startswith("_")} for u in accounts],
        "sshKeys": ssh_keys(accounts),
        "containers": containers,
        "images": images,
        "services": services(),
        "listening": listening(),
        "firewall": firewall(),
        "system": system(),
        "sshd": sshd(),
    }
    return inv


def env():
    vals = {}
    for line in (read("/etc/contix-collect.env") or "").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip().strip('"')
    vals.update({k: v for k, v in os.environ.items() if k.startswith("CONTIX_")})
    return vals


def main():
    inv = collect()
    if "--dry-run" in sys.argv:
        print(json.dumps(inv, ensure_ascii=False, indent=2))
        return 0
    e = env()
    url, token = e.get("CONTIX_URL", "").rstrip("/"), e.get("CONTIX_TOKEN", "")
    if not url or not token:
        print("Chybí CONTIX_URL nebo CONTIX_TOKEN (proměnné prostředí nebo /etc/contix-collect.env).", file=sys.stderr)
        return 2
    ctx = ssl.create_default_context(cafile=e.get("CONTIX_CA") or None)
    if e.get("CONTIX_INSECURE") == "1":
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url + "/api/public/hosts/inventory", data=json.dumps(inv).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + token, "User-Agent": "contix-collect/" + VERSION})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=60) as r:
            print(r.read().decode("utf-8"))
        return 0
    except urllib.error.HTTPError as ex:
        print("CONTIX odmítl inventář: HTTP %s %s" % (ex.code, ex.read().decode("utf-8", "replace")[:300]), file=sys.stderr)
        return 1
    except Exception as ex:
        print("CONTIX nedostupný: %s" % ex, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
