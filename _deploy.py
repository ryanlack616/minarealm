"""Deploy minarealm static files to Porkbun via FTPS.

Safety features:
  * FTPS (explicit AUTH TLS, port 21)
  * Pre-deploy snapshot of every file we'd overwrite into .live-snapshot/<ISO>/
  * Refuses to overwrite a remote file whose MDTM is NEWER than the local file
    (i.e. someone edited live or another machine) unless --force.
  * Targets: with no args, deploys everything (filtered by SKIP rules).
    With args, only deploys the listed relative paths (e.g.
    `python _deploy.py admin/index.html shop/index.html`).

Usage:
  python _deploy.py                          # full deploy with safety
  python _deploy.py admin/index.html         # single file
  python _deploy.py --force admin/index.html # overwrite even if remote newer
  python _deploy.py --dry-run                # report only, no upload
"""
import ftplib, os, mimetypes, sys, datetime
from pathlib import Path

# --- env loading ---
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith('#') and '=' in _line:
            _k, _, _v = _line.partition('=')
            os.environ.setdefault(_k.strip(), _v.strip())

HOST = "pixie-ss1-ftp.porkbun.com"
USER = os.environ.get('MR_FTP_USER', 'minarealm.shop')
PASS = os.environ.get('MR_FTP_PASS', '')
if not PASS:
    print('Error: MR_FTP_PASS env var not set. See .env.example.')
    sys.exit(1)
LOCAL_DIR = Path(__file__).parent.resolve()

SKIP_FILES = {"_deploy.py", "_pull.py", ".git", "__pycache__", ".DS_Store", "Thumbs.db",
              "PLANS.md", "Minarealm_Questions_for_Cynthia.pdf",
              "minarealm-org-index.html", "move-announcement-prominent.html",
              "move-announcement-snippet.html",
              "worker", "node_modules", ".wrangler",
              "formspree.json", ".formspree",
              "products.json", ".live-snapshot", ".env", ".env.example"}
SKIP_EXTS = {".py", ".md", ".pdf"}


def should_skip(name: str) -> bool:
    if name.startswith("."):
        return True
    if name in SKIP_FILES:
        return True
    if name.startswith("gaia-move-announcement"):
        return True
    _, ext = os.path.splitext(name)
    return ext.lower() in SKIP_EXTS


def collect_local_files(root: Path):
    files = []
    def walk(d: Path):
        for entry in sorted(d.iterdir()):
            if should_skip(entry.name):
                continue
            if entry.is_dir():
                walk(entry)
            else:
                files.append(entry)
    walk(root)
    return files


# --- CLI ---
args = sys.argv[1:]
FORCE = "--force" in args
DRY = "--dry-run" in args
explicit_targets = [a for a in args if not a.startswith("--")]


def to_remote(local: Path) -> str:
    return "/" + local.relative_to(LOCAL_DIR).as_posix()


if explicit_targets:
    targets = []
    for rel in explicit_targets:
        p = (LOCAL_DIR / rel).resolve()
        if not p.exists():
            print(f"ERROR: target not found locally: {rel}")
            sys.exit(2)
        if not str(p).startswith(str(LOCAL_DIR)):
            print(f"ERROR: target escapes project dir: {rel}")
            sys.exit(2)
        targets.append(p)
else:
    targets = collect_local_files(LOCAL_DIR)


print(f"Connecting to {HOST} as {USER} (FTPS)…")
ftp = ftplib.FTP_TLS(timeout=30)
ftp.connect(HOST, 21)
ftp.login(USER, PASS)
ftp.prot_p()
ftp.set_pasv(True)
print("Connected.")


