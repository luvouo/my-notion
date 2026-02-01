import { workspaceIdFromPasscode } from "./crypto-utils.js";

const PASS_KEY = "bora_widgets_passcode_v1";

export function getSavedPasscode() {
  return localStorage.getItem(PASS_KEY) || "";
}

export function savePasscode(passcode) {
  localStorage.setItem(PASS_KEY, passcode);
}

export async function getWorkspaceId() {
  const pass = getSavedPasscode().trim();
  if (!pass) return null;
  return await workspaceIdFromPasscode(pass);
}

