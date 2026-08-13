#!/usr/bin/env python3
"""Serve a local static site as the live Streamlit app UI (HF Space–style)."""

from __future__ import annotations

import base64
import json
import mimetypes
import re
from pathlib import Path
from urllib.parse import unquote, urlparse

_LINK_CSS = re.compile(
    r'<link[^>]+rel=["\']stylesheet["\'][^>]*href=["\']([^"\']+)["\'][^>]*/?>',
    re.I,
)
_MODULE_PRELOAD = re.compile(
    r'<link[^>]+rel=["\']modulepreload["\'][^>]*/?>',
    re.I,
)
_MANIFEST_OR_SW = re.compile(
    r'<link[^>]+rel=["\']manifest["\'][^>]*/?>|'
    r'<script[^>]+id=["\']vite-plugin-pwa:register-sw["\'][^>]*>\s*</script>|'
    r'<script[^>]+src=["\'][^"\']*registerSW\.js["\'][^>]*>\s*</script>',
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
_JS_FROM = re.compile(
    r'''(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']'''
)
_HTML_HREF = re.compile(
    r'''href=(["'])([^"']+\.html(?:#[^"']*)?)\1''',
    re.I,
)


def _data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _strip_query(ref: str) -> str:
    return unquote(ref.split("?")[0].split("#")[0].strip())


def _resolve(base: Path, ref: str, site_root: Path | None = None) -> Path | None:
    ref = _strip_query(ref)
    if not ref or ref.startswith(("http://", "https://", "data:", "mailto:", "tel:", "//", "blob:")):
        return None
    root = (site_root or base).resolve()
    if ref.startswith("/"):
        cand = (root / ref.lstrip("/")).resolve()
    else:
        cand = (base / ref).resolve()
    try:
        cand.relative_to(root)
    except ValueError:
        return None
    return cand if cand.is_file() else None


def _collect_modules(entry: Path) -> dict[Path, str]:
    """Return {path: virtual_id} for entry and its static import graph."""
    paths: list[Path] = []
    seen: set[Path] = set()
    queue = [entry.resolve()]
    while queue:
        path = queue.pop()
        if path in seen or not path.is_file():
            continue
        seen.add(path)
        paths.append(path)
        text = path.read_text(encoding="utf-8", errors="replace")
        for m in _JS_FROM.finditer(text):
            spec = m.group(1)
            if spec.startswith(("http://", "https://", "data:", "virtual:")):
                continue
            dep = (path.parent / _strip_query(spec)).resolve()
            if dep.is_file() and dep not in seen:
                queue.append(dep)

    by_name: dict[str, list[Path]] = {}
    for p in paths:
        by_name.setdefault(p.name, []).append(p)

    out: dict[Path, str] = {}
    for p in paths:
        if len(by_name[p.name]) == 1:
            out[p] = f"virtual:{p.name}"
        else:
            out[p] = f"virtual:{p.as_posix()}"
    return out


def _rewrite_module_imports(text: str, path: Path, id_for: dict[Path, str]) -> str:
    def repl(m: re.Match[str]) -> str:
        spec = m.group(1)
        if spec.startswith(("http://", "https://", "data:", "virtual:")):
            return m.group(0)
        dep = (path.parent / _strip_query(spec)).resolve()
        vid = id_for.get(dep)
        if not vid:
            return m.group(0)
        return m.group(0).replace(spec, vid, 1)

    return _JS_FROM.sub(repl, text)


def _build_importmap_and_entries(
    html: str,
    base: Path,
    site_root: Path | None,
) -> str:
    entries: list[Path] = []

    def find_modules(match: re.Match[str]) -> str:
        pre, src, post = match.group(1), match.group(2), match.group(3)
        attrs = f"{pre} {post}".lower()
        path = _resolve(base, src, site_root)
        if not path:
            return match.group(0)
        if "module" in attrs:
            entries.append(path)
            return f"<!-- module entry: {src} -->"
        js = path.read_text(encoding="utf-8", errors="replace")
        return f"<script{pre}{post}>\n{js}\n</script>"

    html = _SCRIPT_SRC.sub(find_modules, html)
    if not entries:
        return html

    id_for: dict[Path, str] = {}
    for entry in entries:
        id_for.update(_collect_modules(entry))

    imports: dict[str, str] = {}
    for path, vid in id_for.items():
        rewritten = _rewrite_module_imports(
            path.read_text(encoding="utf-8", errors="replace"), path, id_for
        )
        b64 = base64.b64encode(rewritten.encode("utf-8")).decode("ascii")
        imports[vid] = f"data:text/javascript;base64,{b64}"

    blocks = [
        f'<script type="importmap">{json.dumps({"imports": imports})}</script>'
    ]
    for entry in entries:
        blocks.append(f'<script type="module">import "{id_for[entry.resolve()]}";</script>')

    injection = "\n".join(blocks)
    if re.search(r"</head>", html, re.I):
        return re.sub(r"</head>", injection + "\n</head>", html, count=1, flags=re.I)
    return injection + html


def _inject_page_nav(html: str, routes: dict[str, str]) -> str:
    """Rewrite *.html links so they navigate the parent Streamlit app via ?page=."""
    if not routes:
        return html

    home = routes.get("index.html", "home")

    def page_for(href: str) -> str | None:
        path_part = href.split("#", 1)[0]
        name = Path(urlparse(path_part).path).name
        if not name or name in (".", "./"):
            name = "index.html"
        return routes.get(name)

    def repl_href(m: re.Match[str]) -> str:
        quote, href = m.group(1), m.group(2)
        page = page_for(href)
        if not page:
            return m.group(0)
        frag = href.split("#", 1)[1] if "#" in href else ""
        q = f"?page={page}" + (f"#{frag}" if frag else "")
        return f'href={quote}{q}{quote} target="_top"'

    html = _HTML_HREF.sub(repl_href, html)
    html = re.sub(
        r'''href=(["'])\./\1''',
        rf'href=\1?page={home}\1 target="_top"',
        html,
    )
    html = re.sub(
        r'''href=(["'])\./#(.*?)\1''',
        rf'href=\1?page={home}#\2\1 target="_top"',
        html,
    )
    return html


def build_standalone_html(
    html_path: Path,
    *,
    site_root: Path | None = None,
    page_routes: dict[str, str] | None = None,
) -> str:
    """Inline local CSS/JS/assets; preserve Vite ES modules via import maps."""
    base = html_path.parent
    root = (site_root or base).resolve()
    html = html_path.read_text(encoding="utf-8", errors="replace")

    html = _MODULE_PRELOAD.sub("", html)
    html = _MANIFEST_OR_SW.sub("", html)

    def inject_css(match: re.Match[str]) -> str:
        href = match.group(1)
        path = _resolve(base, href, root)
        if not path:
            return match.group(0)
        css = path.read_text(encoding="utf-8", errors="replace")

        def css_url(m: re.Match[str]) -> str:
            u = m.group(1).strip(" \"'")
            p = _resolve(path.parent, u, root)
            if not p or p.stat().st_size > 1_500_000:
                return m.group(0)
            return f"url({_data_uri(p)})"

        css = re.sub(r"url\(([^)]+)\)", css_url, css)
        return f"<style>\n{css}\n</style>"

    html = _LINK_CSS.sub(inject_css, html)
    html = _build_importmap_and_entries(html, base, root)

    def inject_asset(match: re.Match[str]) -> str:
        pre, src, post = match.group(1), match.group(2), match.group(3)
        path = _resolve(base, src, root)
        if not path or path.stat().st_size > 1_500_000:
            return match.group(0)
        if path.suffix.lower() in {".css", ".js", ".mjs"}:
            return match.group(0)
        return f"{pre}{_data_uri(path)}{post}"

    html = _IMG_SRC.sub(inject_asset, html)

    if page_routes:
        html = _inject_page_nav(html, page_routes)

    return html


def hide_streamlit_chrome() -> None:
    import streamlit as st

    st.markdown(
        """
        <style>
          [data-testid="stHeader"] { display: none; }
          [data-testid="stToolbar"] { display: none; }
          [data-testid="stSidebar"] { display: none; }
          .block-container { padding: 0 !important; max-width: 100% !important; }
          footer { visibility: hidden; }
          #MainMenu { visibility: hidden; }
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
    site_root: Path | None = None,
    page_routes: dict[str, str] | None = None,
) -> None:
    import streamlit as st
    import streamlit.components.v1 as components

    hide_streamlit_chrome()
    html = build_standalone_html(
        html_path, site_root=site_root, page_routes=page_routes
    )
    components.html(html, height=height, scrolling=True)
    if about_md:
        with st.expander(about_title, expanded=False):
            st.markdown(about_md)


def render_multipage_site(
    pages: dict[str, Path],
    *,
    default: str = "home",
    height: int = 1100,
    about_title: str = "About this app",
    about_md: str = "",
    site_root: Path | None = None,
) -> None:
    """pages: query key -> html path (home->index.html, app->app.html)."""
    import streamlit as st

    page = (st.query_params.get("page") or default).strip().lower()
    if page not in pages:
        page = default
    routes = {path.name: key for key, path in pages.items()}
    render_live_site(
        pages[page],
        height=height,
        about_title=about_title,
        about_md=about_md,
        site_root=site_root,
        page_routes=routes,
    )
