# Clone the requested branch into the output directory, then discard Git metadata.
# Arguments: output directory, GitHub repository name, branch.
clone_content_repo() {
  echo "Cloning repository '$2' from branch '$3'..."
  # Only the Git process and its helper receive the token. The clone URL and
  # the persisted origin contain no credentials, and the helper ignores stores.
  DOCS_CLONE_TOKEN="$GITHUB_TOKEN" GIT_TERMINAL_PROMPT=0 git \
    -c credential.helper= \
    -c 'credential.https://github.com.helper=!f() { if [ "$1" = get ]; then printf "username=x-access-token\npassword=%s\n" "$DOCS_CLONE_TOKEN"; fi; }; f' \
    clone --depth 1 --branch "$3" "https://github.com/github/$2.git" "$1" || return 1
  rm -rf -- "$1/.git"
}
