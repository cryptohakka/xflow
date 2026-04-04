#!/bin/bash
CHAINS_FILE="$(dirname "$0")/src/chains.json"

if ! command -v jq &> /dev/null; then
  echo "❌ jq is required: sudo apt install jq"
  exit 1
fi

# Build menu from chains.json
echo "Select chain:"
mapfile -t CHAIN_IDS < <(jq -r 'keys_unsorted[]' "$CHAINS_FILE")

i=1
for id in "${CHAIN_IDS[@]}"; do
  name=$(jq -r ".\"$id\".name" "$CHAINS_FILE")
  default=$( [ "$id" = "196" ] && echo " [default]" || echo "" )
  echo "  $i) $name ($id)$default"
  i=$((i+1))
done

read -p "Choice [1]: " choice

# Default to 1 if empty
choice=${choice:-1}

# Validate numeric
if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "${#CHAIN_IDS[@]}" ]; then
  echo "Invalid choice, defaulting to X Layer (196)"
  CHAIN_ID=196
else
  CHAIN_ID="${CHAIN_IDS[$((choice-1))]}"
fi

name=$(jq -r ".\"$CHAIN_ID\".name" "$CHAINS_FILE")
echo "⛓️  $name ($CHAIN_ID)"
cd ~/xflow/client-agent && CHAIN_ID=$CHAIN_ID docker compose up
