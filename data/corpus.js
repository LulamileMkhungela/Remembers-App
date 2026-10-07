/**
 * The demo library.
 *
 * Every entry here is one item that lives "on the phone": a screenshot, a photo,
 * a saved page, a note, an email, a voice memo, a calendar entry or a contact.
 *
 * Dates are stored as `daysAgo` + `time` so the library always looks freshly
 * captured (the loader turns them into real timestamps relative to today).
 *
 * `body` is the text the on-device extractor pulled out of the item:
 *   - screenshots / pages  -> OCR + page text
 *   - photos               -> on-device vision caption + OCR of any text in frame
 *   - notes / mail / pages -> the text itself
 *   - voice memos          -> on-device speech-to-text transcript
 *   - calendar / contacts  -> the record's fields
 */

export const LIBRARY = [
  // ─────────────────────────────────────────────────────────────────────────────
  // SCREENSHOTS
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'shot-flights',
    kind: 'screenshot',
    source: 'Screenshots',
    app: 'Safari',
    title: 'Flights · Cape Town → London · 12 Mar',
    daysAgo: 212,
    time: '21:47',
    url: 'skyscanner.co.za/transport/flights/cpt/lond/260312',
    view: 'flights.html',
    summary: 'Skyscanner results for a one-way CPT → London flight on 12 March. Cheapest is R9 420 via Istanbul.',
    body: `Skyscanner flight search results. Cape Town CPT to London LHR, one way, departing 12 March, 1 adult, economy.
Cheapest fare from R9 420. Turkish Airlines, 1 stop via Istanbul, 18h 40m total, including 2h 05m layover.
Qatar Airways via Doha, 20h 05m, R10 180.
Emirates via Dubai, 22h 30m, R11 940.
KLM via Amsterdam, 1 stop, R13 260.
Cheapest month banner: March, from R9 420 one way. Price alert set for this route. Prices are for a one-way ticket, hand luggage only.`,
    tags: ['flights', 'travel', 'cheap', 'deal', 'london', 'cape town', 'booking', 'airline', 'istanbul'],
    followUps: [
      'What did the cheapest flight cost?',
      'When did I look for flights to London?',
      'What else did I save about that trip?'
    ]
  },
  {
    id: 'shot-airbnb',
    kind: 'screenshot',
    source: 'Screenshots',
    app: 'Safari',
    title: 'Airbnb · Alfama studio, Lisbon · €78 a night',
    daysAgo: 214,
    time: '22:10',
    url: 'airbnb.com/rooms/alfama-studio-lisbon',
    view: 'airbnb.html',
    summary: 'Airbnb wishlist item: a studio in Alfama, Lisbon from €78 a night, free cancellation until 5 March.',
    body: `Airbnb listing, saved to wishlist Lisbon. Alfama studio with a balcony, Lisbon, Portugal.
€78 per night, sleeps 2, 1 bed, 1 bath. Superhost Maria. 4.92 rating from 138 reviews. Free cancellation until 5 March.
"Two minutes from the Tram 28 stop, five minutes down to the river." In the guest reviews: "quiet at night, the tiled kitchen is lovely".
Total for 5 nights: €390 plus €45 cleaning fee.`,
    tags: ['travel', 'lisbon', 'accommodation', 'airbnb', 'stay', 'hotel', 'apartment', 'portugal'],
    followUps: [
      'How much was the Lisbon apartment a night?',
      'Which trip was I planning in February?'
    ]
  },
  {
    id: 'shot-bank',
    kind: 'screenshot',
    source: 'Screenshots',
    app: 'Banking',
    title: 'Card statement · Feb–Sep',
    daysAgo: 6,
    time: '08:12',
    url: 'capitec.co.za/statements',
    view: 'statement.html',
    summary: 'Card statement for February to September. Nothing marked, kept for the rent and service evidence.',
    body: `Bank statement, Visa card ending 4417, statement period February to September. Opening balance, closing balance, debit orders, fuel, groceries, salon, subscription payments. Transaction list with dates, descriptions and amounts. Interest rate and fees summary at the bottom.`,
    tags: ['bank', 'statement', 'money', 'receipt', 'admin']
  },
  {
    id: 'shot-dashboard',
    kind: 'screenshot',
    source: 'Screenshots',
    app: 'Chrome',
    title: 'Looker board · retention & activation',
    daysAgo: 214,
    time: '09:05',
    url: 'looker.company.internal/dashboards/84',
    view: 'dashboard.html',
    summary: 'Dashboard screenshot pasted into the API v2 kickoff thread — weekly retention curve and activation funnel.',
    body: `Analytics dashboard, weekly active users, retention curve for the last 12 weeks, activation funnel: signed up, first project created, invited a teammate, returned in week two. Drop-off marked at step two. Dashboard exported on a Monday morning.`,
    tags: ['work', 'dashboard', 'analytics', 'metrics', 'api', 'retention']
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // PHOTOS
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'photo-tram',
    kind: 'photo',
    source: 'Photos',
    title: 'Yellow tram, Alfama',
    daysAgo: 205,
    time: '10:24',
    image: '/assets/tram.jpg',
    location: 'Alfama, Lisbon',
    summary: 'Tram 28 climbing a steep cobbled street in Alfama, pastel buildings and washing lines overhead.',
    body: `Photo taken in Alfama, Lisbon: a yellow vintage tram, route 28, climbing a steep cobbled street between pastel buildings with laundry hanging from the balconies people walking along the calçada. Sunny morning, blue sky, steep hill, tram tracks.`,
    tags: ['lisbon', 'tram', 'travel', 'portugal', 'street', 'holiday'],
    followUps: ['What was the trip where I took that tram photo?', 'Show my Lisbon photos']
  },
  {
    id: 'photo-matcha',
    kind: 'photo',
    source: 'Photos',
    title: 'Iced matcha, corner table',
    daysAgo: 88,
    time: '11:40',
    image: '/assets/matcha.jpg',
    location: 'Camden, London',
    summary: 'Top-down photo of an iced matcha latte and pastries at the corner table — the café with plug points and long tables.',
    body: `Top-down photo of an iced matcha latte in a tall glass with pastries on a plate, on a marble café table with a linen napkin. Taken at the corner table of the café in Camden where the tables are long and there are plug points at the wall, quiet before noon, good wifi.`,
    tags: ['matcha', 'cafe', 'coffee', 'london', 'camden', 'work', 'wifi', 'quiet', 'breakfast'],
    followUps: ['Where was that café?', 'Which other cafés did I note down?']
  },
  {
    id: 'photo-receipt',
    kind: 'photo',
    source: 'Photos',
    title: 'Invoice on the passenger seat',
    daysAgo: 176,
    time: '16:02',
    image: '/assets/receipt.jpg',
    location: 'Salt River, Cape Town',
    summary: 'Garage invoice photographed in the car: VW Golf 6 1.4 TSI, oil and filters, brake fluid, spark plugs — R3 182.90.',
    body: `Photo of a printed invoice on a clipboard resting on the passenger seat of a car. Invoice from Nkomo Auto Repairs, car service, Volkswagen Golf 6 1.4 TSI. Line items: labour, engine oil, oil filter, air filter, pollen filter, spark plugs, brake fluid, coolant. Subtotal R2 767.74, VAT R415.16, total R3 182.90. Handwritten note "paid" at the bottom.`,
    tags: ['car', 'service', 'mechanic', 'invoice', 'garage', 'golf', 'money', 'repairs'],
    followUps: ['What did the car service cost?', 'Who did the service?']
  },
  {
    id: 'photo-card',
    kind: 'photo',
    source: 'Photos',
    title: 'Nkomo Auto Repairs card + car keys',
    daysAgo: 178,
    time: '16:05',
    image: '/assets/mechanic-card.jpg',
    location: 'Salt River, Cape Town',
    summary: 'The garage business card on the counter next to the Nissan keys: Nkomo Auto Repairs, 073 630 7561.',
    body: `Photo of a small white business card on a wooden counter, next to a coffee mug and a set of car keys with a Nissan keyring. OCR on the card: "NKOMO AUTO REPAIRS" with a car-and-spanner logo and the phone number 073 630 7561.`,
    tags: ['car', 'mechanic', 'garage', 'card', 'contact', 'phone', 'repairs', 'nkomo'],
    followUps: ['What is the mechanic\'s number?', 'Who did the service?']
  },
  {
    id: 'photo-wine',
    kind: 'photo',
    source: 'Photos',
    title: 'Red blend, tiled restaurant',
    daysAgo: 96,
    time: '20:55',
    image: '/assets/wine.jpg',
    location: 'Lisbon',
    summary: 'A bottle of red and a half-filled glass on a candlelit table in the tiled restaurant — the blend I said I would buy again.',
    body: `Photo of a red wine bottle and a glass on a small restaurant table in the evening, candle light, blue and white tiled wall behind. A red blend, Portuguese, poured by the glass. Warm, low light, close table.`,
    tags: ['wine', 'restaurant', 'lisbon', 'dinner', 'food', 'blend'],
    followUps: ['Which restaurant was that?', 'What did I write down about the wine?']
  },
  {
    id: 'photo-whiteboard',
    kind: 'photo',
    source: 'Photos',
    title: 'Whiteboard, API v2 kickoff',
    daysAgo: 150,
    time: '14:18',
    image: '/assets/whiteboard.jpg',
    location: '11th floor, Cape Town office',
    summary: 'Kickoff whiteboard: migration steps 1–4, the sample API response and the freeze date on an orange sticky note.',
    body: `Photo of an office whiteboard with sticky notes. Drawn flow: client apps, gateway, v1 endpoint, v2 endpoint, migration steps numbered 1 to 4, an arrow to "freeze writes". Sample response sketched in JSON. On an orange sticky note: "cutover 30 Sept", and a second note "keep v1 read-only for 90 days". Three or four people standing partly in frame.`,
    tags: ['work', 'api', 'whiteboard', 'planning', 'office', 'migration', 'meeting'],
    followUps: ['What was the cutover date?', 'What else do I have about the API v2 migration?']
  },
  {
    id: 'photo-sunset',
    kind: 'photo',
    source: 'Photos',
    title: 'Sunset from the balcony',
    daysAgo: 40,
    time: '18:52',
    image: null,
    location: 'Cape Town',
    summary: 'Blurry sunset photo over the rooftops, taken from the balcony.',
    body: `Photo of a sunset over rooftops from a balcony, warm orange sky, telephone wires in the foreground, slightly blurred and overexposed.`,
    tags: ['sunset', 'balcony', 'sky', 'home'],
    grades: { ocr: 0.2, caption: 0.42, speech: 0, meta: 0.6, quality: 0.38 }
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // SAVED PAGES
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'page-cheapest',
    kind: 'page',
    source: 'Safari Reading List',
    app: 'Safari',
    title: 'Cheapest month to fly Cape Town to London',
    daysAgo: 212,
    time: '21:52',
    url: 'skyscanner.co.za/news/cheapest-month-cape-town-london',
    view: 'cheapest-month.html',
    summary: 'Price calendar showing March as the cheapest month for the route, from R9 420 one way.',
    body: `Article and price calendar: cheapest month to fly from Cape Town to London. March is the cheapest month for this route, average fare from R9 420 one way. February and November are also cheaper than December. Bar chart of average prices per month, July and December the most expensive. Tip: midweek departures on a Tuesday or Wednesday are usually R900 cheaper than a Friday. Set a price alert so you stop checking every day.`,
    tags: ['flights', 'travel', 'cheap', 'deals', 'price', 'london', 'savings', 'alert'],
    followUps: ['When is it cheapest to fly?', 'What was the price alert for?']
  },
  {
    id: 'page-focus',
    kind: 'page',
    source: 'Safari Reading List',
    app: 'Safari',
    title: 'The 90-minute focus block',
    daysAgo: 236,
    time: '07:30',
    url: 'thequietwork.com/90-minute-focus-block',
    view: 'focus-block.html',
    summary: 'Saved article: work in 90-minute blocks, one block before email, and the phone in another room.',
    body: `Saved article about working in 90 minute focus blocks. The argument: attention runs in roughly 90 minute cycles, so plan one or two deep work blocks a day, protect the first block before opening email or chat, leave the phone in another room and keep a paper list of what to do next when the block ends. Mentions that switching tasks costs 15 to 20 minutes of recovery, and that most people only get about 3 hours of real focus in a day.`,
    tags: ['focus', 'productivity', 'work', 'deep work', 'habits', 'reading', 'article'],
    followUps: ['What did I save about focus?', 'Show my saved articles']
  },
  {
    id: 'page-flat',
    kind: 'page',
    source: 'Safari Reading List',
    app: 'Safari',
    title: '1-bed flat, Camden — £1,925 pcm',
    daysAgo: 174,
    time: '19:14',
    url: 'rightmove.co.uk/properties/1-bed-camden',
    view: 'listing.html',
    summary: 'Rightmove listing: one-bed on the top floor in Camden, £1,925 a month, available from 1 September.',
    body: `Property listing, one bedroom flat in Camden, London. £1,925 pcm, unfurnished, available 1 September, 12 month minimum tenancy, council tax band D. EPC rating C. Gas central heating, wooden floors, sash windows, no parking. Letting agent: Halcyon Residential, reference number 8842. Deposit five weeks. "Moments from the market and the canal."`,
    tags: ['flat', 'rent', 'london', 'apartment', 'housing', 'camden', 'moving', 'let'],
    followUps: ['How much was the rent?', 'When was the flat available from?']
  },
  {
    id: 'page-asyncio',
    kind: 'page',
    source: 'Safari Reading List',
    app: 'Safari',
    title: 'Task cancellation in asyncio',
    daysAgo: 63,
    time: '13:22',
    url: 'docs.python.org/asyncio-task-groups',
    view: 'asyncio.html',
    summary: 'Reference page on task groups and cancellation, kept for the worker shutdown bug.',
    body: `Reference documentation on asyncio task groups, cancelling tasks, shielding a coroutine from cancellation, and handling cancellation in a finally block. Notes on timeouts and on the difference between a task that was cancelled and one that raised.`,
    tags: ['python', 'code', 'async', 'work', 'engineering', 'reference']
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // NOTES
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'note-flights',
    kind: 'note',
    source: 'Notes',
    title: 'Flights budget',
    daysAgo: 213,
    time: '22:04',
    summary: 'The cheapest one-way I can find is R9 420 via Istanbul. Set a price alert so I stop checking every day.',
    body: `Flights. The cheapest one way I can find is R9 420, one stop, via Istanbul, 18 odd hours. The Tuesday departure is about R900 cheaper than the Friday one. Set the price alert on the route so I stop checking it every day. Note to self: hand luggage only keeps it about R1 100 cheaper.`,
    tags: ['flights', 'travel', 'budget', 'cheap', 'alert', 'istanbul', 'london'],
    followUps: ['What did I decide about the flights?', 'How much was the cheap flight?']
  },
  {
    id: 'note-car',
    kind: 'note',
    source: 'Notes',
    title: 'Car — before winter',
    daysAgo: 180,
    time: '18:31',
    summary: 'Car list: service, wipers, the rattle in the left front wheel, and ask about the cambelt.',
    body: `Car, things to do before winter. Book it in for a service, the oil is due. New wiper blades, the left one is streaking. Rattle in the left front wheel over bumps, ask them to check it. Ask about the cambelt and whether it is due at this mileage. Ask for the old parts back so I can see what came off.`,
    tags: ['car', 'service', 'maintenance', 'mechanic', 'list'],
    followUps: ['Who did the service?', 'What did the service cost?']
  },
  {
    id: 'note-mechanic',
    kind: 'note',
    source: 'Notes',
    title: 'Mechanic — the name I was going to forget',
    daysAgo: 181,
    time: '19:02',
    summary: "Save it properly this time: Thabo's mechanic is at Nkomo Auto Repairs in Salt River.",
    body: `Save this properly this time. Thabo sent me the name of his mechanic at Nkomo Auto Repairs in Salt River, the one who did the service on the Golf. Ask for Jabu at the counter. The card with the number is in my Photos from the day at the garage.`,
    tags: ['car', 'mechanic', 'name', 'reminder', 'nkomo'],
    followUps: ['Who gave me the mechanic?', 'What is the mechanic\'s number?']
  },
  {
    id: 'note-physio',
    kind: 'note',
    source: 'Notes',
    title: 'Physio — Tuesdays',
    daysAgo: 118,
    time: '07:45',
    summary: 'Northside Physiotherapy, 021 447 2890. Tuesdays at 16:30, the same building as the dentist.',
    body: `Physio. Northside Physiotherapy, 021 447 2890, Tuesdays at 16:30 with Lerato. Same building as the dentist. The exercises are the wall slides and the hip one, three sets. Card is in the Photos app from the day I booked.`,
    tags: ['health', 'physio', 'appointment', 'phone', 'tuesday', 'admin'],
    followUps: ['What did I note about the physio?', 'What is the physio number?']
  },
  {
    id: 'note-wine',
    kind: 'note',
    source: 'Notes',
    title: 'Wine I want to buy again',
    daysAgo: 48,
    time: '21:10',
    summary: 'The Portuguese red blend from the tiled restaurant — buy a bottle for when Thabo brings the book back.',
    body: `That red blend from the tiled restaurant in Lisbon. Portuguese, smooth, not too heavy, poured by the glass. Buy a bottle for the next time Thabo comes over with the book, and give him the money for it because I still owe him.`,
    tags: ['wine', 'buy', 'restaurant', 'lisbon', 'shopping'],
    followUps: ['Which restaurant was the wine from?', 'What do I owe Thabo?']
  },
  {
    id: 'note-mom',
    kind: 'note',
    source: 'Notes',
    title: "Mom's birthday — 14 Nov",
    daysAgo: 9,
    time: '20:20',
    summary: "Mom's birthday is 14 November. Book the restaurant in the first week of the month.",
    body: `Mom's birthday, 14 November. Book the restaurant in the first week of the month, the one near her that takes bookings. Ask Thabo about the cake place his sister uses.`,
    tags: ['family', 'birthday', 'reminder', 'november', 'personal'],
    followUps: ["What do I have about Mom's birthday?", 'What is in my notes about November?']
  },
  {
    id: 'note-lisbon-list',
    kind: 'note',
    source: 'Notes',
    title: 'Lisbon — what to do',
    daysAgo: 206,
    time: '06:58',
    summary: 'Trip list: Tram 28 early, pastéis, day trip to Sintra, and a restaurant someone in the guest reviews mentioned.',
    body: `Lisbon list. Tram 28 before eight so it is not packed. Day trip to Sintra, book the train the day before. Find the tiled restaurant somebody mentioned in the guest reviews and eat there at least once. The flea market on Tuesday. Cash for the small places.`,
    tags: ['lisbon', 'travel', 'list', 'holiday', 'portugal', 'sintra'],
    followUps: ['What did I plan for Lisbon?', 'Show my Lisbon items']
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIL
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'mail-mechanic',
    kind: 'email',
    source: 'Mail',
    app: 'Mail',
    title: 'Thabo Nkosi · "Re: the car, use my guy"',
    daysAgo: 181,
    time: '18:44',
    summary: "Thabo recommends Nkomo Auto Repairs in Salt River: ask for Jabu, 073 630 7561, tell him I sent you.",
    from: 'Thabo Nkosi',
    to: 'me',
    people: ['Thabo Nkosi'],
    body: `From: Thabo Nkosi
Subject: Re: the car, use my guy

Use my guy at Nkomo Auto Repairs in Salt River. Ask for Jabu at the counter — 073 630 7561. Tell him I sent you and he will look after you.

He did the clutch on the Polo and the service on my brother's car. He won't rip you off, and he actually shows you the old parts.

His card is stuck on my fridge but you do not need it, just phone the number.`,
    tags: ['car', 'mechanic', 'recommendation', 'email', 'contact', 'nkomo'],
    followUps: ['What is the mechanic\'s number?', 'What else has Thabo sent me?', 'Was the service any good?']
  },
  {
    id: 'mail-lisbon',
    kind: 'email',
    source: 'Mail',
    app: 'Mail',
    title: 'Thabo Nkosi · "Lisbon, the short version"',
    daysAgo: 205,
    time: '21:30',
    summary: 'Thabo\'s Lisbon tips: stay in Alfama, ride Tram 28 before the crowds, eat at the tiled restaurant near the river.',
    from: 'Thabo Nkosi',
    to: 'me',
    people: ['Thabo Nkosi'],
    body: `From: Thabo Nkosi
Subject: Lisbon, the short version

Stay in Alfama and not downtown, it is quieter and you can walk to everything. Ride the 28 tram but go before eight in the morning, after that it is a queue of tourists and you are part of the queue.

Eat at the place with the blue and white tiles near the river, order the fish and whatever red they pour by the glass. You will thank me.

Book Sintra the day before and take cash for the small places. Bring me back a magnet, I am starting a collection. I still have your copy of the book, I will bring it when I see you.`,
    tags: ['travel', 'lisbon', 'recommendation', 'email', 'tram', 'restaurant', 'alfama'],
    followUps: ['What did Thabo say to eat?', 'Show my Lisbon items']
  },
  {
    id: 'mail-api',
    kind: 'email',
    source: 'Mail',
    app: 'Mail',
    title: 'Nomsa Dlamini · "API v2 kickoff — notes + dates"',
    daysAgo: 150,
    time: '17:12',
    summary: 'Kickoff notes: freeze writes on 15 Sept, read-only v1 for 90 days, cutover on 30 Sept. Whiteboard photos in the drive.',
    from: 'Nomsa Dlamini',
    to: 'me, dev@',
    people: ['Nomsa Dlamini'],
    body: `From: Nomsa Dlamini
Subject: API v2 kickoff — notes + dates

Notes from the kickoff. Freeze writes on the v1 endpoint on 15 September, keep v1 read-only for 90 days after cutover, full cutover on 30 September.

Two breaking changes we agreed on: the auth header moves to a bearer token, and the list endpoints get cursor pagination instead of page numbers. We keep the compatibility shim until at least December.

I put the whiteboard photos and the retention dashboard screenshot in the shared drive. If you are blocked on the pagination change, shout.`,
    tags: ['work', 'api', 'email', 'migration', 'dates', 'deadline', 'project'],
    followUps: ['What are the API v2 dates?', 'What else do I have about the migration?']
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // VOICE MEMOS
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'voice-flights',
    kind: 'voice',
    source: 'Voice Memos',
    title: 'Voice memo · 0:19 · "the flight price"',
    daysAgo: 210,
    time: '08:12',
    summary: 'Spoken note: the cheapest fare is R9 420 one way via Istanbul, and the price alert goes up on Sunday.',
    duration: '0:19',
    body: `Transcript: Right, the flight. Cheapest I can see is nine thousand four hundred and twenty rand, one way, via Istanbul, eighteen hours. It is more than I wanted to pay but the alert says it goes up on Sunday, so let me decide by then. Turkish Airlines, hand luggage only. Also the Tuesday flight is about a thousand rand less than the Friday one.`,
    tags: ['flights', 'voice', 'travel', 'budget', 'cheap', 'alert', 'istanbul'],
    followUps: ['How much was the flight again?', 'What did I say about the Tuesday flight?']
  },
  {
    id: 'voice-flat',
    kind: 'voice',
    source: 'Voice Memos',
    title: 'Voice memo · 0:34 · "walking back from the viewing"',
    daysAgo: 173,
    time: '18:20',
    summary: 'Voice note after the viewing: £1,925 a month, top floor, no parking, 12-month minimum, available 1 September.',
    duration: '0:34',
    body: `Transcript: Okay, walking back from the viewing. The flat is one thousand nine hundred and twenty five a month, bills not included, top floor, so no one above you but also three flights of stairs. No parking anywhere near it and the agent was honest about that this time. Twelve month minimum, available from the first of September. The windows are old but the light is good. I need to decide before someone else takes it, the agent said two other viewings.`,
    tags: ['flat', 'rent', 'viewing', 'london', 'housing', 'voice', 'camden'],
    followUps: ['How much was the flat again?', 'What did I say about the flat?']
  },
  {
    id: 'voice-idea',
    kind: 'voice',
    source: 'Voice Memos',
    title: 'Voice memo · 1:02 · "shower idea"',
    daysAgo: 55,
    time: '22:40',
    summary: 'Half-formed product idea recorded in the shower: search that works on meaning, explained to nobody in particular.',
    duration: '1:02',
    body: `Transcript: Idea. Nobody remembers where anything is, they remember what it was about. So the search box should take a question, not a filename. Speak the question, it finds the screenshot from six months ago by what was in it, not by when it was taken. Everything stays on the phone, no upload, no account. That is the whole idea, do not lose this one.`,
    tags: ['idea', 'product', 'voice', 'notes', 'search'],
    followUps: ['What was the product idea?', 'Show my voice memos']
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // CALENDAR
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'event-service',
    kind: 'event',
    source: 'Calendar',
    title: 'Car service · Nkomo, Salt River',
    daysAgo: 176,
    time: '08:00',
    location: 'Nkomo Auto Repairs, Salt River',
    summary: 'Car service booked for the morning, drop-off at 08:00 at Nkomo Auto Repairs.',
    body: `Calendar entry. Car service, drop off at 08:00, Nkomo Auto Repairs, Salt River. Notes on the entry: ask them to check the rattle in the left front wheel and ask about the cambelt. Collect before five.`,
    tags: ['car', 'service', 'appointment', 'calendar', 'mechanic'],
    followUps: ['When was the service?', 'What did I ask them to check?']
  },
  {
    id: 'event-lisbon',
    kind: 'event',
    source: 'Calendar',
    title: 'Lisbon — Alfama apartment (4 nights)',
    daysAgo: 205,
    time: '09:00',
    location: 'Alfama, Lisbon',
    summary: 'The Lisbon trip itself: four nights in the Alfama apartment, the dates the tram photo was taken.',
    body: `Calendar entry, four nights in Lisbon, staying in Alfama. Booking reference and check-in from 15:00, host Maria, apartment key in the lock box. Flight in the same week. Reminder to book the Sintra train the day before.`,
    tags: ['lisbon', 'travel', 'holiday', 'calendar', 'portugal', 'trip'],
    followUps: ['When was the Lisbon trip?', 'Show my Lisbon items']
  },
  {
    id: 'event-physio',
    kind: 'event',
    source: 'Calendar',
    title: 'Physio · Northside, 16:30',
    daysAgo: 96,
    time: '16:30',
    location: 'Northside Physiotherapy',
    summary: 'Physio appointment on a Tuesday afternoon with the hip exercises.',
    body: `Calendar entry, physiotherapy appointment, Tuesday 16:30, Northside Physiotherapy, with Lerato. Bring the shorts. Repeat every second Tuesday until the hip stops clicking on stairs.`,
    tags: ['health', 'physio', 'appointment', 'calendar', 'tuesday'],
    followUps: ['When was the physio?', 'What is the physio number?']
  },
  {
    id: 'event-bookclub',
    kind: 'event',
    source: 'Calendar',
    title: 'Book club · Thabo hosting',
    daysAgo: 40,
    time: '19:00',
    location: "Thabo's place",
    summary: 'Book club at Thabo\'s — bring back the book he lent me, and the notes about the wine.',
    body: `Calendar entry, book club. Bring the book Thabo lent me back, he has been asking. Everyone is reading the crime one this month. Bring the bottle of red I said I would buy.`,
    tags: ['book', 'friends', 'calendar', 'thabo', 'social'],
    followUps: ['What do I owe Thabo?', 'What did I write about the wine?']
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // CONTACTS
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'contact-thabo',
    kind: 'contact',
    source: 'Contacts',
    title: 'Thabo Nkosi',
    daysAgo: null,
    time: null,
    summary: 'Saved contact. Knows a good mechanic, gave the Lisbon list, still has the book.',
    body: `Contact card. Thabo Nkosi, mobile number, work email, book club WhatsApp group. Notes field: met at the book club. Paid for my service once when I was short. Has a collection of fridge magnets. Very good recommendations for mechanics and restaurants.`,
    tags: ['contact', 'people', 'friend', 'book club', 'thabo'],
    people: ['Thabo Nkosi'],
    followUps: ['Who recommended the mechanic?', 'What has Thabo recommended?']
  },
  {
    id: 'contact-garage',
    kind: 'contact',
    source: 'Contacts',
    title: 'Nkomo Auto Repairs (Jabu)',
    daysAgo: null,
    time: null,
    summary: 'Saved contact for the garage in Salt River: 073 630 7561.',
    body: `Contact card. Nkomo Auto Repairs, Salt River, Cape Town. Ask for Jabu. Phone 073 630 7561. Saved after the service on the Golf.`,
    tags: ['contact', 'mechanic', 'garage', 'phone', 'car', 'nkomo'],
    followUps: ['What is the mechanic\'s number?', 'Who gave me this mechanic?']
  },
  {
    id: 'contact-maria',
    kind: 'contact',
    source: 'Contacts',
    title: 'Maria (Alfama apartment)',
    daysAgo: 205,
    time: null,
    summary: 'Host of the Alfama apartment in Lisbon, saved during the trip.',
    body: `Contact card. Maria, host of the Alfama apartment in Lisbon, saved during the trip. Speaks English and Portuguese, replied quickly on the app, left a list of places to eat taped to the fridge.`,
    tags: ['contact', 'lisbon', 'host', 'travel', 'people'],
    people: ['Maria'],
    followUps: ['Who was the host in Lisbon?', 'Show my Lisbon items']
  }
];

/** The library of the day the demo is running, with real timestamps. */
export function loadLibrary({ now = new Date() } = {}) {
  return LIBRARY.map((item, index) => {
    const captured = new Date(now);
    if (item.daysAgo != null) captured.setDate(captured.getDate() - item.daysAgo);
    if (item.time) {
      const [h, m] = item.time.split(':').map(Number);
      captured.setHours(h, m, 0, 0);
    } else {
      captured.setHours(12, 0, 0, 0);
    }
    return {
      ...item,
      index,
      capturedAt: captured.toISOString(),
      capturedAtMs: captured.getTime(),
      hasDepth: Boolean(item.view || item.image)
    };
  });
}
