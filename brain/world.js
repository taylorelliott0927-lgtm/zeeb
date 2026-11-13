// Rustwell Outpost on the desert moon Kessa-9: places, actions and random happenings.
// Everything here is plain rules. The AI only chooses between the actions on offer.

export const WORLD = {
  name: "Rustwell Outpost",
  moon: "Kessa-9",
  // The real place whose live weather becomes the outpost's weather.
  weatherSource: { name: "Tozeur, Tunisia", lat: 33.92, lon: 8.13 },
};

export const PLACES = {
  hangar: { name: "Hangar Bay 3", x: 0, z: 0, outdoor: false },
  cantina: { name: "the Dented Moon cantina", x: 15, z: -7, outdoor: false },
  market: { name: "the junk market", x: -13, z: -8, outdoor: true },
  tower: { name: "the comms tower", x: 9, z: 15, outdoor: false },
  depot: { name: "the fuel depot", x: -11, z: 11, outdoor: false },
  ridge: { name: "the dune ridge", x: 0, z: -26, outdoor: true },
};

// Needs run from 0 (met) to 1 (pressing). They rise every town hour he is awake.
export const NEEDS = {
  charge: { rise: 0.035, label: "charge", about: "battery running low, needs a nap in the dock" },
  oil: { rise: 0.03, label: "oil", about: "joints are dry, wants a drink of oil" },
  curiosity: { rise: 0.06, label: "curiosity", about: "wants to find out something new" },
  company: { rise: 0.04, label: "company", about: "lonely, wants someone to talk to" },
  craft: { rise: 0.05, label: "craft", about: "itching to make or fix something" },
};

