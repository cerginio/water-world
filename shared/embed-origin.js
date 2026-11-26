// Origin з URL лише звужує allowlist, але не надає дозволу.
export function parentOrigin(location, { devOrigin = null } = {}) {
  const requested = new URL(location.href).searchParams.get('embed-origin');
  if (!requested) return location.origin;
  const allowed = ['https://explore.storytilecraft.space', location.origin];
  if (devOrigin) allowed.push(devOrigin);
  return allowed.includes(requested) ? requested : null;
}

export function acceptsParent(event, target, origin) {
  return !!origin && target.parent !== target && event.source === target.parent && event.origin === origin;
}
