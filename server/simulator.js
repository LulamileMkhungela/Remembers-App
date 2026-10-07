/**
 * "Phone activity" — the events that keep arriving on a real phone.
 *
 * Each event is one thing the device notices, extracts text from, and adds to
 * the index. Advancing the simulator makes the library grow and proves the
 * point of the whole app: the index is not a one-off import, it is the phone
 * getting better at remembering the longer you use it.
 */

export const EVENTS = [
  {
    id: 'message-mechanic',
    app: 'Messages',
    icon: '💬',
    label: 'Thabo texts the number',
    blurb: 'A message arrives with the mechanic’s number in it.',
    proves: 'what is the mechanic’s number?',
    item: {
      id: 'msg-thabo-mechanic',
      kind: 'message',
      source: 'Messages',
      app: 'Messages',
      title: 'Thabo Nkosi · “that number”',
      daysAgo: 0,
      time: null,
      people: ['Thabo Nkosi'],
      from: 'Thabo Nkosi',
      summary: 'Thabo sending the garage number again: 073 630 7561, and they are open on Saturdays.',
      body: `Message from Thabo Nkosi: "That number again in case you lost it, 073 630 7561. Tell them I sent you. They are open Saturdays until one if you want to drop the car and walk."`,
      tags: ['car', 'mechanic', 'number', 'message', 'nkomo', 'garage']
    }
  },
  {
    id: 'page-sintra',
    app: 'Chrome',
    icon: '🌐',
    label: 'Sintra train times saved as a page',
    blurb: 'You look up the train from Lisbon to Sintra and keep the page.',
    proves: 'when does the Sintra train leave?',
    item: {
      id: 'page-sintra-times',
      kind: 'page',
      source: 'Safari Reading List',
      app: 'Safari',
      title: 'Lisbon → Sintra train times and prices',
      daysAgo: 0,
      time: null,
      url: 'cp.pt/en/lisbon-sintra-timetable',
      summary: 'Sintra trains leave Rossio every 30 minutes, €2.30 single, 40 minutes, buy the day before.',
      body: `Train timetable Lisbon Rossio to Sintra. Trains leave roughly every 30 minutes from early morning to late evening, the journey takes about 40 minutes, a single ticket is €2.30 and a day return is €4.60. Tip on the page: buy it the day before in the app so you are not queueing, and sit on the left for the view out of the city. Sintra is the last stop, so you cannot miss it.`,
      tags: ['lisbon', 'sintra', 'train', 'travel', 'timetable', 'portugal']
    }
  },
  {
    id: 'screenshot-price-drop',
    app: 'Safari',
    icon: '🖼',
    label: 'Price alert fires — you screenshot it',
    blurb: 'The flight alert you set drops. You grab the screen.',
    proves: 'did the flight price drop?',
    item: {
      id: 'shot-flight-alert',
      kind: 'screenshot',
      source: 'Screenshots',
      app: 'Mail',
      title: 'Price alert · CPT → LON now R8 890',
      daysAgo: 0,
      time: null,
      summary: 'Price alert email: the Cape Town to London fare dropped to R8 890, down from R9 420.',
      body: `Price alert email from Skyscanner. Cape Town to London, March, one way. The fare dropped from R9 420 to R8 890, hand luggage only, Turkish Airlines via Istanbul, 18h 40m. The alert says prices in the last three days have been falling and it will keep watching the route. Button in the email: "See the flights".`,
      tags: ['flights', 'travel', 'alert', 'cheap', 'drop', 'price', 'london']
    }
  },
  {
    id: 'voice-wine',
    app: 'Voice Memos',
    icon: '🎙',
    label: 'Voice memo on the walk home',
    blurb: 'A ten-second note about the wine and the book.',
    proves: 'what do I owe Thabo?',
    item: {
      id: 'voice-wine',
      kind: 'voice',
      source: 'Voice Memos',
      title: 'Voice memo · 0:11 · “the bottle”',
      daysAgo: 0,
      time: null,
      duration: '0:11',
      summary: 'Voice memo: buy the Portuguese red for Thabo, and give him the money for the book he lent me.',
      body: `Transcript: The red one is two hundred and twenty rand a bottle at the shop on the corner, I checked. Buy one for when Thabo brings the book back, and give him the money for the book itself, I still owe him for it. Do not forget again.`,
      tags: ['wine', 'thabo', 'book', 'voice', 'shopping', 'reminder']
    }
  }
];

export const RESET_NOTE = 'Clears everything added by the simulator and re-indexes the original library.';

export function applyEvent(store, id) {
  const event = EVENTS.find((e) => e.id === id);
  if (!event) return null;
  const item = { ...event.item, id: `${event.item.id}` };
  const added = store.addItem(item, `Added by ${event.app}`);
  return {
    event: { id: event.id, app: event.app, icon: event.icon, label: event.label, blurb: event.blurb, proves: event.proves },
    added,
    indexed: store.stats().indexed,
    proves: event.proves
  };
}
