{ config, ... }:

{
  # Secret declarations and consumer bindings live here.
  # The agent can append entries under `sops.secrets` and export paths via
  # `environment.variables` for runtime consumers.

  sops.secrets = {
    # Example (agent should follow this exact shape):
    # "github-token" = {
    #   sopsFile = ../../secrets/github-token.yaml;
    #   path = "/run/secrets/github-token";
    #   owner = config.system.primaryUser;
    #   group = "staff";
    #   mode = "0400";
    # };
  };

  environment.variables = {
    # Example runtime binding:
    # GITHUB_TOKEN_FILE = config.sops.secrets."github-token".path;
  };
}
