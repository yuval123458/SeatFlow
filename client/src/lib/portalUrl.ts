export function portalUrl(token?: string) {
  return token ? `${window.location.origin}/portal/${token}` : "";
}
