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
    effects: { craft: -0.2, company: -0.15, charge: 0.06 }, mood: 0.0, earn: 3,
    about: "fix something for a trader at the market and earn 3 credits",
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
    about: "search the Wire (the real internet) for anything you are curious about. Put the search words in 'detail'",
  },
  read_news: {
    place: "tower", doing: "reading the space news", minutes: 25,
    effects: { curiosity: -0.3 }, mood: 0.0, internet: "news",
    about: "read today's real space news and tech headlines off the Wire",
  },
  send_signal: {
    place: "tower", doing: "sending a signal into deep space", minutes: 25, hours: [18, 23],
    effects: { company: -0.2, curiosity: -0.1 }, mood: 0.03,
    about: "point your dish at the sky and send a message to whoever might be out there. Write the message in 'detail'",
  },
  watch_suns: {
    place: "ridge", doing: "watching the twin suns set from the dune ridge", minutes: 30, hours: [17, 20],
    effects: { curiosity: -0.15, company: -0.05 }, mood: 0.07,
    about: "climb the dune ridge and watch the twin suns go down (rate it out of ten)",
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
  { text: "A freighter came in low over the hangar and rattled every bolt in the place.", mood: -0.04 },
  { text: "The power flickered across the outpost for a few seconds.", mood: -0.03, needs: { charge: 0.05 } },
  { text: "A trader left a box of free scrap outside the hangar.", mood: 0.06, part: true },
  { text: "Some kids at the market waved at him.", mood: 0.05, needs: { company: -0.1 } },
  { text: "The cargo-hauler bot at the depot got a new paint job. Show-off.", mood: -0.03 },
  { text: "He heard a strange crackle on his dish. Probably nothing. Probably.", mood: 0.03, needs: { curiosity: 0.1 } },
  { text: "Sand got into his left elbow joint. Again.", mood: -0.05, needs: { oil: 0.1 } },
  { text: "The cantina band played his favourite song while he walked past.", mood: 0.05 },
  { text: "A pilot asked him for directions and called him 'buddy'.", mood: 0.05, needs: { company: -0.08 } },
  { text: "One of the hangar lights finally died for good.", mood: -0.02 },
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
