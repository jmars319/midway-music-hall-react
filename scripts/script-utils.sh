#!/usr/bin/env bash

supports_color() {
  [ -t 1 ] && [ "${TERM:-}" != "dumb" ]
}

COLOR_RESET=""
COLOR_RED=""
COLOR_GREEN=""
COLOR_YELLOW=""
COLOR_BLUE=""
COLOR_MAGENTA=""
COLOR_CYAN=""
COLOR_BOLD=""
COLOR_DIM=""

if supports_color; then
  COLOR_RESET="$(printf '\033[0m')"
  COLOR_RED="$(printf '\033[31m')"
  COLOR_GREEN="$(printf '\033[32m')"
  COLOR_YELLOW="$(printf '\033[33m')"
  COLOR_BLUE="$(printf '\033[34m')"
  COLOR_MAGENTA="$(printf '\033[35m')"
  COLOR_CYAN="$(printf '\033[36m')"
  COLOR_BOLD="$(printf '\033[1m')"
  COLOR_DIM="$(printf '\033[2m')"
fi

log_step() {
  printf "%b\n" "${COLOR_BOLD}==>${COLOR_RESET} $*"
}

log_info() {
  printf "%b\n" "${COLOR_CYAN}INFO${COLOR_RESET} $*"
}

log_warn() {
  printf "%b\n" "${COLOR_YELLOW}WARN${COLOR_RESET} $*" >&2
}

log_error() {
  printf "%b\n" "${COLOR_RED}ERROR${COLOR_RESET} $*" >&2
}

log_success() {
  printf "%b\n" "${COLOR_GREEN}OK${COLOR_RESET} $*"
}