def probe(remote: str):
    """Return (size, mdtm_datetime_utc) or (None, None) if file is missing remotely.

    MDTM is defined by RFC 3659 to return UTC. We tag it tz-aware so it can be
    compared against the local mtime (also converted to UTC below).
    """
    try:
        size = ftp.size(remote)
    except ftplib.error_perm:
        return None, None
    try:
        resp = ftp.sendcmd("MDTM " + remote)
        ts = resp.split()[-1]
        mdtm = datetime.datetime.strptime(ts[:14], "%Y%m%d%H%M%S").replace(
            tzinfo=datetime.timezone.utc
        )
    except Exception:
        mdtm = None
    return size, mdtm


SNAPSHOT_DIR = LOCAL_DIR / ".live-snapshot" / datetime.datetime.now().strftime("%Y-%m-%dT%H%M%S")
plan = []
print("\nPlanning…")
for local in targets:
    remote = to_remote(local)
    rsize, rmdtm = probe(remote)
    lsize = local.stat().st_size
    # Local mtime as tz-aware UTC so comparison with MDTM is correct regardless
    # of the machine's local timezone (e.g. EST/EDT).
    lmtime = datetime.datetime.fromtimestamp(
        local.stat().st_mtime, tz=datetime.timezone.utc
    )

    if rsize is None:
        plan.append((local, remote, "upload-new", "remote missing"))
        continue
    if rsize == lsize:
        plan.append((local, remote, "skip-same-size", f"both {lsize}B"))
        continue
    newer = rmdtm and rmdtm > lmtime
    if newer and not FORCE:
        plan.append((local, remote, "BLOCK-remote-newer",
                     f"remote {rsize}B @ {rmdtm} > local {lsize}B @ {lmtime}"))
    else:
        plan.append((local, remote, "upload-overwrite",
                     f"remote {rsize}B @ {rmdtm} -> local {lsize}B @ {lmtime}"))

print(f"\n{'='*70}\nPLAN ({len(plan)} files)\n{'='*70}")
counts = {}
for _, remote, action, reason in plan:
    counts[action] = counts.get(action, 0) + 1
    print(f"  [{action:22s}] {remote:50s}  {reason}")
print(f"\nSummary: {counts}")

blocked = [p for p in plan if p[2] == "BLOCK-remote-newer"]
if blocked and not FORCE:
    print(f"\nBLOCKED: {len(blocked)} file(s) — remote is newer than local.")
    print("  Either:")
    print("    - run `python _pull.py <path>` to adopt the remote version locally, then commit, then deploy")
    print("    - or re-run with --force to overwrite (snapshot is always taken first)")
    ftp.quit()
    sys.exit(3)

if DRY:
    print("\nDry run — no uploads performed.")
    ftp.quit()
    sys.exit(0)

to_upload = [p for p in plan if p[2] in ("upload-new", "upload-overwrite")]
if not to_upload:
    print("\nNothing to upload.")
    ftp.quit()
    sys.exit(0)

overwrite = [p for p in to_upload if p[2] == "upload-overwrite"]
if overwrite:
    print(f"\nSnapshotting {len(overwrite)} file(s) to {SNAPSHOT_DIR}…")
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    for local, remote, _, _ in overwrite:
        rel = local.relative_to(LOCAL_DIR)
        snap_path = SNAPSHOT_DIR / rel
        snap_path.parent.mkdir(parents=True, exist_ok=True)
        with open(snap_path, "wb") as g:
            ftp.retrbinary("RETR " + remote, g.write)
        print(f"  saved {rel}")


def ensure_remote_dir(remote_file: str):
    parts = remote_file.strip("/").split("/")[:-1]
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            ftp.mkd(cur)
        except ftplib.error_perm:
            pass


print(f"\nUploading {len(to_upload)} file(s)…")
for local, remote, action, _ in to_upload:
    mime = mimetypes.guess_type(local.name)[0] or "application/octet-stream"
    ensure_remote_dir(remote)
    print(f"  {action:18s} {remote} ({mime})")
    with open(local, "rb") as fobj:
        ftp.storbinary("STOR " + remote, fobj)

ftp.quit()
print("\nDone.")
if overwrite:
    print(f"  Snapshot of overwritten remotes: {SNAPSHOT_DIR}")
