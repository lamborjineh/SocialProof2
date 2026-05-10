#!/usr/bin/env python3
"""
build.py — Vercel build step
Replaces %%RAILWAY_API_URL%% placeholders in all HTML files
with the actual Railway backend URL from the environment.

Set RAILWAY_API_URL in Vercel's Environment Variables dashboard:
  e.g. https://your-app-name.up.railway.app
"""
import os
import glob

api_url = os.environ.get("RAILWAY_API_URL", "").rstrip("/")

if not api_url:
    print("WARNING: RAILWAY_API_URL is not set. API calls will use relative paths (dev only).")

html_files = glob.glob("pages/*.html")
for path in html_files:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    updated = content.replace("%%RAILWAY_API_URL%%", api_url)
    with open(path, "w", encoding="utf-8") as f:
        f.write(updated)
    print(f"  Injected API URL into {path}")

print(f"Build complete. RAILWAY_API_URL = '{api_url}'")
