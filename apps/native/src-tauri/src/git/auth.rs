//! Shared libgit2 authentication helpers.

use git2::{Cred, FetchOptions, RemoteCallbacks};

/// Sanitize a clone URL for logging, removing any embedded credentials.
pub fn sanitize_clone_url_for_logs(clone_url: &str) -> String {
    if let Ok(mut url) = url::Url::parse(clone_url) {
        let _ = url.set_username("");
        let _ = url.set_password(None);
        return url.to_string();
    }

    if let Some((_, rest)) = clone_url.split_once('@')
        && rest.contains(':')
    {
        return format!("***@{}", rest);
    }

    clone_url.to_string()
}

/// Checks if the given clone URL is a GitHub URL, either in HTTPS or SSH form.
pub fn is_github_clone_url(clone_url: &str) -> bool {
    if clone_url.starts_with("git@github.com:") {
        return true;
    }

    url::Url::parse(clone_url)
        .ok()
        .and_then(|url| url.host_str().map(|h| h.to_ascii_lowercase()))
        .is_some_and(|host| host == "github.com" || host == "www.github.com")
}

/// Build fetch options with the standard nixmac libgit2 credential flow.
///
/// If `token` is provided, it is attempted first for HTTPS username/password
/// authentication using GitHub App's `x-access-token` convention. After that,
/// the callback falls back to SSH agent credentials, the user's git credential
/// helper, and libgit2 defaults.
pub fn authenticated_fetch_options(token: Option<String>) -> FetchOptions<'static> {
    let git_config = git2::Config::open_default().ok();
    let mut token_attempted = false;
    let mut ssh_agent_attempted = false;
    let mut credential_helper_attempted = false;
    let mut callbacks = RemoteCallbacks::new();

    callbacks.credentials(move |url, username_from_url, allowed| {
        if allowed.contains(git2::CredentialType::USERNAME)
            && !allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT)
            && !allowed.contains(git2::CredentialType::SSH_KEY)
            && !allowed.contains(git2::CredentialType::DEFAULT)
        {
            return Cred::username(username_from_url.unwrap_or("git"));
        }

        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) && !token_attempted {
            token_attempted = true;
            if let Some(token) = token.as_deref() {
                return Cred::userpass_plaintext("x-access-token", token);
            }
        }

        if allowed.contains(git2::CredentialType::SSH_KEY) && !ssh_agent_attempted {
            ssh_agent_attempted = true;
            return Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"));
        }

        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT)
            && !credential_helper_attempted
        {
            credential_helper_attempted = true;
            if let Some(config) = &git_config
                && let Ok(credential) = Cred::credential_helper(config, url, username_from_url)
            {
                return Ok(credential);
            }
        }

        if allowed.contains(git2::CredentialType::DEFAULT) {
            return Cred::default();
        }

        Err(git2::Error::from_str(
            "no supported authentication methods succeeded",
        ))
    });

    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);
    fetch_options
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_clone_url_for_logs() {
        let url = "https://user:password@github.com/repo.git";
        let sanitized = sanitize_clone_url_for_logs(url);
        assert_eq!(sanitized, "https://github.com/repo.git");

        let url = "ssh://user:password@github.com/repo.git";
        let sanitized = sanitize_clone_url_for_logs(url);
        assert_eq!(sanitized, "ssh://github.com/repo.git");

        let url = "git://user:password@github.com/repo.git";
        let sanitized = sanitize_clone_url_for_logs(url);
        assert_eq!(sanitized, "git://github.com/repo.git");
    }

    #[test]
    fn test_is_github_clone_url() {
        assert!(is_github_clone_url("https://github.com/repo.git"));
        assert!(is_github_clone_url("https://www.github.com/repo.git"));
        assert!(is_github_clone_url("git@github.com:owner/repo.git"));
        assert!(!is_github_clone_url("https://gitlab.com/repo.git"));
    }
}
