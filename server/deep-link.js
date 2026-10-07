/**
 * Where a result "opens".
 *
 * Real Remembers hands back a platform deep link (the screenshot viewer, the
 * Notes app, the Mail thread, the calendar day). Here the same shape is
 * returned, with the in-browser equivalent where one exists so the demo can be
 * clicked through.
 */

const APP = {
  note: { label: 'Notes', scheme: 'mobilenotes://' },
  email: { label: 'Mail', scheme: 'message://' },
  voice: { label: 'Voice Memos', scheme: 'voicememos://' },
  event: { label: 'Calendar', scheme: 'x-apple-caldav://' },
  contact: { label: 'Contacts', scheme: 'contacts://' }
};

export function deepLink(item) {
  if (item.view) {
    return {
      type: 'view',
      label: 'Open the screen',
      href: `/view/${item.id}`,
      note: 'Re-rendered from the captured screen'
    };
  }
  if (item.image) {
    return {
      type: 'image',
      label: 'Open in Photos',
      href: item.image,
      note: item.location ? `From ${item.location}` : 'Full photo, as saved'
    };
  }
  const app = APP[item.kind];
  return {
    type: 'source',
    label: app ? `Open in ${app.label}` : 'Show what was stored',
    href: `/api/item/${item.id}/source`,
    scheme: app?.scheme ?? null,
    note: 'The text this device kept for it'
  };
}

/** Which apps and indexes contributed to a set of results. */
export function sourceSpread(results) {
  const map = new Map();
  for (const r of results) {
    const key = r.item.source;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([source, count]) => ({ source, count }));
}
