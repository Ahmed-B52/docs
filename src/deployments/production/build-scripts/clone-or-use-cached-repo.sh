set -e

authenticated_git() {
  # Supply the token only to Git and use a helper that never stores credentials.
  DOCS_CLONE_TOKEN="$GITHUB_TOKEN" GIT_TERMINAL_PROMPT=0 git \
    -c credential.helper= \
    -c 'credential.https://github.com.helper=!f() { if [ "$1" = get ]; then printf "username=x-access-token\npassword=%s\n" "$DOCS_CLONE_TOKEN"; fi; }; f' \
    "$@"
}

# We use this function to use the cached version of the repo if it exists from 
# a previous Dockerfile build. Otherwise, we clone the repo and check out the
# specified branch/SHA.
# Arguments:
#   $1 - Repository name (for directory naming)
#   $2 - Repository URL
#   $3 - Branch to clone
clone_or_use_cached_repo() {
  repo_name="$1"
  repo_url="$2"
  branch="$3"
  origin_url="https://github.com/github/$repo_url.git"

  echo "Processing repository '$repo_name'..."

  if [ -d "$repo_name/.git" ]; then
    echo "Repository '$repo_name' already exists. Fetching updates..."
    cd "$repo_name" || return 1
    
    # Fetch latest changes
    if ! git config --replace-all remote.origin.url "$origin_url" ||
      ! authenticated_git fetch origin "$branch"; then
      echo "❌ Failed to fetch repository '$repo_name'"
      cd ..
      return 1
    fi
    if ! git checkout "$branch"; then
      echo "❌ Failed to checkout branch '$branch' in repository '$repo_name'"
      cd ..
      return 1
    fi
    if ! authenticated_git pull origin "$branch"; then
      echo "❌ Failed to pull repository '$repo_name'"
      cd ..
      return 1
    fi

    echo "Updated repository '$repo_name' with the latest changes from $branch."

    cd ..
  else
    echo "Cloning repository '$repo_name' from branch '$branch'..."

    # We only need the most recent change for production deploys, so we use --depth 1
    if ! authenticated_git clone --depth 1 --branch "$branch" "$origin_url" "$repo_name"; then
      echo "❌ Failed to clone repository '$repo_name'"
      return 1
    fi
  fi

  # Later Docker stages copy the working trees, so discard Git metadata here.
  rm -rf -- "$repo_name/.git" || return 1

  echo "Repository '$repo_name' is up to date."
}
