#!/usr/bin/env python3
"""Convierte un archivo de audio propio a Opus (~96 kbps) usando FFmpeg."""
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    if len(sys.argv) < 2:
        print("Uso: python tools/convert_to_opus.py <archivo-de-audio>")
        raise SystemExit(2)

    source = Path(sys.argv[1]).expanduser().resolve()
    if not source.exists() or not source.is_file():
        print(f"No existe: {source}")
        raise SystemExit(2)

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("FFmpeg no está instalado o no está en PATH.")
        raise SystemExit(3)

    out_dir = source.parent / "converted"
    out_dir.mkdir(exist_ok=True)
    output = out_dir / f"{source.stem}.opus"

    command = [
        ffmpeg, "-hide_banner", "-y", "-i", str(source),
        "-map", "0:a:0", "-map_metadata", "0",
        "-c:a", "libopus", "-b:a", "96k", "-vbr", "on",
        "-application", "audio", str(output)
    ]
    subprocess.run(command, check=True)
    print(f"Listo: {output}")


if __name__ == "__main__":
    main()
