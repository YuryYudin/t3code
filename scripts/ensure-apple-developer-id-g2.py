#!/usr/bin/env python3
"""Make Apple's public Developer ID G2 intermediate visible to macOS signing."""

import hashlib
import pathlib
import subprocess
import tempfile
import urllib.request


CERTIFICATE_URL = "https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer"
CERTIFICATE_SHA256 = "f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a"
KEYCHAIN = pathlib.Path.home() / "t3code-developer-id-g2.keychain-db"


def security(*args: str) -> str:
    return subprocess.check_output(["security", *args], text=True).strip()


certificate = urllib.request.urlopen(CERTIFICATE_URL, timeout=30).read()
if hashlib.sha256(certificate).hexdigest() != CERTIFICATE_SHA256:
    raise SystemExit("Apple Developer ID G2 certificate fingerprint changed")

if not KEYCHAIN.exists():
    security("create-keychain", "-p", "", str(KEYCHAIN))

if CERTIFICATE_SHA256.upper() not in security("find-certificate", "-a", "-Z", str(KEYCHAIN)):
    with tempfile.NamedTemporaryFile(suffix=".cer") as file:
        file.write(certificate)
        file.flush()
        security("import", file.name, "-k", str(KEYCHAIN))

current = [line.strip().strip('"') for line in security("list-keychains", "-d", "user").splitlines()]
ordered = [str(KEYCHAIN), *(path for path in current if path != str(KEYCHAIN))]
security("list-keychains", "-d", "user", "-s", *ordered)
