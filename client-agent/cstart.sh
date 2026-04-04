#!/bin/bash
echo "Select chain:"
echo "  1) X Layer (196) [default]"
echo "  2) Unichain (130)"
read -p "Choice [1]: " choice
choice=${choice:-1}
case $choice in
  2) CHAIN_ID=130; NAME="Unichain" ;;
  *) CHAIN_ID=196; NAME="X Layer" ;;
esac
echo "⛓️  $NAME ($CHAIN_ID)"
cd ~/xflow/client-agent && CHAIN_ID=$CHAIN_ID npx tsx index.ts
