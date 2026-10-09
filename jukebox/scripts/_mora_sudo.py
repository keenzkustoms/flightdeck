#!/usr/bin/env python3
"""Run a root script on Mora via SSH + sudo (scp wrapper pattern)."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

creds: dict[str, str] = {}
for line in Path("/home/flightdeck/.smbcredentials-mora").read_text().splitlines():
    if "=" in line:
        k, v = line.split("=", 1)
        creds[k.strip()] = v.strip()
password = creds["password"]
user = creds["username"]
body = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
if not body.strip():
    print("empty command", file=sys.stderr)
    sys.exit(2)
if not body.startswith("#!"):
    body = "#!/bin/sh\nset -e\n" + body
if not body.endswith("\n"):
    body += "\n"

wrapper = """#!/bin/sh
set -e
PW=$(cat /tmp/amy.pw)
printf '%s\\n' "$PW" | sudo -S -p '' /bin/sh /tmp/amy-root.sh
ec=$?
rm -f /tmp/amy.pw /tmp/amy-root.sh /tmp/amy-wrap.sh
exit $ec
"""

pwfile = Path("/tmp/mora-ssh.pw")
rootfile = Path("/tmp/mora-root.sh")
wrapfile = Path("/tmp/mora-wrap.sh")
pwfile.write_text(password)
rootfile.write_text(body)
wrapfile.write_text(wrapper)

inner = f"""
set -e
apk add --no-cache openssh-client sshpass >/dev/null
export SSHPASS=$(cat /pw)
OPTS='-o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=20'
sshpass -e scp $OPTS /pw {user}@192.168.4.77:/tmp/amy.pw
sshpass -e scp $OPTS /root.sh {user}@192.168.4.77:/tmp/amy-root.sh
sshpass -e scp $OPTS /wrap.sh {user}@192.168.4.77:/tmp/amy-wrap.sh
sshpass -e ssh $OPTS {user}@192.168.4.77 /bin/sh /tmp/amy-wrap.sh
"""

try:
    r = subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "--network=host",
            "-v",
            f"{pwfile}:/pw:ro",
            "-v",
            f"{rootfile}:/root.sh:ro",
            "-v",
            f"{wrapfile}:/wrap.sh:ro",
            "alpine:3.20",
            "sh",
            "-c",
            inner,
        ],
        capture_output=True,
        text=True,
        timeout=600,
    )
finally:
    for p in (pwfile, rootfile, wrapfile):
        p.unlink(missing_ok=True)
sys.stdout.write(((r.stdout or "") + (r.stderr or "")).replace(password, "***"))
sys.exit(r.returncode)
