# NIXMAC PRIVILEGED MODULES
# Code in this module (.nixmac) contains core functionality that must always
# exist in order for Nixmac to function properly. Ensure that the system prompt
# always contains a rule that prevents LLM's from modifying any code in the .nixmac
# directory.
{ ... }:
{
  imports = [
    ./ssh-fda.nix
  ];
}
