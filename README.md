# nixmac

## Getting Started

### 1. Install Nix

Install Nix using [Determinate Nix Installer](https://github.com/DeterminateSystems/nix-installer):

```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

### 2. Install devenv

Install [devenv](https://devenv.sh):

```bash
nix profile add nixpkgs#devenv
```

### 3. Decryption Key

Choose one:

- Copy/paste the key "SOPS Age Key Dev" from 1Password into `~/.config/sops/age/keys.txt`, or:
- Asssume any `darkmatter-` role in AWS: `aws configure sso` then follow the instructions to configure an available role. If you don't see one, ping @coopmoney

### 4. Start the development environment

```bash
devenv up
```
