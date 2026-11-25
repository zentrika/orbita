import re

import nh3

_ALLOWED_TAGS = {
    "p", "br", "strong", "b", "em", "i", "u", "s", "code", "pre", "blockquote",
    "ul", "ol", "li", "h1", "h2", "h3", "a", "hr", "span",
}
_ALLOWED_ATTRS = {"a": {"href", "title"}, "span": {"data-mention", "class"}}


def clean_html(html: str | None) -> str:
    if not html:
        return ""
    return nh3.clean(
        html,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        url_schemes={"http", "https", "mailto"},
        link_rel="noopener noreferrer nofollow",
    )


_MENTION_RE = re.compile(r"(?<![\w.])@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Za-z0-9_.-]{2,40})")


def extract_mentions(text: str) -> set[str]:
    """Devuelve los identificadores mencionados (@correo o @usuario)."""
    plain = re.sub(r"<[^>]+>", " ", text or "")
    return {m.group(1).rstrip(".").lower() for m in _MENTION_RE.finditer(plain)}
