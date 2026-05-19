"""Pull live minarealm files FROM Porkbun into local working tree.

Used when:
  * Starting work on a fresh machine (after `git clone`) to grab any
    live-only edits made from another machine.
  * `_deploy.py` blocked you because remote is newer than local.
  * You suspect drift between local and live.

Usage:
  python _pull.py                         # mirror entire site into a SNAPSHOT
                                          # under .live-snapshot/<ISO>/ (non-destructive)
  python _pull.py admin/index.html        # snapshot AND overwrite local file with remote
  python _pull.py --all-overwrite         # overwrite ALL non-skipped local files with remote
                                          # (use after `git commit -am 'snapshot'` so you can diff)

Behavior:
  * Always writes a timestamped snapshot under .live-snapshot/<ISO>/ first.
  * Only writes back into the working tree when given explicit targets or --all-overwrite.
  * Will NOT modify .env, .git, _deploy.py, _pull.py, PLANS.md, worker/, or anything else
    in SKIP_FILES — those are local-only.
"""
import ftplib, os, sys, datetime
from pathlib import Path

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
    print('Error: MR_FTP_PASS env var not set.')
    sys.exit(1)

LOCAL_DIR = Path(__file__).parent.resolve()
SKIP_FILES = {"_deploy.py", "_pull.py", ".git", "__pycache__", ".DS_Store", "Thumbs.db",
              "PLANS.md", "worker", "node_modules", ".wrangler",
              ".live-snapshot", ".env", ".env.example",
              "formspree.json", ".formspree", "products.json"}
SKIP_EXTS = {".py", ".md", ".pdf"}


def should_skip_local_write(name: str) -> bool:
    if name in SKIP_FILES:
        return True
    if name.startswith("."):
        return True
    _, ext = os.path.splitext(name)
    return ext.lower() in SKIP_EXTS


args = sys.argv[1:]
ALL_OVERWRITE = "--all-overwrite" in args
explicit = [a for a in args if not a.startswith("--")]

SNAPSHOT_DIR = LOCAL_DIR / ".live-snapshot" / datetime.datetime.now().strftime("%Y-%m-%dT%H%M%S")

print(f"Connecting to {HOST} as {USER} (FTPS)…")
ftp = ftplib.FTP_TLS(timeout=30)
ftp.connect(HOST, 21)
ftp.login(USER, PASS)
ftp.prot_p()
ftp.set_pasv(True)
print("Connected.")


def list_remote(path: str = "/"):
    """Recursive list of file paths under remote dir `path`."""
    files = []
    try:
        entries = []
        ftp.retrlines(f"LIST {path}", entries.append)
    except ftplib.error_perm as e:
        print(f"  cannot list {path}: {e}")
        return files
    for line in entries:
        parts = line.split(maxsplit=8)
        if len(parts) < 9:
            continue
        perm, name = parts[0], parts[-1]
        if name in (".", ".."):
            continue
        sub = path.rstrip("/") + "/" + name
        if perm.startswith("d"):
            files.extend(list_remote(sub))
        else:
            files.append(sub)
    return files


def download(remote: str, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as g:
        ftp.retrbinary("RETR " + remote, g.write)


if explicit:
    print(f"\nPulling {len(explicit)} file(s)…")
    for rel in explicit:
        remote = "/" + rel.lstrip("/").replace("\\", "/")
        snap_path = SNAPSHOT_DIR / rel.lstrip("/")
        local_path = LOCAL_DIR / rel.lstrip("/")
        try:
            download(remote, snap_path)
        except Exception as e:
            print(f"  ERROR pulling {remote}: {e}")
            continue
        # snapshot done; now write to working tree
        if should_skip_local_write(os.path.basename(rel)):
            print(f"  {remote}: snapshotted only (skip-rule on local write)")
        else:
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_bytes(snap_path.read_bytes())
            print(f"  {remote} -> {local_path.relative_to(LOCAL_DIR)} (snapshot + working tree)")
else:
    print(f"\nMirroring full remote site to {SNAPSHOT_DIR}…")
    remote_files = list_remote("/")
    print(f"  found {len(remote_files)} remote files")
    for remote in remote_files:
        rel = remote.lstrip("/")
        snap_path = SNAPSHOT_DIR / rel
        try:
            download(remote, snap_path)
        except Exception as e:
            print(f"  ERROR {remote}: {e}")
            continue
        if ALL_OVERWRITE and not should_skip_local_write(os.path.basename(rel)):
            local_path = LOCAL_DIR / rel
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_bytes(snap_path.read_bytes())

ftp.quit()
print(f"\nDone.")
print(f"  Snapshot: {SNAPSHOT_DIR}")
if explicit:
    print("  Working tree updated for explicit targets above.")
elif ALL_OVERWRITE:
    print("  Working tree overwritten with remote (review with `git diff`).")
else:
    print("  Working tree NOT modified (snapshot only). Pass explicit paths or --all-overwrite to update.")
