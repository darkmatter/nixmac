# Templates

This directory contains some starter and notable templates.

## Base Template

The base template is what every installation of Nixmac starts with and must contain. If it's ever updated, then that update should be deployed to
all installs.

The base modules should never have any other code put into them, and their integrity must be tracked
using a checksum in order to verify that an installation has the expected base files.
