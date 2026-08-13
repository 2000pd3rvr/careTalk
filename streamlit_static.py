#!/usr/bin/env python3
"""Serve a local static site as the live Streamlit app UI (HF Space–style).

Performance rules:
  - Inline only tiny local assets (≤8KB). Larger files load from jsDelivr/GitHub CDN.
  - Prefer Pexels CDN for known video IDs; shrink remote gallery images.
  - Keep CSS/JS inlined to avoid extra RTTs inside the Streamlit iframe.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import re
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlencode, urlparse, urlunparse

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
_ATTR_URL = re.compile(
    r'''((?:src|href|poster|data-src)=["'])([^"']+)(["'])''',
    re.I,
)
_JS_FROM = re.compile(
    r'''(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']'''
)
_HTML_HREF = re.compile(
    r'''href=(["'])([^"']+\.html(?:#[^"']*)?)\1''',
    re.I,
)

# Prefer 720p/SD Pexels CDN over Hugging Face dataset redirects (multi-second TTFB).
_PEXELS_VIDEO_CDN: dict[str, str] = {
    "3680687": "https://videos.pexels.com/video-files/3680687/3680687-sd_960_540_25fps.mp4",
    "4109542": "https://videos.pexels.com/video-files/4109542/4109542-hd_1280_720_25fps.mp4",
    "4519062": "https://videos.pexels.com/video-files/4519062/4519062-hd_1280_720_25fps.mp4",
    "6288304": "https://videos.pexels.com/video-files/6288304/6288304-sd_960_540_25fps.mp4",
    "6529453": "https://videos.pexels.com/video-files/6529453/6529453-hd_1280_720_30fps.mp4",
    "7015435": "https://videos.pexels.com/video-files/7015435/7015435-sd_960_540_30fps.mp4",
    "8523306": "https://videos.pexels.com/video-files/8523306/8523306-hd_1280_720_30fps.mp4",
    "8964522": "https://videos.pexels.com/video-files/8964522/8964522-hd_1280_720_25fps.mp4",
    "12769418": "https://videos.pexels.com/video-files/12769418/12769418-hd_1280_720_25fps.mp4",
    # careTalk hero playlist — 720p instead of 1080p
    "4053216": "https://videos.pexels.com/video-files/4053216/4053216-hd_1280_720_25fps.mp4",
    "5941023": "https://videos.pexels.com/video-files/5941023/5941023-hd_1280_720_25fps.mp4",
}

_INLINE_MAX = 8_192  # bytes — icons/SVG only
_FAST_HEAD = """
<link rel="preconnect" href="https://images.pexels.com" crossorigin>
<link rel="preconnect" href="https://videos.pexels.com" crossorigin>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="dns-prefetch" href="https://huggingface.co">
<style id="st-fast-media">
  img,video{content-visibility:auto;contain-intrinsic-size:640px 400px}
  img{background:transparent}
  video{background:#111}
  img[loading="lazy"],video[preload="none"]{content-visibility:auto}
</style>
"""


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


def _cdn_url(path: Path, site_root: Path, asset_cdn: str | None) -> str | None:
    if not asset_cdn:
        return None
    try:
        rel = path.resolve().relative_to(site_root.resolve()).as_posix()
    except ValueError:
        return None
    return asset_cdn.rstrip("/") + "/" + rel.lstrip("/")


def _collect_modules(entry: Path) -> dict[Path, str]:
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


def _optimize_remote_url(url: str) -> str:
    """Shrink gallery images and swap HF-hosted Pexels clips onto videos.pexels.com."""
    if not url or url.startswith("data:"):
        return url

    # HF / local filenames that embed a Pexels id
    m = re.search(r"pexels-video-(\d+)\.mp4", url, re.I)
    if not m:
        m = re.search(r"/videos/(?:hero/)?(\d+)\.mp4", url, re.I)
    if not m:
        m = re.search(r"video-files/(\d+)/", url, re.I)
    if m:
        pid = m.group(1)
        mapped = _PEXELS_VIDEO_CDN.get(pid)
        if mapped:
            return mapped
        # Prefer 720p over 1080p when already on Pexels CDN
        url = re.sub(
            rf"{pid}-hd_1920_1080_\d+fps\.mp4",
            f"{pid}-hd_1280_720_25fps.mp4",
            url,
        )

    if "images.pexels.com" in url.lower():
        parsed = urlparse(url)
        q = dict(parse_qsl(parsed.query, keep_blank_values=True))
        # Gallery thumbs: small + compressed. Keep auto=compress.
        w = int(q.get("w") or "0") or 800
        q["auto"] = "compress"
        q["cs"] = "tinysrgb"
        q["w"] = str(min(w, 480))
        # Drop huge intrinsic hints that fight responsive layouts
        return urlunparse(parsed._replace(query=urlencode(q)))

    return url


def _speed_tune_html(html: str) -> str:
    def repl(m: re.Match[str]) -> str:
        pre, url, post = m.group(1), m.group(2), m.group(3)
        return f"{pre}{_optimize_remote_url(url)}{post}"

    html = _ATTR_URL.sub(repl, html)
    # Also rewrite playlist JSON / inline strings that hold video URLs
    for pid, mapped in _PEXELS_VIDEO_CDN.items():
        html = re.sub(
            rf"https://[^\"'\s]*pexels-video-{pid}\.mp4",
            mapped,
            html,
            flags=re.I,
        )
        html = re.sub(
            rf"https://videos\.pexels\.com/video-files/{pid}/{pid}-hd_1920_1080_\d+fps\.mp4",
            mapped,
            html,
            flags=re.I,
        )
    return html


def build_standalone_html(
    html_path: Path,
    *,
    site_root: Path | None = None,
    page_routes: dict[str, str] | None = None,
    asset_cdn: str | None = None,
) -> str:
    """Inline local CSS/JS; load images/video from CDN; preserve Vite ES modules."""
    base = html_path.parent
    root = (site_root or base).resolve()
    html = html_path.read_text(encoding="utf-8", errors="replace")

    html = _MODULE_PRELOAD.sub("", html)
    html = _MANIFEST_OR_SW.sub("", html)
    html = _speed_tune_html(html)

    def inject_css(match: re.Match[str]) -> str:
        href = match.group(1)
        path = _resolve(base, href, root)
        if not path:
            return match.group(0)
        css = path.read_text(encoding="utf-8", errors="replace")

        def css_url(m: re.Match[str]) -> str:
            u = m.group(1).strip(" \"'")
            p = _resolve(path.parent, u, root)
            if not p:
                return m.group(0)
            if p.stat().st_size <= _INLINE_MAX:
                return f"url({_data_uri(p)})"
            cdn = _cdn_url(p, root, asset_cdn)
            if cdn:
                return f"url({cdn})"
            return m.group(0)

        css = re.sub(r"url\(([^)]+)\)", css_url, css)
        return f"<style>\n{css}\n</style>"

    html = _LINK_CSS.sub(inject_css, html)
    html = _build_importmap_and_entries(html, base, root)

    def inject_asset(match: re.Match[str]) -> str:
        pre, src, post = match.group(1), match.group(2), match.group(3)
        # Remote URLs already optimized above
        if src.startswith(("http://", "https://", "data:", "//")):
            return match.group(0)
        path = _resolve(base, src, root)
        if not path:
            return match.group(0)
        if path.suffix.lower() in {".css", ".js", ".mjs"}:
            return match.group(0)
        size = path.stat().st_size
        if size <= _INLINE_MAX:
            return f"{pre}{_data_uri(path)}{post}"
        cdn = _cdn_url(path, root, asset_cdn)
        if cdn:
            return f"{pre}{cdn}{post}"
        # Last resort: skip huge base64 (keeps first paint fast; asset may 404 in iframe)
        if size > _INLINE_MAX:
            return match.group(0)
        return f"{pre}{_data_uri(path)}{post}"

    html = _ATTR_URL.sub(inject_asset, html)

    if page_routes:
        html = _inject_page_nav(html, page_routes)

    # Inject fast-media head once
    if "st-fast-media" not in html:
        if re.search(r"<head[^>]*>", html, re.I):
            html = re.sub(r"<head([^>]*)>", r"<head\1>" + _FAST_HEAD, html, count=1, flags=re.I)
        else:
            html = _FAST_HEAD + html

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


def _query_page(default: str) -> str:
    """Read ?page= across Streamlit query-param API variants."""
    import streamlit as st

    raw = None
    try:
        qp = st.query_params
        raw = qp.get("page", default) if hasattr(qp, "get") else qp["page"]
    except Exception:
        try:
            raw = (st.experimental_get_query_params() or {}).get("page", [default])
        except Exception:
            raw = default
    if isinstance(raw, (list, tuple)):
        raw = raw[0] if raw else default
    page = str(raw or default).strip().lower()
    return page or default


def _embed_html(html: str, height: int) -> None:
    """Embed HTML in a way that works on both older and newer Streamlit Cloud."""
    import streamlit as st

    # Streamlit ≥1.56 prefers st.iframe for HTML strings (no scrolling= kwarg).
    if hasattr(st, "iframe"):
        try:
            st.iframe(html, height=int(height), width="stretch")
            return
        except TypeError:
            try:
                st.iframe(html, height=int(height))
                return
            except Exception:
                pass

    import streamlit.components.v1 as components

    try:
        components.html(html, height=int(height), scrolling=True)
    except TypeError:
        # Newer wrappers may reject scrolling=
        components.html(html, height=int(height))


def render_live_site(
    html_path: Path,
    *,
    height: int = 920,
    about_title: str = "About this app",
    about_md: str = "",
    site_root: Path | None = None,
    page_routes: dict[str, str] | None = None,
    asset_cdn: str | None = None,
    **_extra: object,
) -> None:
    import streamlit as st

    hide_streamlit_chrome()
    html = build_standalone_html(
        html_path,
        site_root=site_root,
        page_routes=page_routes,
        asset_cdn=asset_cdn,
    )
    _embed_html(html, height)
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
    asset_cdn: str | None = None,
    **_extra: object,
) -> None:
    """pages: query key -> html path (home->index.html, app->app.html)."""
    page = _query_page(default)
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
        asset_cdn=asset_cdn,
    )
