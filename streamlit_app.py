#!/usr/bin/env python3
"""careTalk — live app on Streamlit Community Cloud."""

from __future__ import annotations

from pathlib import Path

import streamlit as st

from streamlit_static import render_live_site

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"
if (SITE / "app.html").is_file():
    HTML = SITE / "app.html"
elif (SITE / "index.html").is_file():
    HTML = SITE / "index.html"
else:
    HTML = ROOT / "index.html"

st.set_page_config(
    page_title="careTalk · Deborah Akuoko Minka",
    page_icon="🏥",
    layout="wide",
    initial_sidebar_state="collapsed",
)

ABOUT = """
**careTalk** turns spoken or typed observations into structured draft care notes for staff review.

- **Live on Streamlit:** this page
- **Source:** [github.com/2000pd3rvr/careTalk](https://github.com/2000pd3rvr/careTalk)
- **Also on Hugging Face:** [0001AMA/careTalk](https://huggingface.co/spaces/0001AMA/careTalk)
- **Author:** Deborah Akuoko Minka / Deborah Akuoko-Minka
- [Research site](https://deborahakuokominka.wordpress.com/) · [ORCID](https://orcid.org/0009-0008-6219-154X)

Demonstration only — do not enter real resident details.
"""

if not HTML.is_file():
    st.error("careTalk UI files are missing from this deployment.")
    st.markdown(ABOUT)
else:
    render_live_site(HTML, height=960, about_title="About careTalk", about_md=ABOUT)
