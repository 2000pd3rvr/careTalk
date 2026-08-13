#!/usr/bin/env python3
"""careTalk — same experience as the Hugging Face Space (home + app + admin)."""

from __future__ import annotations

from pathlib import Path

import streamlit as st

from streamlit_static import render_multipage_site

# Bump to force Streamlit Cloud to reload modules after deploy.
APP_BUILD = "2026-08-13-fix1"

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site" if (ROOT / "site" / "index.html").is_file() else ROOT

st.set_page_config(
    page_title="careTalk · Deborah Akuoko Minka",
    page_icon="🏥",
    layout="wide",
    initial_sidebar_state="collapsed",
)

ABOUT = f"""
**careTalk** turns spoken or typed observations into structured draft care notes for staff review.

This Streamlit app mirrors the Hugging Face Space: landing page (updates / feedback), live app, and admin.

- **Source:** [github.com/2000pd3rvr/careTalk](https://github.com/2000pd3rvr/careTalk)
- **Also on Hugging Face:** [0001AMA/careTalk](https://huggingface.co/spaces/0001AMA/careTalk)
- **Author:** Deborah Akuoko Minka / Deborah Akuoko-Minka
- [Research site](https://deborahakuokominka.wordpress.com/) · [ORCID](https://orcid.org/0009-0008-6219-154X)

Demonstration only — do not enter real resident details.

_Build {APP_BUILD}_
"""

PAGES = {
    "home": SITE / "index.html",
    "app": SITE / "app.html",
    "admin": SITE / "admin.html",
}

missing = [k for k, p in PAGES.items() if not p.is_file()]
if missing:
    st.error(f"careTalk UI files missing: {', '.join(missing)}")
    st.markdown(ABOUT)
else:
    try:
        render_multipage_site(
            PAGES,
            default="home",
            height=1200,
            about_title="About careTalk",
            about_md=ABOUT,
            site_root=SITE,
            asset_cdn="https://cdn.jsdelivr.net/gh/2000pd3rvr/careTalk@main/site",
        )
    except Exception as exc:  # noqa: BLE001 — show real error on Cloud
        st.error(f"careTalk failed to render ({APP_BUILD}): {type(exc).__name__}: {exc}")
        st.exception(exc)
