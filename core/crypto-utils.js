export async function workspaceIdFromPasscode(passcode) {
  const SALT = "bora-widget-v1";
  const input = new TextEncoder().encode(`${SALT}:${passcode}`);
  const hashBuf = await crypto.subtle.digest("SHA-256", input);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(b => b.toString(16).padStart(2, "0")).join("");
}