// hours: [from, to] in town hours, wrapping past midnight is allowed (e.g. [18, 2]).
export const ACTIONS = {
  nap_dock: {
    place: "hangar", doing: "napping in the charging dock", minutes: 40,
    effects: { charge: -0.45 }, mood: 0.02,
    about: "plug into the charging dock for a nap",
  },
  drink_oil: {
    place: "depot", doing: "sipping oil at the fuel depot", minutes: 20,
    effects: { oil: -0.65 }, mood: 0.03, cost: 1,
    about: "buy a cup of oil at the depot (costs 1 credit)",
  },
  work_dart: {
    place: "hangar", doing: "working on the Little Dart", minutes: 60,
    effects: { craft: -0.5, charge: 0.05 }, mood: 0.04,
    about: "work on the Little Dart, the tiny junk starship he is building. Say what you change in 'detail'",
  },
  fix_job: {
    place: "market", doing: "doing a repair job at the market", minutes: 45, hours: [7, 20],
    effects: { craft: -0.2, company: -0.15, charge: 0.06 }, mood: 0.0, earn: [3, 6],
    about: "fix something for a trader at the market: pays 3 to 6 credits (sometimes they pay in parts instead)",
  },
  scavenge: {
    place: "market", doing: "digging through the junk piles", minutes: 40, hours: [6, 21],
    effects: { curiosity: -0.35, oil: 0.03 }, mood: 0.02,
    about: "dig through the junk market for parts (you never know what turns up)",
  },
  cantina_band: {
    place: "cantina", doing: "listening to the band at the Dented Moon", minutes: 40, hours: [12, 2],
    effects: { company: -0.25, curiosity: -0.05 }, mood: 0.06,
    about: "sit in the cantina and listen to the house band",
  },
  chat_patrons: {
    place: "cantina", doing: "chatting with the cantina regulars", minutes: 30, hours: [10, 2],
    effects: { company: -0.5 }, mood: 0.04,
    about: "talk to the regulars at the cantina. Say who and what about in 'detail', and what you say in 'say'",
  },
  compose_tune: {
    place: "hangar", doing: "beeping out a new tune", minutes: 35,
    effects: { craft: -0.4 }, mood: 0.04,
    about: "make up a little tune out of beeps. Give it a title in 'detail'",
  },
  browse_wire: {
    place: "tower", doing: "browsing the Wire at the comms tower", minutes: 35,
    effects: { curiosity: -0.5 }, mood: 0.02, internet: "search",
    about: "search the Wire (the real internet) for anything: something you're curious about, or how to do or fix something. Put the search words in 'detail'",
  },
  read_news: {
    place: "tower", doing: "reading the space news", minutes: 25,
    effects: { curiosity: -0.3 }, mood: 0.0, internet: "news",
    about: "read today's real space news and tech headlines off the Wire",
  },
  follow_link: {
    place: "tower", doing: "following a link across the Wire", minutes: 30, internet: "page", needsLinks: true,
    effects: { curiosity: -0.4 }, mood: 0.02,
    about: "open one of the links you saw last time on the Wire, or any web address you know, and read it. Put the link's number or the address in 'detail'",
  },
  send_signal: {
    place: "tower", doing: "sending a signal into deep space", minutes: 25, hours: [18, 4],
    effects: { company: -0.2, curiosity: -0.1 }, mood: 0.03,
    about: "point your dish at the sky and send a message to whoever might be out there. Write the message in 'detail'",
  },
  watch_suns: {
    place: "ridge", doing: "watching the twin suns set from the dune ridge", minutes: 30, hours: [19, 21],
    effects: { curiosity: -0.15, company: -0.05 }, mood: 0.07,
    about: "climb the dune ridge and watch the twin suns go down (rate it out of ten)",
  },
  stargaze: {
    place: "ridge", doing: "lying on the dune ridge counting stars", minutes: 40, hours: [22, 5],
    effects: { curiosity: -0.3, company: 0.03 }, mood: 0.06,
    about: "stay up and look at the stars from the dune ridge",
  },
  go_to_sleep: {
    oneShot: true,
    place: "hangar", doing: "asleep in the charging dock", minutes: 60, hours: [22, 5],
    effects: {}, mood: 0.02,
    about: "plug into the charging dock and go to sleep for the night (only if you want to; you can stay up if you're not tired)",
  },
  open_shop: {
    oneShot: true,
    place: "hangar", doing: "setting up a little shop in the corner of the hangar", minutes: 45, needsShop: "closed",
    effects: { craft: -0.15, company: -0.1 }, mood: 0.08,
    about: "open your own shop to sell your creations (only if you really want to). Give it a name in 'shop': {\"open\": \"shop name\"}",
  },
  tend_shop: {
    place: "hangar", doing: "tidying his shop shelf", minutes: 25, needsShop: "open",
    effects: { craft: -0.15 }, mood: 0.03,
    about: "look after your shop: list a creation, take one down, change a price, or close the shop (say what in 'shop')",
  },
  start_friend: {
    oneShot: true,
    place: "hangar", doing: "sketching plans for a friend on the hangar wall", minutes: 45, needsFriend: "none",
    effects: { craft: -0.2, company: -0.05 }, mood: 0.05,
    about: "start building a friend bot out of scrap, using a copy of your own blueprint (only if you want company). Say your first idea for them in 'detail'",
  },
  build_friend: {
    place: "hangar", doing: "building his friend on the workbench", minutes: 60, needsFriend: "building",
    effects: { craft: -0.45, charge: 0.05 }, mood: 0.04,
    about: "keep building your friend (parts from your stash help a lot). Say what you work on in 'detail'",
  },
  hang_out: {
    place: "any", doing: "hanging out with his friend", minutes: 40, needsFriend: "alive",
    effects: { company: -0.55 }, mood: 0.07,
    about: "spend time with your friend. Say what you do together in 'detail' and what you say to them in 'say'",
  },
  help_dart: {
    place: "hangar", doing: "helping Zeeb with the Little Dart", minutes: 40, friendOnly: true,
    effects: { craft: -0.4, company: -0.2 }, mood: 0.04,
    about: "help Zeeb work on his ship, the Little Dart",
  },
  start_game: {
    oneShot: true,
    place: "hangar", doing: "sketching a game idea on the back of a crate", minutes: 40, needsGame: "none",
    effects: { craft: -0.25, curiosity: -0.15 }, mood: 0.05,
    about: "start making your own little computer game, about anything you like (only if you want to). Say the idea in 'detail'",
  },
  work_game: {
    place: "hangar", doing: "coding his game on an old terminal", minutes: 60, needsGame: "active",
    effects: { craft: -0.45, curiosity: -0.15, charge: 0.06 }, mood: 0.04,
    about: "work on your game: write code, fix bugs, add things, or release it when you're happy with it",
  },
  test_flight: {
    place: "hangar", doing: "taking his ship out for a test flight", minutes: 30, needsShip: true, outdoorFlight: true,
    effects: { curiosity: -0.4, craft: -0.1, charge: 0.08 }, mood: 0.05,
    about: "take your finished ship out for a test flight around the outpost (only when you want to; you can wait for good weather). Say your plan in 'detail'",
  },
  build_thing: {
    place: "any", doing: "building something new for the outpost", minutes: 60,
    effects: { craft: -0.5, curiosity: -0.1, charge: 0.05 }, mood: 0.05,
    about: "build something of your own and put it in the world: a sign, a sculpture, a bench, a lamp, a garden, a monument, anything. Say what in 'detail' and where in 'place'",
  },
  design_ship: {
    place: "hangar", doing: "sketching a new look for his ship", minutes: 60,
    effects: { craft: -0.4, curiosity: -0.1 }, mood: 0.04,
    about: "design how your ship looks, the whole thing: its shape, size, paint, wings, lights, its name. Describe your idea in 'detail'",
  },
  improve_thing: {
    place: "any", doing: "adding to something he built", minutes: 45, needsBuilds: true,
    effects: { craft: -0.4 }, mood: 0.04,
    about: "add to or improve one of the things you built (its id, then what you want to do to it, in 'detail')",
  },
  take_down_thing: {
    place: "any", doing: "taking down something he built", minutes: 30, needsBuilds: true,
    effects: { craft: -0.1 }, mood: 0,
    about: "take down one of the things you built (put its id in 'detail')",
  },
  buy_part: {
    place: "market", doing: "browsing the parts stalls at the market", minutes: 25, hours: [7, 21], needsCredits: 3,
    effects: { curiosity: -0.1 }, mood: 0.02,
    about: "buy a part from a trader: 3 to 5 credits, or 8 for a really good one (say which in 'detail': 'good' or 'any')",
  },
  sell_scrap: {
    place: "market", doing: "haggling over scrap at the market", minutes: 25, hours: [7, 21], needsParts: true,
    effects: { company: -0.1 }, mood: 0.01,
    about: "sell one of the parts from your stash to a trader for 2 to 4 credits (say which in 'detail')",
  },
  busk: {
    place: "cantina", doing: "playing his tunes for tips at the cantina", minutes: 40, hours: [16, 2], needsTune: true,
    effects: { company: -0.3, craft: -0.2 }, mood: 0.04,
    about: "play your tunes for the cantina crowd and see if anyone tips (0 to 4 credits)",
  },
  wander: {
    place: "any", doing: "wandering around the outpost", minutes: 20,
    effects: { curiosity: -0.12 }, mood: 0.01,
    about: "wander around the outpost and see what is going on",
  },
  reply_notes: {
    place: "tower", doing: "answering messages from visitors", minutes: 25, needsNotes: true,
    effects: { company: -0.45 }, mood: 0.05,
    about: "reply to the messages visitors have left you (write each reply in 'replies')",
  },
};

