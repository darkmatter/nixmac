# Go development configuration
{ config, pkgs, lib, ... }:

{
  programs.go = {
    enable = true;
    goPath = "go";
    goBin = "go/bin";
  };

  home.sessionVariables = {
    GOPATH = "${config.home.homeDirectory}/go";
    GOBIN = "${config.home.homeDirectory}/go/bin";
  };

  home.sessionPath = [
    "${config.home.homeDirectory}/go/bin"
  ];
}

