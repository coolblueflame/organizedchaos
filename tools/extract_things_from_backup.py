#!/usr/bin/env python3
"""Extract the Things 3 database from an iPhone backup (Windows/Mac).

Usage:
    python extract_things_from_backup.py            # auto-finds the newest backup
    python extract_things_from_backup.py <backup-dir>  # or point at one directly

Output: things-main.sqlite in the current directory — drop that file into
Organized Chaos (Settings -> import from Things).

Works with UNENCRYPTED backups out of the box (python 3.8+, stdlib only).
For ENCRYPTED backups it uses the `iphone_backup_decrypt` package if present:
    pip install iphone-backup-decrypt
and will prompt for your backup password.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import sys
from pathlib import Path

THINGS_DOMAIN_LIKE = "%culturedcode%"
DB_NAME_LIKES = ["%main.sqlite", "%Things.sqlite3"]


def candidate_backup_roots() -> list[Path]:
    home = Path.home()
    roots = [
        # Windows: classic iTunes and the Microsoft-Store / Apple Devices app
        home / "AppData/Roaming/Apple Computer/MobileSync/Backup",
        home / "Apple/MobileSync/Backup",
        home / "AppData/Roaming/Apple/MobileSync/Backup",
        # macOS
        home / "Library/Application Support/MobileSync/Backup",
    ]
    return [r for r in roots if r.is_dir()]


def newest_backup(explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit)
        if not (p / "Manifest.db").exists():
            sys.exit(f"error: {p} does not look like a backup (no Manifest.db)")
        return p
    backups: list[Path] = []
    for root in candidate_backup_roots():
        backups += [d for d in root.iterdir() if (d / "Manifest.db").exists()]
    if not backups:
        sys.exit(
            "error: no iPhone backups found. Back your phone up first "
            "(iTunes / Apple Devices app), or pass the backup folder as an argument."
        )
    backups.sort(key=lambda d: (d / "Manifest.db").stat().st_mtime, reverse=True)
    print(f"using backup: {backups[0]}")
    return backups[0]


def is_encrypted(manifest: Path) -> bool:
    try:
        con = sqlite3.connect(f"file:{manifest}?mode=ro", uri=True)
        con.execute("SELECT count(*) FROM Files")
        con.close()
        return False
    except sqlite3.DatabaseError:
        return True  # encrypted manifests aren't readable as plain sqlite


def find_rows(manifest: Path) -> list[tuple[str, str, str]]:
    con = sqlite3.connect(f"file:{manifest}?mode=ro", uri=True)
    rows: list[tuple[str, str, str]] = []
    for like in DB_NAME_LIKES:
        rows += con.execute(
            "SELECT fileID, domain, relativePath FROM Files "
            "WHERE domain LIKE ? AND relativePath LIKE ?",
            (THINGS_DOMAIN_LIKE, like),
        ).fetchall()
    con.close()
    return rows


def extract_plain(backup: Path) -> None:
    rows = find_rows(backup / "Manifest.db")
    if not rows:
        sys.exit("error: no Things database found in this backup — is Things installed on the phone?")
    # Prefer the modern main.sqlite over the legacy Things.sqlite3
    rows.sort(key=lambda r: ("main.sqlite" not in r[2], r[2]))
    file_id, domain, rel = rows[0]
    src = backup / file_id[:2] / file_id
    if not src.exists():
        src = backup / file_id  # very old backup layouts are flat
    if not src.exists():
        sys.exit(f"error: manifest lists {rel} but {src} is missing")
    shutil.copy(src, "things-main.sqlite")
    print(f"extracted {domain}/{rel}\n  -> things-main.sqlite")
    # WAL sidecar, if the backup carried one (usually not needed, harmless to grab)
    for fid, _, wrel in find_rows(backup / "Manifest.db"):
        if wrel.endswith("main.sqlite-wal"):
            wsrc = backup / fid[:2] / fid
            if wsrc.exists():
                shutil.copy(wsrc, "things-main.sqlite-wal")
                print(f"extracted {wrel}\n  -> things-main.sqlite-wal")


def extract_encrypted(backup: Path) -> None:
    try:
        from iphone_backup_decrypt import EncryptedBackup, RelativePathsLike  # type: ignore
    except ImportError:
        sys.exit(
            "This backup is ENCRYPTED. Install the decryptor first:\n"
            "    pip install iphone-backup-decrypt\n"
            "then run this script again."
        )
    import getpass

    password = getpass.getpass("backup password: ")
    b = EncryptedBackup(backup_directory=str(backup), passphrase=password)
    b.extract_files(
        relative_paths_like=RelativePathsLike("%main.sqlite"),
        output_folder=".",
        preserve_folders=False,
    )
    if Path("main.sqlite").exists():
        Path("main.sqlite").rename("things-main.sqlite")
        print("extracted -> things-main.sqlite")
    else:
        sys.exit("error: decryption ran but no main.sqlite came out — check the password?")


def main() -> None:
    backup = newest_backup(sys.argv[1] if len(sys.argv) > 1 else None)
    if is_encrypted(backup / "Manifest.db"):
        print("backup is encrypted — using iphone_backup_decrypt")
        extract_encrypted(backup)
    else:
        extract_plain(backup)
    print("\ndone. Open Organized Chaos -> Settings -> import from Things -> pick things-main.sqlite")


if __name__ == "__main__":
    main()
