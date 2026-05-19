import ftplib, os, mimetypes, sys
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
LOCAL_DIR = os.path.dirname(os.path.abspath(__file__))

SKIP_FILES = {"_deploy.py", ".git", "__pycache__", ".DS_Store", "Thumbs.db",
              "PLANS.md", "Minarealm_Questions_for_Cynthia.pdf",
              "minarealm-org-index.html", "move-announcement-prominent.html",
              "move-announcement-snippet.html",
              "worker", "node_modules", ".wrangler",
              "formspree.json", ".formspree",
              "products.json"}
SKIP_EXTS  = {".py", ".md", ".pdf"}
# Note: .txt is NOT skipped so robots.txt deploys correctly

def should_skip(name):
    if name.startswith("."):
        return True
    if name in SKIP_FILES:
        return True
    if name.startswith("gaia-move-announcement"):
        return True
    _, ext = os.path.splitext(name)
    if ext.lower() in SKIP_EXTS:
        return True
    return False

def upload_dir(ftp, local_path, remote_path="/"):
    for name in sorted(os.listdir(local_path)):
        if should_skip(name):
            continue
        local_file = os.path.join(local_path, name)
        remote_file = remote_path.rstrip("/") + "/" + name
        if os.path.isdir(local_file):
            try:
                ftp.mkd(remote_file)
            except ftplib.error_perm:
                pass
            upload_dir(ftp, local_file, remote_file)
        else:
            mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
            is_text = mime.startswith("text/") or mime in (
                "application/javascript", "application/json",
                "application/xml", "image/svg+xml",
            )
            mode = "STOR"
            print(f"  uploading {remote_file} ({mime})")
            with open(local_file, "rb") as f:
                ftp.storbinary(f"{mode} {remote_file}", f)

print(f"Connecting to {HOST} as {USER}…")
ftp = ftplib.FTP(HOST)
ftp.login(USER, PASS)
ftp.set_pasv(True)
print("Connected. Uploading…")
upload_dir(ftp, LOCAL_DIR, "/")
ftp.quit()
print("\nDone.")
