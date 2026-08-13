#!/usr/bin/env python3
"""careTalk — Streamlit Community Cloud app (GitHub-connected)."""

from __future__ import annotations

import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(
    page_title="careTalk · Deborah Akuoko Minka",
    page_icon="🏥",
    layout="wide",
    initial_sidebar_state="expanded",
)

HF_URL = "https://huggingface.co/spaces/0001AMA/careTalk"
HF_EMBED = "https://0001AMA-careTalk.hf.space"
GH_URL = "https://github.com/2000pd3rvr/careTalk"
WP_URL = "https://deborahakuokominka.wordpress.com/"
ORCID = "https://orcid.org/0009-0008-6219-154X"
SCHOLAR = "https://scholar.google.co.uk/citations?hl=en&user=ab0EyjYAAAAJ"

st.title("careTalk")
st.subheader("Structured care notes for health assistants and admins")
st.caption("Deborah Akuoko Minka · Deborah Akuoko-Minka")

b1, b2, b3, b4 = st.columns(4)
b1.link_button("Live demo", HF_URL, use_container_width=True)
b2.link_button("Source on GitHub", GH_URL, use_container_width=True)
b3.link_button("Research site", WP_URL, use_container_width=True)
b4.link_button("ORCID", ORCID, use_container_width=True)

st.markdown("---")
left, right = st.columns([1.25, 1])

with left:
    st.header("What it is")
    st.write(
        "careTalk helps health assistants and admins turn spoken or typed notes into "
        "clearer, structured care records. The interface is built for everyday clinical "
        "admin work rather than research notebooks — short flows, plain language, and "
        "a layout that stays usable on a phone or tablet during a shift."
    )

    st.header("What you can do")
    st.markdown(
        """
- Capture care notes with a simple, guided interface
- Keep bookkeeping and admin tasks in one place
- Use a lightweight static client that loads quickly on shared devices
- Open the same project from GitHub when you want to inspect or extend it
        """
    )

    st.header("Who it is for")
    st.write(
        "Care assistants, ward admins, and people evaluating small digital tools for "
        "health documentation. It is also a useful reference for researchers looking "
        "at practical interfaces around sparse clinical text."
    )

    st.header("How it is built")
    st.markdown(
        f"""
- **Live app:** [Hugging Face Space — 0001AMA/careTalk]({HF_URL})
- **Source:** [{GH_URL}]({GH_URL})
- **Stack:** Vite static frontend, published as a Space and mirrored from GitHub
- **Author:** Deborah Akuoko Minka (also written Deborah Akuoko-Minka)
        """
    )

    st.header("Related links")
    st.markdown(
        f"""
- [WordPress research site]({WP_URL})
- [ORCID]({ORCID})
- [Google Scholar]({SCHOLAR})
- Demo Space: [0001AMA/careTalk-demo](https://huggingface.co/spaces/0001AMA/careTalk-demo)
        """
    )

with right:
    st.header("Preview")
    st.write("Embedded view of the live Space. If the frame is empty, open the live demo link above.")
    components.iframe(HF_EMBED, height=720, scrolling=True)

st.markdown("---")
st.caption(
    "Deborah Akuoko Minka · machine intelligence and applied interfaces · "
    f"[deborahakuokominka.wordpress.com]({WP_URL})"
)
