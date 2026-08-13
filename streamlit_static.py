#!/usr/bin/env python3
"""Serve a local static site as the live Streamlit app UI."""

from __future__ import annotations

import base64
import mimetypes
import re
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

_LINK_CSS = re.compile(
    r'<link[^>]+rel=["\']stylesheet["\'][^>]*href=["\']([^"\']+)["\'][^>]*/?>',
    re.I,
)
_SCRIPT_SRC = re.compile(
    r'<script([^>]*?)src=["\']([^"\']+)["\']([^>]*)>\s*</script>',
    re.I,
)
_IMG_SRC = re.compile(
    r'(<(?:img|source|video|audio|link)[^>]+(?:src|href)=["\'])([^"\']+)(["\'])',
    re.I,
)


def _read(path: Path) -> bytes:
    return path.read_bytes()


def _data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    b64 = base64.b64encode(_read(path)).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _resolve(base: Path, ref: str) -> Path | None:
    ref = ref.split("?")[0].split("#")[0].strip()
    if not ref or ref.startswith(("http://", "https://", "data:", "mailto:", "tel:", "//")):
        return None
    if ref.startswith("/"):
        # try relative to site root (base)
        cand = base / ref.lstrip("/")
    else:
        cand = (base / ref).resolve()
        try:
            cand.relative_to(base.resolve())
        except ValueError:
            return None
    return cand if cand.is_file() else None


def build_standalone_html(html_path: Path) -> str:
    """Inline local CSS/JS and small local images into a single HTML document."""
    base = html_path.parent
    html = html_path.read_text(encoding="utf-8", errors="replace")

    def inject_css(match: re.Match[str]) -> str:
        href = match.group(1)
        path = _resolve(base, href)
        if not path:
            return match.group(0)
        css = path.read_text(encoding="utf-8", errors="replace")
        # rewrite url(...) in CSS for local files
        def css_url(m: re.Match[str]) -> str:
            u = m.group(1).strip(" \"'")
            p = _resolve(path.parent, u)
            if not p or p.stat().st_size > 1_500_000:
                return m.group(0)
            return f"url({_data_uri(p)})"

        css = re.sub(r"url\(([^)]+)\)", css_url, css)
        return f"<style>\n{css}\n</style>"

    html = _LINK_CSS.sub(inject_css, html)

    def inject_js(match: re.Match[str]) -> str:
        pre, src, post = match.group(1), match.group(2), match.group(3)
        path = _resolve(base, src)
        if not path:
            return match.group(0)
        js = path.read_text(encoding="utf-8", errors="replace")
        return f"<script{pre}{post}>\n{js}\n</script>"

    html = _SCRIPT_SRC.sub(inject_js, html)

    def inject_asset(match: re.Match[str]) -> str:
        pre, src, post = match.group(1), match.group(2), match.group(3)
        path = _resolve(base, src)
        if not path or path.stat().st_size > 1_500_000:
            return match.group(0)
        if path.suffix.lower() in {".css", ".js", ".mjs"}:
            return match.group(0)
        return f"{pre}{_data_uri(path)}{post}"

    html = _IMG_SRC.sub(inject_asset, html)
    return html


def hide_streamlit_chrome() -> None:
    st.markdown(
        """
        <style>
          [data-testid="stHeader"] { display: none; }
          [data-testid="stToolbar"] { display: none; }
          .block-container { padding: 0 !important; max-width: 100% !important; }
          footer { visibility: hidden; }
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_live_site(
    html_path: Path,
    *,
    height: int = 920,
    about_title: str = "About this app",
    about_md: str = "",
) -> None:
    hide_streamlit_chrome()
    html = build_standalone_html(html_path)
    components.html(html, height=height, scrolling=True)
    if about_md:
        with st.expander(about_title, expanded=False):
            st.markdown(about_md)