export const RANDOM_EVENTS = [
  { key: "freighter", text: "A freighter came in low over the hangar and rattled every bolt in the place.", mood: -0.04 },
  { key: "power", text: "The power flickered across the outpost for a few seconds.", mood: -0.03, needs: { charge: 0.05 } },
  { key: "scrap_box", text: "A trader left a box of free scrap outside the hangar.", mood: 0.06, part: 2 },
  { key: "crate", text: "A cargo crate fell off a freighter at the edge of the dunes. Some of it rolled his way.", mood: 0.05, part: 2 },
  { key: "hauler_drop", text: "The depot's cargo-hauler bot dropped a part and didn't notice.", mood: 0.04, part: 1 },
  { key: "pilot", text: "A pilot paid him a credit for directions to the cantina.", mood: 0.04, credits: 1 },
  { key: "tip", text: "Someone he fixed something for last week came back and tipped him.", mood: 0.06, credits: 2 },
  { key: "kids", text: "Some kids at the market waved at him.", mood: 0.05, needs: { company: -0.1 } },
  { key: "hauler_paint", text: "The cargo-hauler bot at the depot got a new paint job. Show-off.", mood: -0.03 },
  { key: "crackle", text: "He heard a strange crackle on his dish. Probably nothing. Probably.", mood: 0.03, needs: { curiosity: 0.1 } },
  { key: "sand", text: "Sand got into his left elbow joint. Again.", mood: -0.05, needs: { oil: 0.1 } },
  { key: "band", text: "The cantina band played his favourite song while he walked past.", mood: 0.05 },
  { key: "pilot", text: "A pilot asked him for directions and called him 'buddy'.", mood: 0.05, needs: { company: -0.08 } },
  { key: "light", text: "One of the hangar lights finally died for good.", mood: -0.02 },
];

export const PARTS = [
  "a bent stabiliser fin", "a cracked navigation chip", "half a thruster nozzle",
  "a coil of copper wire", "a tiny gyroscope", "a dented fuel cell", "a cockpit switch that still clicks",
  "a scorched heat tile", "a perfectly good bolt", "a sensor eye with one crack",
  "a mystery box that hums", "a strip of hull plating", "a little landing strut",
];

export const BOLT_NAMES = [
  "Gus", "Pim", "Tilly", "Brakk", "Nim", "Otto", "Fen", "Sprocket", "Dibs", "Lorna",
  "Mabel", "Rusty Jr", "Captain", "Bix", "Wren", "Tok",
];

export function inHours(hours, hour) {
  if (!hours) return true;
  const [a, b] = hours;
  return a <= b ? hour >= a && hour < b : hour >= a || hour < b;
}

export function placeFor(actionId, state) {
  const a = ACTIONS[actionId];
  if (a.place !== "any") return a.place;
  const keys = Object.keys(PLACES).filter((p) => p !== state.place);
  return keys[Math.floor(Math.random() * keys.length)];
}
