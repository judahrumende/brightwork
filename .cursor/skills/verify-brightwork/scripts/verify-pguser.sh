verify_pguser() {
  printf '%s\n' "${VERIFY_PGUSER:-$(whoami)}"
}