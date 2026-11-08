#!/bin/sh
# Registers the native messaging host for Brave and Chrome. Safe to re-run.
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
HOST_NAME=com.jnjacobson.lachs
SHIM="$HOME/.local/share/lachs/native-host"
NODE=$(command -v node) || { echo "node is not on PATH" >&2; exit 1; }

EXTENSION_ID=$("$NODE" -e '
const { createHash } = require("node:crypto");
const { key } = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
console.log([...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join(""));
' "$REPO/extension/manifest.json")

# Browsers start native hosts with a minimal PATH, so the shim pins node's path.
mkdir -p "$(dirname "$SHIM")"
cat > "$SHIM" <<EOF
#!/bin/sh
exec "$NODE" "$REPO/helper/host.js" "\$@"
EOF
chmod +x "$SHIM"

for browser in "BraveSoftware/Brave-Browser" "Google/Chrome"; do
  dir="$HOME/Library/Application Support/$browser"
  [ -d "$dir" ] || continue
  mkdir -p "$dir/NativeMessagingHosts"
  cat > "$dir/NativeMessagingHosts/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "lachs: finds the Claude session that created a pull request",
  "path": "$SHIM",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
  echo "Registered native host for $browser"
done

echo "Extension folder:          $REPO/extension"
echo "Extension ID:              $EXTENSION_ID"
echo "Zed terminal_init_command: $REPO/bin/lachs-zed init"
