#!/usr/bin/env python3
"""
START HERE.  Usage:   python run.py https://your-website.com

This file only reads the command line and starts the recorder.
All the real work lives in the recorder_app/ folder (see README.md).
"""

import argparse
import asyncio
import sys

from recorder_app.session import run


def main():
    """Read the website address from the command line and start recording."""
    parser = argparse.ArgumentParser(description="Record clicks and get the best locators.")
    parser.add_argument("url", help="website to open, e.g. https://example.com")
    parser.add_argument("--out", default="recordings", help="folder where results are saved")
    args = parser.parse_args()

    url = args.url if args.url.startswith(("http://", "https://")) else "https://" + args.url
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")  # avoids crashes on special characters in Windows

    try:
        asyncio.run(run(url, args.out))
    except KeyboardInterrupt:
        print("\nStopped (Ctrl+C). Files were saved after every step.")


if __name__ == "__main__":
    main()
