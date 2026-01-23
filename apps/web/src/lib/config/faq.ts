export const faqConfig = [
  {
    question: "What is Nixmac?",
    answer:
      "Nixmac is a macOS-native app that makes it simple to install and manage Nix packages and environments on your Mac.",
  },
  {
    question: "Do I need to know Nix to use Nixmac?",
    answer:
      "No. Nixmac is designed to be approachable for newcomers while still powerful for advanced users.",
  },
  {
    question: "Is Nixmac free?",
    answer: "Yes. Nixmac is free to use.",
  },
  {
    question: "Which macOS versions are supported?",
    answer: "Nixmac supports macOS 12 and newer.",
  },
  {
    question: "Does Nixmac require Apple Silicon?",
    answer: "No. Nixmac supports both Apple Silicon and Intel Macs.",
  },
  {
    question: "Does it modify my system?",
    answer:
      "Nixmac installs Nix in a standard, isolated way and keeps changes contained to Nix-managed locations.",
  },
  {
    question: "Will Nixmac mess up my Mac or existing environment?",
    answer:
      "No. Nixmac is designed to be safe and reversible. It uses the official Nix installer, keeps changes isolated, and provides a guided uninstall so you can revert cleanly if needed.",
  },
  {
    question: "Can I uninstall Nixmac and Nix cleanly?",
    answer:
      "Yes. Nixmac provides a guided uninstall flow and cleans up Nix-managed files.",
  },
  {
    question: "Can I use Nixmac with existing Nix setups?",
    answer:
      "Yes. Nixmac can detect existing Nix installations and work with them.",
  },
  {
    question: "Does Nixmac support flakes?",
    answer:
      "Yes. Nixmac supports flakes and lets you manage flake-based configurations.",
  },
  {
    question: "Is Nixmac open source?",
    answer: "Yes. Nixmac is open source.",
  },
  {
    question: "Is it safe to use?",
    answer:
      "Yes. Nixmac uses official Nix installers and best practices for macOS.",
  },
  {
    question: "Where can I get help or report issues?",
    answer:
      "You can reach support or file issues through the Nixmac GitHub repository or the contact link on the website.",
  },
] as const;

export type FAQItem = (typeof faqConfig)[number];