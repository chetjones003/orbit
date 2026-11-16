//! GitHub endpoints. A loopback override (ORBIT_GITHUB_URL) points the app at the fake GitHub for tests.
//! It is accepted only as a bare loopback http origin, so tokens never reach a remote host through it.

#[derive(Clone, Debug)]
pub struct GitHubEndpoints {
    pub oauth_base_url: String,
    pub api_base_url: String,
    pub uploads_base_url: String,
}

pub fn github_endpoints() -> GitHubEndpoints {
    GitHubEndpoints {
        oauth_base_url: "https://github.com".into(),
        api_base_url: "https://api.github.com".into(),
        uploads_base_url: "https://uploads.github.com".into(),
    }
}

pub fn resolve_github_endpoints(override_url: Option<&str>) -> GitHubEndpoints {
    let Some(raw) = override_url else {
        return github_endpoints();
    };
    let Ok(url) = url::Url::parse(raw) else {
        return github_endpoints();
    };
    let loopback = matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"));
    let bare = url.path() == "/" && url.query().is_none() && url.fragment().is_none() && url.username().is_empty();
    if url.scheme() != "http" || !loopback || !bare {
        return github_endpoints();
    }
    let host = url.host_str().unwrap_or_default();
    let base = match url.port() {
        Some(port) => format!("http://{host}:{port}"),
        None => format!("http://{host}"),
    };
    GitHubEndpoints {
        oauth_base_url: base.clone(),
        api_base_url: base.clone(),
        uploads_base_url: base,
    }
}
