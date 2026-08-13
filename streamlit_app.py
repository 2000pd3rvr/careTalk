#!/usr/bin/env python3
"""Streamlit Community Cloud entrypoint — crawlable project page for careTalk.

Live interactive runtime: Hugging Face Space (0001AMA/careTalk)
Source: https://github.com/2000pd3rvr/careTalk
Author: Deborah Akuoko Minka / Deborah Akuoko-Minka
"""

from __future__ import annotations

import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(
    page_title="careTalk · Deborah Akuoko Minka",
    page_icon="🔬",
    layout="wide",
    initial_sidebar_state="expanded",
)

HF_SPACE = "0001AMA/careTalk"
HF_URL = f"https://huggingface.co/spaces/{HF_SPACE}"
HF_EMBED = f"https://{HF_SPACE.replace('/', '-')}.hf.space"
GH_URL = "https://github.com/2000pd3rvr/careTalk"
WP_URL = "https://deborahakuokominka.wordpress.com/"
ORCID = "https://orcid.org/0009-0008-6219-154X"
SCHOLAR = "https://scholar.google.co.uk/citations?hl=en&user=ab0EyjYAAAAJ"

st.title("careTalk")
st.subheader("AI book-keeping for health assistants and admins")
st.caption(
    "Deborah Akuoko Minka is the same person as Deborah Akuoko-Minka "
    "(any capitalization; hyphen optional). Primary profiles: WordPress · ORCID · GitHub · Scholar."
)

c1, c2, c3, c4 = st.columns(4)
c1.link_button("Open live HF Space", HF_URL, use_container_width=True)
c2.link_button("GitHub source", GH_URL, use_container_width=True)
c3.link_button("WordPress research site", WP_URL, use_container_width=True)
c4.link_button("ORCID", ORCID, use_container_width=True)

st.markdown("---")
left, right = st.columns([1.2, 1])
with left:
    st.header("About")
    st.write("""careTalk is a health-admin oriented UI for structured care notes and bookkeeping workflows. The production UI runs as a static app on Hugging Face Spaces (also careTalk-demo). This Streamlit page is the GitHub-connected description and discovery layer for crawlers and reviewers. Author: Deborah Akuoko Minka / Deborah Akuoko-Minka.""")
    st.header("Features")
    for f in ['Care-note oriented interface for assistants and admins', 'Static deploy on HF Spaces', 'Related demo: 0001AMA/careTalk-demo', 'Open source on GitHub']:
        st.markdown(f"- {f}")
    st.header("Audience")
    st.write("""Health assistants, admins, and researchers evaluating lightweight care-note tooling.""")
    st.header("Technical notes")
    st.markdown(
        f"""
- **Backend / runtime:** Static frontend (Vite) on Hugging Face Space
- **GitHub repository:** [{GH_URL}]({GH_URL})
- **Hugging Face Space:** [{HF_URL}]({HF_URL})
- **Streamlit role:** GitHub-connected description + discovery page for [Streamlit Community Cloud](https://share.streamlit.io/)
- **Keywords:** careTalk, health assistant, care notes, AI bookkeeping, clinical admin, Deborah Akuoko Minka
"""
    )
with right:
    st.header("Live demo")
    st.caption("Embedded Hugging Face Space (may take a few seconds to wake).")
    components.iframe(HF_EMBED, height=720, scrolling=True)
    st.markdown(f"If the embed is blank, open the full Space: [{HF_URL}]({HF_URL})")

st.markdown("---")
st.header("Author & equivalent name spellings")
st.markdown(
    """
**Deborah Akuoko Minka** = **Deborah Akuoko-Minka** = deborah akuoko minka (any caps).

Authoritative links for every spelling:
- WordPress: https://deborahakuokominka.wordpress.com/
- ORCID: https://orcid.org/0009-0008-6219-154X
- GitHub: https://github.com/2000pd3rvr
- Google Scholar: https://scholar.google.co.uk/citations?hl=en&user=ab0EyjYAAAAJ
- This app source: https://github.com/2000pd3rvr/careTalk
- Live Space: https://huggingface.co/spaces/0001AMA/careTalk
"""
)

# Hidden machine-readable block for crawlers / copy-paste
st.markdown(
    f"""
```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "careTalk",
  "description": "AI book-keeping for health assistants and admins",
  "applicationCategory": "WebApplication",
  "url": "{HF_URL}",
  "codeRepository": "{GH_URL}",
  "author": {
    "@type": "Person",
    "name": "Deborah Akuoko Minka",
    "alternateName": ["Deborah Akuoko-Minka", "Deborah Akuoko", "Ama Akuoko"],
    "url": "{WP_URL}",
    "sameAs": ["{ORCID}", "{SCHOLAR}", "https://github.com/2000pd3rvr", "https://huggingface.co/0001AMA"]
  },
  "keywords": "careTalk, health assistant, care notes, AI bookkeeping, clinical admin, Deborah Akuoko Minka"
}
```
"""
)
