yq_bin := "nix run nixpkgs#yq --"
rootdir := `git rev-parse --show-toplevel`
secrets := f"{{rootdir}}/.secrets.enc.yaml"
alchemy_pw_cmd := f"sops decrypt --extract '[\"ALCHEMY_PASSWORD\"]' {{secrets}}"
web_index_path := f"{{rootdir}}/apps/web/.output/server/index.mjs"
server_index_path := f"{{rootdir}}/apps/server/dist/index.mjs"


install:
  bun install

build app: install
  bun run -F {{app}} build

start app: (build app)
  sops exec-env {{secrets}} 'bun run --bun {{server_index_path}}'

deploy-build-artifact app region='us-west-2':
  bash "{{rootdir}}/scripts/deploy/build-artifact.sh" "{{app}}" "{{region}}"

deploy-publish-artifact app region='us-west-2':
  bash "{{rootdir}}/scripts/deploy/publish-artifact.sh" "{{app}}" "{{region}}"

deploy app region='us-west-2':
  if [ "{{app}}" = "server" ]; then bash "{{rootdir}}/scripts/deploy/deploy-server.sh" "{{app}}" "{{region}}"; else just build "{{app}}" && sops exec-env "{{secrets}}" 'env && bun "{{rootdir}}/apps/{{app}}/alchemy.run.ts"'; fi

deploy-status app region='us-west-2':
  bun "{{rootdir}}/scripts/deploy/status.ts" "{{app}}" "{{region}}"

deploy-logs app region='us-west-2' lines='120':
  bun "{{rootdir}}/scripts/deploy/logs.ts" "{{app}}" "{{region}}" "{{lines}}"


# ------ Secrets Management -------
secrets-set env key value:
  sops decrypt {{secrets}} \
    | {{yq_bin}} 'setpath(["{{key}}"]; "{{value}}")' -y \
    | sops encrypt --output {{secrets}} --filename-override .secrets.enc.yaml
