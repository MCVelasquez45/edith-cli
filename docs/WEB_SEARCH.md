# Web Search

EDITH owns web access as tools. Local models do not get unrestricted network access.

## Modes

- General: broad web search
- Current/news: recent or current-information requests
- Official: official sources for products/projects
- Documentation: current technical documentation
- Community: developer discussions, forums, articles, and comparison content
- Fetch: direct public HTTP/HTTPS URL retrieval

## Configured Providers

- DuckDuckGo HTML Search
- Official Source Search

## Optional Providers

- Brave Search API through `BRAVE_SEARCH_API_KEY`
- SearXNG through `EDITH_SEARXNG_URL`

Public SearXNG instances can be rate-limited. A self-hosted SearXNG instance is optional and was not installed as a default persistent service.

## Ranking and Fallback

EDITH normalizes results, removes duplicate URLs, ranks by search mode, and falls back across configured providers. Current/news mode demotes poor fetch targets such as search aggregators when better sources are available.

## Fetch Security

`web_fetch` validates URLs and redirects. It blocks:

- localhost
- loopback addresses
- private network ranges
- link-local addresses
- cloud metadata endpoints
- `file://`
- unsupported content types

Download size, text extraction, redirect count, and timeouts are bounded.

## Privacy

EDITH should not include private email, calendar, Drive, contacts, repository secrets, or environment variables in external search queries.

