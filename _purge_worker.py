"""Delete leaked /worker/ directory from the live FTP server."""
import ftplib, os, sys
from pathlib import Path

# Load .env from the same directory if present (no python-dotenv required)
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

ftp = ftplib.FTP(HOST)
ftp.login(USER, PASS)
ftp.set_pasv(True)

def rm_recursive(path):
    try:
        ftp.cwd(path)
    except Exception as e:
        print(f"cd {path}: {e}")
        return
    items = []
    ftp.retrlines("LIST", items.append)
    ftp.cwd("/")
    for line in items:
        # crude parse: last token is name, first char of perms is 'd' for dir
        parts = line.split(maxsplit=8)
        if len(parts) < 9:
            continue
        name = parts[8]
        if name in (".", ".."):
            continue
        full = path.rstrip("/") + "/" + name
        if line.startswith("d"):
            rm_recursive(full)
        else:
            try:
                ftp.delete(full)
                print(f"  rm  {full}")
            except Exception as e:
                print(f"  rm-fail {full}: {e}")
    try:
        ftp.rmd(path)
        print(f"  rmdir {path}")
    except Exception as e:
        print(f"  rmdir-fail {path}: {e}")

rm_recursive("/worker")
ftp.quit()
print("Done.")
