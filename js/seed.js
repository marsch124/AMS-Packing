// seed.js — Martin's real packing lists, encoded in the app data structure.
// Translated from Swedish; the original wording is kept in `sv` where it is personal
// or not a 1:1 translation. Everything here is editable in the app.
//
// Each item carries: category (what), container (where), phase (when), plus flags
// itemType ('item' | 'reminder'), charging (needs charge / a cable), shortList
// (part of the minimal "short home list"), optional seasons/contexts/transports, and sub-items.
import { newItem, newList, CONTAINER_ROLE, CONTAINER_LIST_NAME } from './model.js';

// Compact item builder. Short keys keep the data readable:
//   sv=Swedish original, cat=category, con=container, ph=phase, ctx=contexts,
//   seas=seasons, tr=transports, cater=catering, we=weather conditions,
//   charge, short, rem(inder), sub, note, qty, sec(tion id — per-template grouping)
function it(name, o = {}) {
  return newItem({
    name,
    swedish: o.sv || '',
    qty: o.qty || '',
    category: o.cat || 'Comfort & misc',
    container: o.con || 'Duffel bag',
    phase: o.ph || 'week',
    itemType: o.rem ? 'reminder' : 'item',
    charging: !!o.charge,
    chargeType: o.chargeType || '',
    shortList: !!o.short,
    seasons: o.seas || [],
    contexts: o.ctx || [],
    transports: o.tr || [],
    catering: o.cater || [],
    weather: o.we || [],
    sub: o.sub || [],
    note: o.note || '',
    liquid: !!o.liquid,
    restricted: !!o.restricted,
    section: o.sec || '',
  });
}
const CL = 'Clothing', ADV = 'Adventure clothing', FW = 'Footwear', SG = 'Sport gear',
  FD = 'Food & drink', TO = 'Toiletries', RX = 'Pharmacy / meds', EL = 'Electronics',
  DOC = 'Documents & money', CH = 'Charging', MI = 'Comfort & misc', REM = 'Reminders';

// ---------------------------------------------------------------- Run
const RUN = [
  it('Cap / beanie / headband', { sv: 'Keps/mössa / pannband', cat: CL, con: 'Duffel bag', short: true }),
  it('Running shorts', { sv: 'Run-byxor', cat: CL, note: '+ underwear if triathlon race' }),
  it('Running t-shirt', { sv: 'Run-t-shirt', cat: CL }),
  it('Running top', { sv: 'Run-tröja', cat: CL }),
  it('Sports bra', { sv: 'Sport-BH', cat: CL }),
  it('Running shoes', { sv: 'Run-skor', cat: FW, short: true }),
  it('Socks', { sv: 'Strumpor', cat: CL, short: true }),
  it('Handkerchief / tissue', { sv: 'Näsduk', cat: MI }),
  it('Anti-chafe balm', { sv: '"Vaselin" mot skav', cat: TO }),
  it('Anti-blister tape', { sv: 'Tejp mot skav', cat: RX }),
  it('Run food / nutrition', { sv: 'Run-mat', cat: FD }),
  it('Headphones (AirPods / Wing)', { sv: 'Hörlurar', cat: EL, charge: true, short: true }),
  it('Phone', { sv: 'Mobil', cat: EL, charge: true, short: true }),
  it('Apple Watch', { sv: 'Klocka Apple Watch', cat: EL, charge: true }),
  it('Garmin Epix Pro (incl. charger)', { sv: 'Garmin Epix Pro', cat: EL, charge: true, short: true }),
  it('Stryd pod + charger', { sv: 'Stryd samt laddare', cat: EL, charge: true }),
  // Outdoor extras (context Outdoor = the "All of the above" additions)
  it('Hydration system (vest / belt / handheld)', { sv: 'Vätskesystem (Väst / Bälte / I handen)', cat: SG, ctx: ['Outdoor'] }),
  it('Running belt', { sv: 'Löparbälte', cat: SG, ctx: ['Outdoor'] }),
  it('Headlamp', { sv: 'Pannlampa', cat: EL, charge: true, ctx: ['Outdoor'] }),
  it('Sunscreen', { sv: 'Solkräm', cat: TO, ctx: ['Outdoor'], seas: ['Summer'] }),
  it('Sunglasses', { sv: 'Solglasögon', cat: CL, ctx: ['Outdoor'], seas: ['Summer'] }),
  it('Beanie / cap', { sv: 'Mössa / Keps', cat: CL, ctx: ['Outdoor'] }),
  it('Gloves', { sv: 'Handskar', cat: CL, ctx: ['Outdoor'], seas: ['Winter'] }),
  it('Warm vest', { sv: 'Varm väst', cat: CL, ctx: ['Outdoor'], seas: ['Winter'] }),
  it('Windbreaker', { sv: 'Windbreaker', cat: CL, ctx: ['Outdoor'], we: ['wind', 'rain'] }),
  it('Reflectors', { sv: 'Reflex', cat: SG, ctx: ['Outdoor'], seas: ['Winter'] }),
  it('Plan route in Garmin', { sv: 'Planerad rutt i Garmin', cat: REM, rem: true, ctx: ['Outdoor'] }),
  it('Check grey boxes in kitchen — anything to bring?', { sv: 'Kolla gråa lådor i köket', cat: REM, rem: true, ctx: ['Outdoor'] }),
  it('Charge Garmin Epix & Apple Watch (+ cables?)', { sv: 'Laddad Garmin Epix och Apple Watch (Laddkablage?)', cat: CH, charge: true, rem: true }),
  // Efter / after-recovery
  it('Towel', { sv: 'Handduk', cat: TO, ph: 'after' }),
  it('Shower gel', { sv: 'Duschkräm', cat: TO, ph: 'after' }),
  it('Biotherm moisturiser', { sv: 'Biotherm', cat: TO, ph: 'after' }),
  it('Change of clothes', { sv: 'Ombyte', cat: CL, ph: 'after' }),
];

// ---------------------------------------------------------------- Swim
const SWIM = [
  it('Swim trunks / swimsuit', { sv: 'Badbyxor / Baddräkt', cat: CL, con: 'Swim bag' }),
  it('Swim cap', { sv: 'Badmössa', cat: SG, con: 'Swim bag' }),
  it('Goggles', { sv: 'Goggles', cat: SG, con: 'Swim bag' }),
  it('Form goggles (with charged Workout)', { sv: 'Form-goggles med laddad Workout', cat: SG, con: 'Swim bag', charge: true }),
  it('Pull buoy', { sv: 'Dolme', cat: SG, con: 'Swim bag' }),
  it('Paddles', { sv: 'Paddlar', cat: SG, con: 'Swim bag' }),
  it('Fins', { sv: 'Fenor', cat: SG, con: 'Swim bag' }),
  it('Water bottle', { sv: 'Vattenflaska', cat: FD, con: 'Swim bag' }),
  it('Ear drops (swim/dive)', { sv: 'Ortinova', cat: RX, con: 'Swim bag' }),
  it('Case for regular glasses', { sv: 'Glasögonfodral till vanliga glasögon', cat: MI, con: 'Swim bag' }),
  it('Apple Watch', { sv: 'Klocka Apple Watch', cat: EL, charge: true }),
  it('Garmin Epix Pro', { sv: 'Garmin Epix Pro', cat: EL, charge: true }),
  it('Padlock', { sv: 'Hänglås', cat: MI, con: 'Swim bag' }),
  it('Entry card', { sv: 'Inträdeskort', cat: DOC }),
  it('Earplugs', { sv: 'Öronproppar', cat: TO, con: 'Swim bag', note: 'optional' }),
  it('Nose clip', { sv: 'Näsklämma', cat: SG, con: 'Swim bag', note: 'optional' }),
  // Outdoor extras
  it('Sunscreen', { sv: 'Solkräm', cat: TO, ctx: ['Outdoor'], seas: ['Summer'] }),
  it('Anti-chafe cream', { sv: 'Skav-"kräm"', cat: TO, ctx: ['Outdoor'] }),
  it('Anti-blister tape (if long run right after)', { sv: 'Tejp mot skav om lång Run direkt efter', cat: RX, ctx: ['Outdoor'] }),
  it('Wetsuit', { sv: 'Våtdräkt', cat: SG, ctx: ['Outdoor'], sub: ['Calf pads (vad-kuddar)', 'Sleeves (ärmar)'] }),
  it('Tinted goggles', { sv: 'Tinted goggles?', cat: SG, ctx: ['Outdoor'] }),
  it('Hood + warm hood', { sv: 'Huva samt varm huva', cat: SG, ctx: ['Outdoor'] }),
  it('Tether cord', { sv: 'Håll-ihop-snöre', cat: SG, ctx: ['Outdoor'] }),
  it('Tow buoy', { sv: 'Boj', cat: SG, ctx: ['Outdoor'] }),
  it('Dry bag', { sv: 'Vattentät påse', cat: MI, ctx: ['Outdoor'] }),
  it('Towel / sarong / swim poncho', { sv: 'Handduk / Sarong / Badponcho', cat: TO, ctx: ['Outdoor'] }),
  it('Sliders / neoprene boots', { sv: 'Foppa-tofflor / Neoprene boots', cat: FW, ctx: ['Outdoor'] }),
  it('Warm change of clothes', { sv: 'Varmt ombyte', cat: CL, ctx: ['Outdoor'] }),
  it('Gel / nutrition', { sv: 'Gelé', cat: FD, ctx: ['Outdoor'] }),
  it('Plan route in Garmin', { sv: 'Planerad rutt i Garmin?', cat: REM, rem: true, ctx: ['Outdoor'] }),
  it('Check grey boxes in kitchen — anything to bring?', { sv: 'Kolla gråa lådor i köket', cat: REM, rem: true, ctx: ['Outdoor'] }),
  it('Charge Garmin Epix, Form-goggles & Apple Watch', { sv: 'Laddad Garmin Epix, Form-goggles och Apple Watch', cat: CH, charge: true, rem: true }),
  // Efter-grejor
  it('Towel', { sv: 'Handduk', cat: TO, ph: 'after' }),
  it('Shower gel', { sv: 'Duschkräm', cat: TO, ph: 'after' }),
  it('Biotherm moisturiser', { sv: 'Biotherm', cat: TO, ph: 'after' }),
  it('Change + a little extra warm clothing', { sv: 'Ombyte samt lite extra varma kläder', cat: CL, ph: 'after' }),
  it('Recovery food', { sv: 'Mat för återhämtning', cat: FD, ph: 'after' }),
];

// ---------------------------------------------------------------- Bike
const BIKE = [
  it('Cycling shorts / bibs', { sv: 'Cykelbyxor', cat: CL }),
  it('Cycling t-shirt', { sv: 'Cykel-t-shirt', cat: CL }),
  it('Sports bra', { sv: 'Sport-BH', cat: CL }),
  it('Cycling shoes', { sv: 'Cykel-skor', cat: FW, short: true }),
  it('Socks', { sv: 'Strumpor', cat: CL }),
  it('Headband', { sv: 'Pannband', cat: CL, short: true }),
  it('Fluid / drink', { sv: 'Vätska/dryck', cat: FD, short: true }),
  it('Boxers / underwear', { sv: 'Boxor', cat: CL, short: true }),
  it('Tissues / paper', { sv: 'Papper', cat: MI, short: true }),
  it('Phone', { sv: 'Mobiltelefon', cat: EL, charge: true, short: true }),
  it('Headphones (AirPods / Wing)', { sv: 'Hörlurar (AirPods/Wing)', cat: EL, charge: true, short: true }),
  it('Apple Watch', { sv: 'Klocka Apple Watch', cat: EL, charge: true }),
  it('Garmin Epix Pro', { sv: 'Garmin Epix Pro', cat: EL, charge: true, short: true }),
  // Outdoor extras
  it('Bike', { sv: 'Cykel', cat: SG, con: 'Other', ctx: ['Outdoor'], tr: ['Car', 'RV'] }),
  it('Charged Di2 / gears', { sv: 'Laddad växel', cat: SG, charge: true, ctx: ['Outdoor'] }),
  it('Cycling jersey', { sv: 'Cykel-tröja', cat: CL, ctx: ['Outdoor'] }),
  it('Cycling jacket', { sv: 'Cykel-jacka', cat: CL, ctx: ['Outdoor'] }),
  it('Cap / beanie', { sv: 'Keps/mössa', cat: CL, ctx: ['Outdoor'] }),
  it('Gloves', { sv: 'Handskar', cat: CL, ctx: ['Outdoor'] }),
  it('Tissue', { sv: 'Näsduk', cat: MI, ctx: ['Outdoor'] }),
  it('Body Glide (anti-chafe)', { sv: 'Body glide', cat: TO, ctx: ['Outdoor'] }),
  it('Sports drink', { sv: 'Sportdryck', cat: FD, ctx: ['Outdoor'] }),
  it('Bars / gels', { sv: 'Barer/gelé', cat: FD, ctx: ['Outdoor'] }),
  it('Hydration (bottles / vest / jersey pockets)', { sv: 'Vätskesystem (Cykelflaskor / Väst / Flaskor i ryggfickor)', cat: SG, ctx: ['Outdoor'] }),
  it('Bike computer (charged)', { sv: 'Cykeldator (laddad)', cat: EL, charge: true, ctx: ['Outdoor'] }),
  it('Plan route in Elemnt', { sv: 'Planerad rutt i Elemnts', cat: REM, rem: true, ctx: ['Outdoor'] }),
  it('Radar (charged)', { sv: 'Radar (laddad)', cat: EL, charge: true, ctx: ['Outdoor'] }),
  it('Light (charged)', { sv: 'Lampa (laddad)', cat: EL, charge: true, ctx: ['Outdoor'] }),
  it('Helmet', { sv: 'Hjälm', cat: SG, ctx: ['Outdoor'] }),
  it('Sunscreen', { sv: 'Solkräm', cat: TO, ctx: ['Outdoor'], seas: ['Summer'] }),
  it('Cycling glasses', { sv: 'Cykelglasögon', cat: SG, ctx: ['Outdoor'] }),
  it('Pump', { sv: 'Pump', cat: SG, ctx: ['Outdoor'] }),
  it('Bike stand', { sv: 'Bike stand', cat: SG, ctx: ['Outdoor'] }),
  it('Lock', { sv: 'Lås', cat: SG, ctx: ['Outdoor'] }),
  it('Repair kit', { sv: 'Lagningsgrejor', cat: SG, ctx: ['Outdoor'], sub: ['Tools (Verktyg)', 'Patch kit (Lagningssats)', 'Spare tube (Extra tub)', 'CO2 cartridge (Kolsyrepatron)'] }),
  it('Check grey boxes — anything to bring?', { sv: 'Kolla gråa lådor om något ska med', cat: REM, rem: true, ctx: ['Outdoor'] }),
  it('Charging cables: bike computer? gears? Garmin Epix? light? bike alarm?', { sv: 'Laddkablar: Cykeldator? Växel? Garmin Epix? Lampa? Cykellarm?', cat: CH, charge: true, rem: true }),
  // Efter / After — a recovery reminder checklist (Martin: these are reminders).
  it('Towel', { sv: 'Handduk', cat: TO, ph: 'after', rem: true }),
  it('Shower gel', { sv: 'Duschkräm', cat: TO, ph: 'after', rem: true }),
  it('Biotherm moisturiser', { sv: 'Biotherm', cat: TO, ph: 'after', rem: true }),
  it('Change of clothes', { sv: 'Ombyte', cat: CL, ph: 'after', rem: true }),
];

// ---------------------------------------------------------------- Golf
const GOLF = [
  // Komihåg-kläder (remember clothes)
  it('Merino wool layer 1', { sv: 'Merino Wool Lager 1', cat: CL }),
  it('WoolPower layer 2', { sv: 'WoolPower Lager 2', cat: CL }),
  it('Fleece top', { sv: 'Fleecetröja', cat: CL }),
  it('Fleece trousers ("Smurf")', { sv: 'Fleecebyxa (Smurf)', cat: CL }),
  it('Cap / sun hat', { sv: 'Keps/Solhatt', cat: CL }),
  it('Beanie and mittens', { sv: 'Mössa och vantar', cat: CL, seas: ['Winter'] }),
  it('Jacket', { sv: 'Jacka', cat: CL }),
  it('Rain suit', { sv: 'Regnställ', cat: CL, we: ['rain'] }),
  it('Extra socks', { sv: 'Extra strumpor', cat: CL }),
  // Komihåg-saker (remember things)
  it('Golf gear bag', { sv: 'Golf-grejor-väska', cat: SG, con: 'Golf bag' }),
  it('Tissues', { sv: 'Snorpapper', cat: MI }),
  it('Beach blanket', { sv: 'Beach-blanket', cat: MI }),
  it('Sunglasses', { sv: 'Solglasögon', cat: CL }),
  it('Glasses case', { sv: 'Glasögonfodral', cat: MI }),
  it('Charged and fixed', { sv: 'Laddat och lagat', cat: CH, rem: true, charge: true }),
  it('Drone', { sv: 'Drönare', cat: EL, charge: true }),
  // Mat Fika Dryck
  it('Nalgene bottle with water', { sv: 'Nalgene-flaska med vatten', cat: FD }),
  it('Trail mix', { sv: 'Studentenfutter', cat: FD }),
  it('Snacks ("Hobbit food")', { sv: 'Hobbitmat', cat: FD }),
  // Golfkläder
  it('Shirt', { sv: 'Skjorta', cat: CL }),
  it('Sweater', { sv: 'Tröja', cat: CL }),
  it('Golf trousers', { sv: 'Golfbyxor', cat: CL }),
  it('Shorts', { sv: 'Shorts', cat: CL, seas: ['Summer'] }),
  it('Belt', { sv: 'Skärp', cat: CL }),
  it('Golf / running socks', { sv: 'Golfstrumpor/Löparstrumpor', cat: CL }),
  it('Golf shoes', { sv: 'Golfskor', cat: FW }),
  it('Headache tablets', { sv: 'Huvudvärkstabletter', cat: RX }),
  it('Lip balm', { sv: 'Lipsyl', cat: TO }),
  it('Sun protection', { sv: 'Solskydd', cat: TO, seas: ['Summer'] }),
  it('Body lotion', { sv: 'Kroppslotion', cat: TO }),
  // Sällan-grejor (seldom things)
  it('Shoe polish', { sv: 'Skoputs', cat: MI }),
  it('Travel bag', { sv: 'Resebag', cat: MI, con: 'Duffel bag' }),
  it('Club protector for flights', { sv: 'Topp-boy', cat: SG, con: 'Golf bag', tr: ['Plane'] }),
  // I golfbagen (in the golf bag) — container Golf bag
  it('Golf cap', { sv: 'Golfkeps', cat: CL, con: 'Golf bag' }),
  it('Bag', { sv: 'Bag', cat: SG, con: 'Golf bag' }),
  it('Clubs', { sv: 'Klubbor', cat: SG, con: 'Golf bag' }),
  it('Balls', { sv: 'Bollar', cat: SG, con: 'Golf bag' }),
  it('Tees', { sv: 'Peggar', cat: SG, con: 'Golf bag' }),
  it('Divot tool', { sv: 'Greenlagare', cat: SG, con: 'Golf bag' }),
  it('Ball marker', { sv: 'Greenmarkör', cat: SG, con: 'Golf bag' }),
  it('Club towel', { sv: 'Klubbhandduk', cat: SG, con: 'Golf bag' }),
  it('Club cleaner', { sv: 'Klubbrengörare', cat: SG, con: 'Golf bag' }),
  it('Golf pen', { sv: 'Golfpenna', cat: SG, con: 'Golf bag' }),
  it('Umbrella holder', { sv: 'Paraplyhållare', cat: SG, con: 'Golf bag' }),
  it('Umbrella', { sv: 'Paraply', cat: SG, con: 'Golf bag' }),
  it('Sleeves', { sv: 'Sleeves / Ärmar', cat: CL, con: 'Golf bag' }),
  it('Golf beanie', { sv: 'Golfmössa', cat: CL, con: 'Golf bag' }),
  it('Glove', { sv: 'Handske', cat: SG, con: 'Golf bag' }),
  it('Golf gloves, 5-finger', { sv: 'Golfhandskar, 5-fingers', cat: SG, con: 'Golf bag' }),
  it('Golf mittens', { sv: 'Golfvantar, tum', cat: SG, con: 'Golf bag', seas: ['Winter'] }),
  it('Powerbank', { sv: 'Powerbank', cat: EL, con: 'Golf bag', charge: true }),
  // Morgonlistan (morning list)
  it('iPhone Power Pack', { sv: 'iPhone Power Pack', cat: EL, ph: 'morning', charge: true }),
  it('Sunglasses', { sv: 'Shades', cat: CL, ph: 'morning' }),
  it('Golf shoes', { sv: 'Golfskor', ph: 'morning', cat: FW }),
  it('Water', { sv: 'Vatten', cat: FD, ph: 'morning' }),
  it('Snack (fika)', { sv: 'Fika', cat: FD, ph: 'morning' }),
  it('Possible rain gear', { sv: 'Eventuella regnkläder', cat: CL, ph: 'morning', we: ['rain'] }),
  it('Possible clothes, beanie, gloves, umbrella', { sv: 'Eventuella kläder, mössa, handskar, paraply', cat: CL, ph: 'morning', we: ['rain', 'cold'] }),
  it('Sun hats', { sv: 'Solhattar', cat: CL, ph: 'morning', seas: ['Summer'] }),
  it('Tissues', { sv: 'Näsdukar', cat: MI, ph: 'morning' }),
  it('Wallet', { sv: 'Plånbok', cat: DOC, ph: 'morning' }),
  it('Marker pen', { sv: 'Märkpenna', cat: MI, ph: 'morning' }),
  it('Phone', { sv: 'Mobil', cat: EL, ph: 'morning', charge: true }),
  it('Laser rangefinder', { sv: 'Laserpekare', cat: EL, ph: 'morning' }),
  // Vid ytterdörren (at the front door)
  it('Sunscreen — face', { sv: 'Solskydda ansikte', cat: TO, ph: 'door', seas: ['Summer'] }),
  it('Drink water', { sv: 'Drick vatten', cat: REM, rem: true, ph: 'door' }),
  it('Use the toilet', { sv: 'Gå på toaletten', cat: REM, rem: true, ph: 'door' }),
  it('Jacket, beanie and mittens?', { sv: 'Jacka, mössa och vantar?', cat: CL, ph: 'door' }),
  it('Sun hat (MS)', { sv: 'Solhatt (MS)', cat: CL, ph: 'door', seas: ['Summer'] }),
  it('Sweater', { sv: 'Tröja', cat: CL, ph: 'door' }),
  it('Compression socks', { sv: 'Stödstrumpor', cat: CL, ph: 'door' }),
  it('Keys, phone, wallet', { sv: 'Nycklar, mobbe, plånbok', cat: DOC, ph: 'door' }),
];

// ---------------------------------------------------------------- Hiking
const HIKE = [
  // Kläder
  it('Merino wool layer 1', { sv: 'Merino Wool Lager 1', cat: CL, con: 'Hiking backpack' }),
  it('WoolPower layer 2', { sv: 'WoolPower Lager 2', cat: CL, con: 'Hiking backpack' }),
  it('Fleece top', { sv: 'Fleecetröja', cat: CL, con: 'Hiking backpack' }),
  it('Fleece trousers ("Smurf")', { sv: 'Fleecebyxa (Smurf)', cat: CL, con: 'Hiking backpack' }),
  it('Cap / sun hat', { sv: 'Keps/Solhatt', cat: CL, con: 'Hiking backpack' }),
  it('Beanie and mittens', { sv: 'Mössa och vantar', cat: CL, con: 'Hiking backpack', seas: ['Winter'] }),
  it('Rain suit', { sv: 'Regnställ', cat: ADV, con: 'Hiking backpack', we: ['rain'] }),
  it('Extra socks', { sv: 'Extra strumpor', cat: CL, con: 'Hiking backpack' }),
  it('Adventure trousers', { sv: 'Äventyrsbyxor', cat: ADV, con: 'Hiking backpack' }),
  it('Adventure belt', { sv: 'Äventyrsbälte', cat: ADV, con: 'Hiking backpack' }),
  it('Hiking socks', { sv: 'Vandringsstrumpor', cat: CL, con: 'Hiking backpack' }),
  it('Shell garment', { sv: 'Skalplagg', cat: ADV, con: 'Hiking backpack' }),
  it('Poncho', { sv: 'Poncho', cat: ADV, con: 'Hiking backpack' }),
  it('Neck gaiter', { sv: 'Neck gaiter', cat: CL, con: 'Hiking backpack' }),
  it('Extra change of clothes', { sv: 'Extra klädombyte', cat: CL, con: 'Hiking backpack' }),
  // Prylar Övrigt (gadgets / other)
  it('Hiking map', { sv: 'Vandringskarta', cat: SG, con: 'Hiking backpack' }),
  it('Guidebook (climbing / hiking)', { sv: 'Förare', cat: SG, con: 'Hiking backpack' }),
  it('First-aid kit', { sv: '1:a hjälpen kit', cat: RX, con: 'Hiking backpack' }),
  it('Tissues', { sv: 'Snorpapper', cat: MI, con: 'Hiking backpack' }),
  it('Beach blanket', { sv: 'Beach-blanket', cat: MI, con: 'Hiking backpack' }),
  it('Sunglasses', { sv: 'Solglasögon', cat: CL, con: 'Hiking backpack' }),
  it('Glasses case', { sv: 'Glasögonfodral', cat: MI, con: 'Hiking backpack' }),
  it('Charged and fixed', { sv: 'Laddat och lagat', cat: CH, rem: true, charge: true }),
  it('Rain/sweat cover for phone', { sv: 'Regn/svett-skydd till mobilen', cat: SG, con: 'Hiking backpack', we: ['rain'] }),
  it('Drone', { sv: 'Drönare', cat: EL, charge: true }),
  it('Camera', { sv: 'Kamera', cat: EL, charge: true }),
  it('Approach shoes / boots', { sv: 'Approach-skor/Kängor', cat: FW }),
  it('Knee bandage', { sv: 'Kniebandage', cat: RX, con: 'Hiking backpack' }),
  it('Sit pad', { sv: 'Sittunderlag', cat: SG, con: 'Hiking backpack' }),
  it('Trekking poles', { sv: 'Sticks', cat: SG, con: 'Hiking backpack' }),
  // Mat Fika Dryck
  it('Nalgene bottle with water', { sv: 'Nalgene-flaska med vatten', cat: FD }),
  it('Trail mix', { sv: 'Studentenfutter', cat: FD }),
  it('Snacks ("Hobbit food")', { sv: 'Hobbitmat', cat: FD }),
  it('Snack fruit', { sv: 'Fika Frukt', cat: FD }),
  it('Bar', { sv: 'Bar', cat: FD }),
  it('Extra water for the trip home', { sv: 'Extra vatten till hemfärden', cat: FD, ph: 'after' }),
  it('Thermos with hot drink', { sv: 'Termos med varm dryck', cat: FD, seas: ['Winter'] }),
  // Diverse
  it('Climbing spikes / crampons', { sv: 'Vandersteghjärn', cat: SG, seas: ['Winter'] }),
  it('Avalanche gear', { sv: 'Lavinutrustning', cat: SG, seas: ['Winter'] }),
  it('Heat pads', { sv: 'Värmedpads', cat: MI, seas: ['Winter'] }),
  // Aid (climbing protection) — context Outdoor
  it('Rope ladders / etriers', { sv: 'Repstegar', cat: SG, ctx: ['Outdoor'] }),
  it('Pitons and hammer', { sv: 'Pitonger och hammare', cat: SG, ctx: ['Outdoor'] }),
  it('Sky-hooks', { sv: 'Sky-hooks', cat: SG, ctx: ['Outdoor'] }),
  it('Boots', { sv: 'Kängor', cat: FW, ctx: ['Outdoor'] }),
  // Rygga (in the backpack)
  it('Mountain pen', { sv: 'Bergsports-penna', cat: MI, con: 'Hiking backpack' }),
  it('Nalgene bottle (large)', { sv: 'Nalgene-flaska (stor)', cat: FD, con: 'Hiking backpack' }),
  it('Platypus (hydration)', { sv: 'Pladipus', cat: SG, con: 'Hiking backpack' }),
  it('Extra outer layer', { sv: 'Extra ytterlager', cat: ADV, con: 'Hiking backpack' }),
  it('Down jacket', { sv: 'Dunjacka', cat: ADV, con: 'Hiking backpack', seas: ['Winter'] }),
  it('Alpine mittens', { sv: 'Handskar tum - alpint', cat: CL, con: 'Hiking backpack', seas: ['Winter'] }),
  it('Spare change of clothes', { sv: 'Reservombyte', cat: CL, con: 'Hiking backpack' }),
  it('Headlamp', { sv: 'Pannlampa', cat: EL, con: 'Hiking backpack', charge: true }),
  it('Blister tape', { sv: 'Tejp m. skavsår', cat: RX, con: 'Hiking backpack' }),
  it('Emergency blanket', { sv: 'Rescue-folie', cat: SG, con: 'Hiking backpack' }),
  it('Rain cover (for backpack)', { sv: 'Raincover (t ryggsäck)', cat: SG, con: 'Hiking backpack', we: ['rain'] }),
  it('Ski goggles', { sv: 'Skidglasögon', cat: SG, con: 'Hiking backpack', seas: ['Winter'] }),
  it('Rope, 20 m – 9 mm', { sv: 'Rep, 20m - 9 mm', cat: SG, con: 'Hiking backpack', ctx: ['Outdoor'] }),
  it('Bars', { sv: 'Barer', cat: FD, con: 'Hiking backpack' }),
  it('First-aid kit', { sv: '1:a hjälpen-kit', cat: RX, con: 'Hiking backpack' }),
  it('Sun protection', { sv: 'Solskydd', cat: TO, con: 'Hiking backpack', seas: ['Summer'] }),
  it('Lip balm', { sv: 'Lipsyl', cat: TO, con: 'Hiking backpack' }),
  it('Headache tablets', { sv: 'Huvudvärkstabletter', cat: RX, con: 'Hiking backpack' }),
  it('Blister tape', { sv: 'Tejp mot skavsår', cat: RX, con: 'Hiking backpack' }),
  it('Toilet paper', { sv: 'Toapapper', cat: TO, con: 'Hiking backpack' }),
  // Hütte (at the hut)
  it('Download a film', { sv: 'Ladda ner någon film', cat: REM, rem: true, note: 'at the hut' }),
  it('DAV card', { sv: 'DAV-kort', cat: DOC, note: 'at the hut' }),
  it('Reading', { sv: 'Läsning', cat: MI, note: 'at the hut' }),
  it('Lounge pants', { sv: 'Schlabberhosen', cat: CL, note: 'at the hut' }),
  it('Indoor slippers', { sv: 'Innetofflor', cat: FW, note: 'at the hut' }),
  it('Silk sleeping-bag liner', { sv: '"Sidensovsäck"', cat: MI, note: 'at the hut' }),
  it('Silk sheet', { sv: '"Sidenlakan"', cat: MI, note: 'at the hut' }),
  it('Wash bag', { sv: 'Nescessär', cat: TO, con: 'Toiletry bag', note: 'at the hut' }),
  it('Towels, shower', { sv: 'Handdukar, dusch', cat: TO, note: 'at the hut' }),
  it('iPad', { sv: 'iPad', cat: EL, charge: true, note: 'at the hut' }),
  // I handen (in hand)
  it('Gaiters (simple)', { sv: 'Gaiters (simple)', cat: SG, ph: 'door' }),
  it('SKF membership card', { sv: 'Medlemskort SKF', cat: DOC, ph: 'door' }),
  it('Hand-sanitizer wipes', { sv: 'Handsprit-servetter', cat: TO, ph: 'door' }),
  // Morgonlistan
  it('Extra socks', { sv: 'Extra strumpor', cat: CL, ph: 'morning' }),
  it('Change shirt / t-shirt', { sv: 'Skjorta/t-shirt i ombyte', cat: CL, ph: 'morning' }),
  it('Umbrella (sun and rain)', { sv: 'Paraply (mot sol och regn)', cat: SG, ph: 'morning', we: ['rain', 'hot'] }),
];

// ---------------------------------------------------------------- Travel (Travel-Main base)
const CO = 'Carry-on / hand luggage', CK = 'Checked luggage', TOI = 'Toiletry bag', EB = 'Electronics bag';
const TRAVEL = [
  // Stadskläder (city clothes)
  it('Underwear', { sv: 'Kalsonger / Trosor', cat: CL, con: CK }),
  it('Socks', { sv: 'Strumpor', cat: CL, con: CK }),
  it('Bra', { sv: 'BH', cat: CL, con: CK }),
  it('Sports bra', { sv: 'Sport-BH', cat: CL, con: CK }),
  it('Vests & t-shirts', { sv: 'Linnen och t-shirtar', cat: CL, con: CK }),
  it('Shirts', { sv: 'Skjortor', cat: CL, con: CK }),
  it('Polo shirts', { sv: 'Pikét-skjortor', cat: CL, con: CK }),
  it('Sweaters', { sv: 'Tröjor', cat: CL, con: CK }),
  it('Long trousers', { sv: 'Långbyxor', cat: CL, con: CK }),
  it('Belt', { sv: 'Bälte', cat: CL, con: CK }),
  it('Three-quarter trousers', { sv: 'Trekvartsbyxor', cat: CL, con: CK }),
  it('Shorts', { sv: 'Shorts', cat: CL, con: CK, seas: ['Summer'] }),
  it('Skirt', { sv: 'Kjol', cat: CL, con: CK }),
  it('Dress', { sv: 'Klänning', cat: CL, con: CK }),
  it('Shoes', { sv: 'Skor', cat: FW, con: CK }),
  it('Sneakers', { sv: 'Gympadojor', cat: FW, con: CK }),
  it('Sandals', { sv: 'Sandaler', cat: FW, con: CK, seas: ['Summer'] }),
  it('Cap', { sv: 'Keps', cat: CL, con: CK }),
  it('Sun hat', { sv: 'Solhatt', cat: CL, con: CK, seas: ['Summer'] }),
  it('Beanie', { sv: 'Mössa', cat: CL, con: CK, seas: ['Winter'] }),
  it('Gloves (finger)', { sv: 'Handskar, finger', cat: CL, con: CK, seas: ['Winter'] }),
  it('Gloves (mitten)', { sv: 'Handskar, tum', cat: CL, con: CK, seas: ['Winter'] }),
  it('Jacket', { sv: 'Jacka', cat: CL, con: CK }),
  it('Windbreaker jacket', { sv: 'Windbreaker-jacka', cat: CL, con: CK }),
  // Äventyrskläd (adventure clothing)
  it('Adventure shirts', { sv: 'Äventyrsskjortor', cat: ADV, con: CK }),
  it('Merino wool layer 1', { sv: 'Merino Wool Lager 1', cat: ADV, con: CK }),
  it('WoolPower layer 2', { sv: 'WoolPower Lager 2', cat: ADV, con: CK }),
  it('Fleece top', { sv: 'Fleece-tröja', cat: ADV, con: CK }),
  it('Adventure trousers', { sv: 'Äventyrsbyxor', cat: ADV, con: CK }),
  it('Adventure belt', { sv: 'Äventyrsbälte', cat: ADV, con: CK }),
  it('Down jacket', { sv: 'Dunjacka', cat: ADV, con: CK, seas: ['Winter'] }),
  it('Shell garment', { sv: 'Skalplagg', cat: ADV, con: CK }),
  it('Rain suit', { sv: 'Regnställ', cat: ADV, con: CK }),
  it('Poncho', { sv: 'Poncho', cat: ADV, con: CK }),
  it('Approach shoes', { sv: 'Approach-skor', cat: FW, con: CK }),
  it('Shoehorn', { sv: 'Schuhlöffel', cat: MI, con: CK }),
  it('Sleeves', { sv: 'Sleeves / Ärmar', cat: ADV, con: CK }),
  it('Flop mittens', { sv: 'Floppvantar', cat: CL, con: CK }),
  it('Neck gaiter', { sv: 'Neck gaiter', cat: CL, con: CK }),
  it('Knee bandage', { sv: 'Kniebandage', cat: RX, con: CK }),
  // Annat (other)
  it('Insurance card', { sv: 'Försäkringskort', cat: DOC, con: CO }),
  it('Marker pen (white + black)', { sv: 'Märkpenna (vit + svart)', cat: MI, con: CK }),
  it('Snack bag', { sv: 'Jause-säck', cat: FD, con: CK }),
  it('Towel(s)', { sv: 'Handduk(ar)', cat: TO, con: CK }),
  it('Leatherman', { sv: 'Leathermannen', cat: MI, con: CK }),
  it('Ace Pro camera', { sv: 'Ace Pro-kamera', cat: EL, con: CK, charge: true }),
  it('Insta360 X4', { sv: 'Insta360 X4', cat: EL, con: CK, charge: true }),
  it('DJI Action Pocket', { sv: 'DJI Action Pocket', cat: EL, con: CK, charge: true }),
  it('DJI OSMO Pocket', { sv: 'DJI OSMO Pocket', cat: EL, con: CK, charge: true }),
  it('Drone DJI Pro Mini 4', { sv: 'Drönare DJI Pro Mini 4', cat: EL, con: CK, charge: true }),
  it('DJI Neo drone', { sv: 'DJI Neo drönare', cat: EL, con: CK, charge: true }),
  it('Massage gun', { sv: 'Massagepistol', cat: EL, con: CK, charge: true }),
  it('eReader', { sv: 'eReader', cat: EL, con: CO, charge: true }),
  it('Whoop charger', { sv: 'Whoop-laddare', cat: CH, con: CK, charge: true }),
  it('Garmin + charger', { sv: 'Garmin + ladd', cat: EL, con: CK, charge: true }),
  it('Active earplugs', { sv: 'Aktiva öronproppar', cat: EL, con: CO, charge: true }),
  it('Contacts + reading glasses', { sv: 'MS Linser + lins-läsglasögon', cat: TO, con: CO }),
  it('Sit pad', { sv: 'Sittunderlag', cat: SG, con: CK }),
  it('First-aid kit', { sv: '1:a hjälpen-kit', cat: RX, con: CK }),
  it('Neti pot incl. salt', { sv: 'Netipot inkl Salt', cat: TO, con: TOI }),
  it('Umbrella', { sv: 'Paraply', cat: MI, con: CK }),
  it('Beanie / Cioccolina', { sv: 'Beanie / Cioccolina', cat: CL, con: CK }),
  it('Beach blanket', { sv: 'Beach-blanket', cat: MI, con: CK }),
  it('Laundry bag + bra bag', { sv: 'Smutsklädpåse + BH-påse', cat: MI, con: CK }),
  it('Magic pearls', { sv: 'Magic perls', cat: TO, con: CK }),
  it('Swimwear', { sv: 'Badkläder', cat: CL, con: CK }),
  it('Sarongs', { sv: 'Saronger', cat: CL, con: CK, seas: ['Summer'] }),
  it('Loungewear', { sv: 'Mysbyxor', cat: CL, con: CK }),
  it('Bathrobe / watery poncho', { sv: 'Morgonrock / Watery-poncho', cat: CL, con: CK }),
  it('Hair dryer', { sv: 'Hårtork', cat: EL, con: CK }),
  it('Hair straightener', { sv: 'Plattång', cat: EL, con: CK }),
  it('Day pack', { sv: 'Dag-ryggsäck', cat: SG, con: 'Day pack' }),
  it('Shopping bags', { sv: 'Inköpskassar', cat: MI, con: CK }),
  it('Tech pouch', { sv: 'Tech-pouch', cat: EL, con: 'Tech pouch' }),
  // Elnik (electronics)
  it('220V adapters', { sv: '220v-adaptrar', cat: EL, con: EB }),
  it('Power strip', { sv: 'Fördelardosa', cat: EL, con: EB }),
  it('The 6-way (multi-plug)', { sv: '6:an', cat: EL, con: EB }),
  it('UltraHuman charger', { sv: 'Laddare UltraHuman', cat: CH, con: EB, charge: true }),
  it('Camera accessories', { sv: 'Kameratillbehör', cat: EL, con: EB }),
  it('Headlamp', { sv: 'Pannlampa', cat: EL, con: EB, charge: true }),
  // Träning (allm) — general training base (overlaps Run; dedup handles it)
  it('Running shoes', { sv: 'Löparskor', cat: FW, con: CK }),
  it('Running socks', { sv: 'Löparstrumpor', cat: CL, con: CK }),
  it('Running shorts', { sv: 'Löparbyxor', cat: CL, con: CK }),
  it('Running t-shirt', { sv: 'Löpar-t-shirt', cat: CL, con: CK }),
  it('Running cap', { sv: 'Löparkeps', cat: CL, con: CK, seas: ['Summer'] }),
  it('Running beanie & gloves', { sv: 'Löpmössa och löphandskar', cat: CL, con: CK, seas: ['Winter'] }),
  it('Windbreaker', { sv: 'Windbreaker', cat: CL, con: CK }),
  it('Running vest', { sv: 'Löparväst', cat: SG, con: CK }),
  it('Reflectors', { sv: 'Reflex', cat: SG, con: CK, seas: ['Winter'] }),
  it('Garmin Epix (charged)', { sv: 'Garmin-Epix (laddad)', cat: EL, con: CO, charge: true }),
  it('Stryd pod (charged)', { sv: 'Stryd-pod (laddad)', cat: EL, con: CO, charge: true }),
  it('Hair tie / headband', { sv: 'Hårsnodd / pannband', cat: CL, con: CK }),
  it('Training bottle', { sv: 'Träningsflaska', cat: FD, con: CK }),
  it('Training cord', { sv: 'Träningssnöre', cat: SG, con: CK }),
  // Necessär (toiletry bag)
  it('Body lotion', { sv: 'Kroppslotion', cat: TO, con: TOI }),
  it('Deodorant', { sv: 'Deo', cat: TO, con: TOI }),
  it('Headache tablets', { sv: 'Huvudvärkstabletter', cat: RX, con: TOI }),
  it('Face products', { sv: 'Ansiktsprodukter', cat: TO, con: TOI }),
  it('Tooth pickers', { sv: 'Tooth pickers', cat: TO, con: TOI }),
  it('Toothbrush', { sv: 'Tandborste', cat: TO, con: TOI }),
  it('Toothpaste', { sv: 'Tandkräm', cat: TO, con: TOI }),
  it('Dental floss', { sv: 'Flour', cat: TO, con: TOI }),
  it('Razor + foam', { sv: 'Rakhyvel + lödder', cat: TO, con: TOI }),
  it('Extra contacts + solution', { sv: 'AS extra linser + linsvätska', cat: TO, con: TOI }),
  it('Contraceptive pill', { sv: 'P-piller', cat: RX, con: TOI }),
  it('Panty liners', { sv: 'Trosskydd', cat: TO, con: TOI }),
  it('Hairbrush', { sv: 'Hårborste', cat: TO, con: TOI }),
  it('Hair ties', { sv: 'Hårsnoddar', cat: TO, con: TOI }),
  it('Cold-sore cream', { sv: 'Munsårskräm', cat: RX, con: TOI }),
  it('Nail clipper', { sv: 'Nageltång', cat: TO, con: TOI }),
  it('Small scissors', { sv: 'Liten sax', cat: TO, con: TOI }),
  it('Tweezers', { sv: 'Pincett', cat: TO, con: TOI }),
  it('Earplugs', { sv: 'Öronproppar', cat: TO, con: TOI }),
  it('Glasses cleaner', { sv: 'Brillenputz', cat: TO, con: TOI }),
  // Apotek (pharmacy)
  it('Allergy medicine', { sv: 'Allergimedicin', cat: RX, con: TOI }),
  it('Plasters', { sv: 'Plåster', cat: RX, con: TOI }),
  it('Sun protection', { sv: 'Solskydd', cat: TO, con: TOI, seas: ['Summer'] }),
  it('Aftersun', { sv: 'Aftersun', cat: TO, con: TOI, seas: ['Summer'] }),
  it('Hand sanitizer', { sv: 'Handsprit', cat: TO, con: TOI }),
  it('Shower gel', { sv: 'Duschkräm', cat: TO, con: TOI }),
  it('Shampoo', { sv: 'Schampo', cat: TO, con: TOI }),
  it('Conditioner', { sv: 'Balsam', cat: TO, con: TOI }),
  it('Vitamins etc.', { sv: 'Vitaminer m.m.', cat: RX, con: TOI }),
  it('Iron tablets', { sv: 'Järntabletter', cat: RX, con: TOI }),
  it('Resorb (rehydration)', { sv: 'Resorb', cat: RX, con: TOI }),
  it('Bars', { sv: 'Barer', cat: FD, con: CK }),
  it('Body massage oil', { sv: 'Kolja', cat: RX, con: TOI }),
  it('Mosquito spray', { sv: 'Myggspray', cat: TO, con: TOI, seas: ['Summer'] }),
  it('Cortisone cream', { sv: 'Kortisonsalva', cat: RX, con: TOI }),
  it('Foot file', { sv: 'Fotfil', cat: TO, con: TOI }),
  it('Blister plasters', { sv: 'Skavsårsplåster', cat: RX, con: TOI }),
  it('Finger tape', { sv: 'Fingertejp', cat: RX, con: TOI }),
  it('WaxOff (ear wax)', { sv: 'WaxOff', cat: RX, con: TOI }),
  it('Stomach medicine', { sv: 'Magmedicin', cat: RX, con: TOI }),
  it('Seasickness pills', { sv: 'Sjösjukepiller', cat: RX, con: TOI }),
  it('Sleeping pills', { sv: 'Sömnpiller', cat: RX, con: TOI }),
  it('Other medicines', { sv: 'Andra mediciner', cat: RX, con: TOI }),
  it('Toilet paper', { sv: 'Toapapper', cat: TO, con: CK }),
  it('Kitchen towel', { sv: 'Hushållspapper', cat: MI, con: CK }),
  it('Blood-pressure monitor', { sv: 'Blodtrycksmätare', cat: EL, con: CK }),
  it('Thermometer', { sv: 'Temp-mätare', cat: RX, con: TOI }),
  it('Oximeter', { sv: 'Oxymeter', cat: RX, con: TOI }),
  it('Tissues', { sv: 'Pappersnäsdukar', cat: MI, con: CO }),
  it('Lip balm', { sv: 'Lipsyl', cat: TO, con: CO }),
  it('Hand-sanitizer wipes', { sv: 'Handsprit-servetter', cat: TO, con: CO }),
  it('Pillows', { sv: 'Kuddar', cat: MI, con: CK }),
  it('Neck pillow', { sv: 'Nackkudde', cat: MI, con: CO }),
  it('Baggage keys', { sv: 'Nycklar till baggage', cat: DOC, con: CO }),
  it('Luggage scale', { sv: 'Resevåg', cat: MI, con: CK }),
  it('Crochet project', { sv: 'Virkningsprojekt', cat: MI, con: CO }),
  // Jobb (work)
  it('Work laptop', { sv: 'Jobbdator', cat: EL, con: CO, charge: true, note: 'work' }),
  it('Mouse', { sv: 'Mus', cat: EL, con: CO, note: 'work' }),
  it('RSA token', { sv: 'RSA-dosa', cat: DOC, con: CO, note: 'work' }),
  it('Saab ID', { sv: 'Saab-leg', cat: DOC, con: CO, note: 'work' }),
  it('Headphones / Puck', { sv: 'Hörlurar / Puck', cat: EL, con: CO, charge: true, note: 'work' }),
  it('Charger', { sv: 'Laddare', cat: CH, con: CO, charge: true, note: 'work' }),
  // Handbagage (carry-on)
  it('Passport', { sv: 'Pass', cat: DOC, con: CO }),
  it('Driving licence', { sv: 'Körkort', cat: DOC, con: CO }),
  it('Currency', { sv: 'Valuta', cat: DOC, con: CO }),
  it('Tickets', { sv: '"Biljetter"', cat: DOC, con: CO }),
  it('Ballograf pen', { sv: 'Ballograf-penna', cat: MI, con: CO }),
  it('Apple Pencil', { sv: 'ApplePen', cat: EL, con: CO, charge: true }),
  it('Targus electronics bag', { sv: 'Targus Elnikväska', cat: EL, con: EB, charge: true, sub: ['iPhone charger', 'iPad charger', 'MacBook Pro charger', 'Apple Watch charger'] }),
  it('AirPods', { sv: 'MS AirPods', cat: EL, con: CO, charge: true }),
  it('AirPods Max', { sv: 'AirPods Max', cat: EL, con: CO, charge: true }),
  it('iPhone tripod', { sv: 'iPhone tripod', cat: EL, con: CO }),
  it('Powerbank', { sv: 'Powerbank', cat: EL, con: CO, charge: true }),
  it('Glasses case', { sv: 'Glasögonfodral', cat: MI, con: CO }),
  it('Sunglasses', { sv: 'Solglasögon', cat: CL, con: CO }),
  it("Anna's glasses", { sv: 'Annas glasögon', cat: MI, con: CO }),
  it('MS reading glasses', { sv: 'MS läsglasögon', cat: MI, con: CO }),
  it('Travel food', { sv: 'Res-mat', cat: FD, con: CO }),
  it('Hobbit food (snacks)', { sv: 'Hobbitmat', cat: FD, con: CO }),
  it('Trail mix', { sv: 'Studentenfutter', cat: FD, con: CO }),
  it('Filled water bottle', { sv: 'Fylld vattenflaska', cat: FD, con: CO }),
  it('Lentils', { sv: 'Linser', cat: FD, con: CK }),
  // Reminders
  it('Pack per the special packing lists (GA / WET)', { sv: 'Packa enligt special-packlistor', cat: REM, rem: true }),
  it('Small plastic tub each for breakfast & dinner (if restaurant food needs topping up)', { sv: 'Plastbyttor mm', cat: REM, rem: true }),
  it('Plastic bags, snack bag etc. for the golf course', { sv: 'Några plastpåsar, Jausesäck etc. till golfbanan', cat: REM, rem: true }),
];

// ---------------------------------------------------------------- Plane (base)
// The flight-specific extras a car/RV trip doesn't need: the carry-on rules stuff.
const PLANE = [
  it('Passport / ID', { sv: 'Pass / ID', cat: DOC, con: CO, ph: 'door', short: true }),
  it('Boarding pass', { sv: 'Boardingkort', cat: DOC, con: CO, ph: 'door' }),
  it('Travel documents (bookings, insurance)', { sv: 'Resedokument (bokningar, försäkring)', cat: DOC, con: CO, ph: 'door' }),
  it('Liquids bag (clear, ≤100 ml)', { sv: 'Vätskepåse (genomskinlig, ≤100 ml)', cat: TO, con: CO, ph: 'daybefore', liquid: true, note: 'Max 100 ml per item, in one clear resealable bag' }),
  it('Power bank (carry-on only)', { sv: 'Powerbank (endast handbagage)', cat: EL, con: CO, ph: 'daybefore', charge: true, restricted: true, note: 'Must travel in carry-on, never checked' }),
  it('Spare batteries (carry-on only)', { sv: 'Reservbatterier (endast handbagage)', cat: EL, con: CO, ph: 'daybefore', restricted: true, note: 'Loose lithium batteries must be in carry-on' }),
  it('Medication (in carry-on)', { sv: 'Mediciner (i handbagaget)', cat: RX, con: CO, ph: 'door' }),
];

// ---------------------------------------------------------------- Car (base)
// The handful of extras that make sense specifically for a road trip.
const CAR = [
  it('Car charger / USB adapter', { sv: 'Billaddare / USB-adapter', cat: EL, con: 'Day pack', charge: true, chargeType: 'usb-a' }),
  it('Phone mount', { sv: 'Mobilhållare', cat: EL, con: 'Day pack' }),
  it('Sunglasses', { sv: 'Solglasögon', cat: MI, con: 'Day pack' }),
  it('Snacks & drinks for the road', { sv: 'Fika & dryck för resan', cat: FD, con: 'Cool box' }),
];

// ---------------------------------------------------------------- RV "Granden" (base)
const BELL = 'Bellroy backpack', RVBOX = 'RV storage box';
const RVBASE = [
  it('Take-along things from the wardrobe', { sv: '"Ta med"-grejor från garderoben', cat: REM, rem: true }),
  // Kläder
  it('Underwear', { sv: 'Trosor / Kalsonger', cat: CL, con: RVBOX }),
  it('Socks', { sv: 'Strumpor', cat: CL, con: RVBOX }),
  it('T-shirts', { sv: 'Tishor', cat: CL, con: RVBOX }),
  it('Trousers', { sv: 'Byxor', cat: CL, con: RVBOX }),
  it('Sweater / fleece', { sv: 'Tröja / fleece', cat: CL, con: RVBOX }),
  it('Base layer', { sv: 'Underställ', cat: CL, con: RVBOX }),
  it('Layer 2 (incl. Woolpower vest)', { sv: 'Lager 2 (inkl. Woolpower-väst)', cat: CL, con: RVBOX }),
  // Skor
  it('Boots', { sv: 'Kängor', cat: FW, con: RVBOX }),
  it('Approach shoes', { sv: 'Approach', cat: FW, con: RVBOX }),
  it('City shoes', { sv: 'Stadsskor', cat: FW, con: RVBOX }),
  it('Teva sandals', { sv: 'Teva sandaler', cat: FW, con: RVBOX, seas: ['Summer'] }),
  // Badrumsartiklar
  it('Contacts', { sv: 'Linser', cat: TO, con: TOI }),
  it('Glasses', { sv: 'Glasögon', cat: MI, con: TOI }),
  it('Contraceptive pill', { sv: 'P-piller', cat: RX, con: TOI }),
  it('Panty liners', { sv: 'Trosskydd', cat: TO, con: TOI }),
  // Bellroy:n (tech backpack)
  it('Targus bag', { sv: 'Targus:en', cat: EL, con: BELL }),
  it('MacBook Pro', { sv: 'MBP', cat: EL, con: BELL, charge: true }),
  it('iPad', { sv: 'Paddor', cat: EL, con: BELL, charge: true }),
  it('AirPods', { sv: 'AirPods', cat: EL, con: BELL, charge: true }),
  it('Garmin Epix Pro', { sv: 'Garmin Epix Pro', cat: EL, con: BELL, charge: true }),
  it('Camera', { sv: 'Kamera', cat: EL, con: BELL, charge: true, sub: ['360°', 'Go2', 'Insta Pro', 'DJI Mini Pro 4', 'DJI Mic 2', 'DJI Neo'] }),
  it('SpaceMouse', { sv: 'SpaceMouse', cat: EL, con: BELL }),
  it('Regular mouse', { sv: 'Vanlig mus', cat: EL, con: BELL }),
  // OE-grejor (other-events gear)
  it('Bromptons (folding bikes)', { sv: 'Bromptons', cat: SG, con: 'Other', sub: ['Bromptons', 'Helmet', 'Lock', 'Alarm', 'Radar', 'Computer', 'Light', 'Pump'] }),
  it('Skis', { sv: 'Skidor', cat: SG, con: 'Other', seas: ['Winter'] }),
  it('Skates', { sv: 'Skridsko', cat: SG, con: 'Other', seas: ['Winter'] }),
  it('Snowshoes', { sv: 'Snöskor', cat: SG, con: 'Other', seas: ['Winter'] }),
  // Composition references
  it('Pack GA gear per special lists (Golf / Hiking / Diving / Climbing)', { sv: 'GA-grejor', cat: REM, rem: true }),
  it('Pack WET gear per special lists (Swim / Bike / Run + winter)', { sv: 'WET-grejor', cat: REM, rem: true }),
  it('Work gear (see work list)', { sv: 'Jobb-grejor / Jobblistan', cat: REM, rem: true }),
];

// Fallback per-unit weight (grams) by category, for any item a keyword doesn't hit.
const CAT_WEIGHT = {
  'Clothing': 200, 'Adventure clothing': 350, 'Footwear': 650, 'Sport gear': 400,
  'Electronics': 250, 'Charging': 90, 'Toiletries': 90, 'Pharmacy / meds': 40,
  'Food & drink': 150, 'Documents & money': 40, 'Comfort & misc': 150, 'Reminders': 0,
};
// Representative per-unit weights (grams) by NAME keyword, matched as a substring,
// ordered specific → generic (first match wins). These are honest estimates, all
// editable per item. Anything unmatched falls back to CAT_WEIGHT by category.
const WEIGHT_RULES = [
  // — Specifics that must beat a shorter generic substring below —
  ['neck pillow', 200], ['pillow', 300], ['kitchen towel', 120], ['day pack', 600],
  // — Diving gear —
  ['drysuit undergarment', 800], ['drysuit hood', 150], ['drysuit socks', 150], ['drysuit inflation', 300], ['drysuit', 3500],
  ['backup regulator', 900], ['deco / stage regulator', 1000], ['primary regulator', 1200], ['regulator', 1000],
  ['spg', 200], ['pressure gauge', 200], ['backplate + wing', 1800], ['wing', 1500], ['harness', 450],
  ['weight pockets', 4000], ['weights', 4000], ['dsmb', 300], ['surface marker', 300], ['spool', 120],
  ['primary canister light', 900], ['canister light', 900], ['backup light', 200], ['tank marker light', 80], ['spotting light', 300],
  ['backup mask', 150], ['mask defog', 80], ['mask', 150], ['spring straps', 120], ['dive computer', 120],
  ['wetnotes', 120], ['cutting tool', 80], ['line cutter', 80], ['save-a-dive', 500], ['dry gloves', 200], ['wet gloves', 150],
  ['sky-hooks', 200], ['rope ladders', 1500], ['pitons', 900], ['tether cord', 60], ['nose clip', 10],
  ['pull buoy', 300], ['paddles', 200], ['tow buoy', 300], ['snorkel', 150], ['swim cap', 30], ['fins', 700],
  ['wetsuit', 900], ['hood + warm hood', 250],
  // — Golf —
  ['clubs', 4000], ['golf gear bag', 300], ['club protector', 250], ['club cleaner', 50], ['club towel', 100],
  ['divot tool', 30], ['ball marker', 10], ['balls', 500], ['tees', 40], ['golf pen', 15],
  ['golf gloves', 90], ['golf mittens', 90], ['golf beanie', 80], ['golf cap', 80], ['golf trousers', 400], ['golf shoes', 500], ['glove', 90],
  // — Bike —
  ['bike computer', 100], ['bike stand', 800], ['bike alarm', 60], ['bromptons', 12000], ['bike', 9000],
  ['helmet', 300], ['repair kit', 300], ['pump', 150], ['padlock', 120], ['lock', 400],
  ['cycling shoes', 350], ['cycling jacket', 450], ['cycling jersey', 250], ['cycling shorts', 220], ['cycling t-shirt', 180], ['cycling glasses', 30], ['radar', 100], ['di2', 300],
  // — Hiking / climbing —
  ['trekking poles', 500], ['sit pad', 200], ['platypus', 150], ['rope', 1200], ['emergency blanket', 60], ['rescue-folie', 60],
  ['crampons', 800], ['climbing spikes', 800], ['avalanche', 1000], ['guidebook', 300], ['hiking map', 120],
  ['ski goggles', 120], ['rain cover', 120], ['gaiters', 150], ['heat pads', 100], ['skis', 3500], ['skates', 1500], ['snowshoes', 1800],
  // — Footwear —
  ['running shoes', 300], ['approach shoes', 700], ['approach', 700], ['boots', 900], ['sneakers', 650],
  ['city shoes', 700], ['indoor slippers', 200], ['slippers', 200], ['sandals', 400], ['teva', 400], ['sliders', 250], ['neoprene boots', 400], ['shoes', 650],
  // — Electronics / charging —
  ['macbook', 1600], ['work laptop', 1500], ['laptop', 1500], ['ipad', 480], ['iphone power pack', 350], ['iphone tripod', 200], ['iphone', 200],
  ['phone mount', 80], ['phone', 200], ['apple watch', 50], ['apple pencil', 20], ['garmin', 60],
  ['airpods max', 400], ['airpods', 60], ['headphones', 70], ['power bank', 350], ['powerbank', 350], ['power pack', 350], ['spare batteries', 100],
  ['massage gun', 700], ['hair dryer', 500], ['hair straightener', 400], ['straightener', 400], ['ace pro', 150], ['insta360', 150],
  ['drone', 250], ['dji', 150], ['camera accessories', 150], ['camera', 300], ['stryd', 10], ['spacemouse', 150], ['mouse', 90],
  ['ereader', 200], ['targus', 400], ['220v', 100], ['adapter', 100], ['power strip', 200], ['multi-plug', 150], ['6-way', 150],
  ['blood-pressure', 350], ['oximeter', 60], ['thermometer', 30], ['form goggles', 60], ['form-goggles', 60],
  ['laser rangefinder', 200], ['headlamp', 95], ['light', 120], ['charging cable', 40], ['charger', 90],
  // — Clothing —
  ['sports bra', 80], ['bra', 80], ['underwear', 60], ['boxers', 60], ['compression socks', 60], ['hiking socks', 70], ['running socks', 60], ['socks', 50],
  ['merino wool', 250], ['woolpower', 250], ['base layer', 250], ['fleece top', 350], ['fleece trousers', 400], ['fleece', 350],
  ['down jacket', 500], ['windbreaker', 350], ['shell garment', 350], ['poncho', 300], ['rain suit', 400], ['jacket', 500],
  ['vests & t-shirts', 150], ['t-shirt', 150], ['polo', 220], ['adventure shirt', 220], ['shirt', 220], ['sweater', 350],
  ['adventure trousers', 450], ['three-quarter', 250], ['long trousers', 400], ['trousers', 400], ['shorts', 250], ['skirt', 200], ['dress', 300], ['belt', 150],
  ['reading glasses', 30], ['sun hat', 100], ['cap', 80], ['beanie', 80], ['headband', 40], ['alpine mittens', 110], ['flop mittens', 90], ['gloves', 90], ['mittens', 90],
  ['neck gaiter', 60], ['swim trunks', 150], ['swimsuit', 150], ['swimwear', 150], ['sarong', 200], ['lounge pants', 300], ['loungewear', 300], ['bathrobe', 600],
  ['reflectors', 40], ['reflex', 40], ['change of clothes', 500], ['change + a little', 500], ['spare change', 500], ['warm change', 500],
  ['warm vest', 300], ['running vest', 300], ['vest', 300], ['sleeves', 80], ['hair tie', 15],
  // — Toiletries & meds —
  ['first-aid', 300], ['knee bandage', 120], ['body massage oil', 150], ['massage oil', 150], ['towels, shower', 500], ['towel', 400], ['wash bag', 300], ['neti pot', 150],
  ['shampoo', 200], ['conditioner', 200], ['shower gel', 200], ['body lotion', 200], ['biotherm', 150], ['moisturiser', 150], ['razor', 120],
  ['sunscreen', 150], ['sun protection', 150], ['aftersun', 150], ['face products', 150], ['mosquito', 120], ['toilet paper', 120],
  ['toothpaste', 100], ['deodorant', 100], ['hairbrush', 100], ['hand sanitizer', 80], ['hand-sanitizer', 80], ['foot file', 40],
  ['nail clipper', 30], ['small scissors', 40], ['scissors', 40], ['tweezers', 15], ['dental floss', 20], ['floss', 20], ['toothbrush', 20], ['tooth pickers', 10],
  ['earplugs', 10], ['lip balm', 15], ['lipsyl', 15], ['hair ties', 15], ['glasses cleaner', 30], ['glasses case', 60], ['contacts', 30],
  ['panty liners', 60], ['magic pearls', 100], ['blister', 20], ['finger tape', 20], ['tape', 30], ['tablets', 30], ['pills', 30], ['pill', 20],
  ['medicine', 40], ['medication', 40], ['vitamins', 60], ['resorb', 50], ['cortisone', 40], ['cold-sore', 20], ['ear drops', 30],
  ['waxoff', 30], ['allergy', 30], ['plasters', 20], ['iron', 30], ['seasickness', 20], ['stomach', 40],
  // — Food & drink —
  ['filled water', 700], ['water bottle', 150], ['nalgene', 200], ['training bottle', 120], ['thermos', 400], ['sports drink', 400],
  ['trail mix', 150], ['hobbit food', 150], ['snack bag', 40], ['snack', 150], ['bars', 60], ['bar', 60], ['gel', 40],
  ['recovery food', 200], ['travel food', 200], ['run food', 150], ['lentils', 500], ['fluid', 400], ['water', 500], ['fruit', 120],
  // — Documents —
  ['wallet', 150], ['keys, phone', 200], ['passport', 40], ['licence', 20], ['boarding pass', 15], ['token', 30],
  ['membership card', 15], ['logbook', 150], ['insurance', 30], ['card', 20], ['currency', 60], ['tickets', 20], ['keys', 60],
  // — Comfort & misc —
  ['leatherman', 150], ['beach blanket', 400], ['luggage scale', 100], ['shopping bags', 100],
  ['shoehorn', 40], ['shoe polish', 100], ['silk', 180], ['crochet', 200], ['reading', 300], ['dry bag', 100], ['laundry bag', 60],
  ['handkerchief', 15], ['marker pen', 15], ['ballograf', 15], ['mountain pen', 15], ['pen', 15],
  ['glasses', 30], ['tissue', 50], ['umbrella', 350], ['case', 60],
];

// Tag items with sensible defaults for weight / flags (#3) by name, so the feature
// has real data out of the box. Everything stays editable per item.
function tagSeed(lists) {
  const any = (n, words) => words.some((w) => n.includes(w));
  for (const l of lists) {
    for (const it of l.items) {
      const n = it.name.toLowerCase();
      if (any(n, ['underwear', 'socks', 't-shirt', 'boxers', 'bra', 'vests & t-shirts'])) it.perNight = true;
      if (any(n, ['sunscreen', 'shampoo', 'conditioner', 'shower gel', 'body lotion', 'deodorant', 'aftersun',
        'hand sanitizer', 'mosquito', 'toothpaste', 'sun protection', 'lip balm', 'face products',
        'cold-sore', 'cortisone', 'moisturiser', 'balm', 'gel', 'neti pot', 'shower'])) it.liquid = true;
      if (any(n, ['powerbank', 'power pack', 'drone', 'battery', 'batteries', 'whoop', 'e-bike', 'bromptons'])) it.restricted = true;
      // Weight: reminders carry none; explicit/seeded weights (e.g. containers) are
      // kept; otherwise a keyword estimate, falling back to the category default.
      if (it.itemType === 'reminder') { it.weight = 0; continue; }
      if (it.weight > 0) continue;
      let w = 0;
      for (const [k, g] of WEIGHT_RULES) { if (n.includes(k)) { w = g; break; } }
      it.weight = w || CAT_WEIGHT[it.category] || 120;
    }
  }
  return lists;
}

// ---------------------------------------------------------------- Diving
// A technical/drysuit diving kit, pre-organised into sections so the list reads as
// a clear overview. Section ids are stable strings referenced by each item's `sec`.
const DS = {
  suit: 'dive-suit', rig: 'dive-rig', reg: 'dive-reg', light: 'dive-light',
  mask: 'dive-mask', instr: 'dive-instr', acc: 'dive-acc', doc: 'dive-doc',
};
const DIVE_SECTIONS = [
  { id: DS.suit,  name: 'Drysuit & exposure' },
  { id: DS.rig,   name: 'Rig / BCD' },
  { id: DS.reg,   name: 'Regulators' },
  { id: DS.light, name: 'Lights' },
  { id: DS.mask,  name: 'Mask & fins' },
  { id: DS.instr, name: 'Instruments & deco' },
  { id: DS.acc,   name: 'Accessories' },
  { id: DS.doc,   name: 'Documents & certification' },
];
const DIVE = [
  // Drysuit & exposure
  it('Drysuit', { cat: SG, con: 'Checked luggage', sec: DS.suit }),
  it('Drysuit undergarment / thermal', { cat: SG, con: 'Checked luggage', sec: DS.suit }),
  it('Drysuit hood', { cat: SG, sec: DS.suit }),
  it('Dry gloves + liners', { cat: SG, sec: DS.suit }),
  it('Drysuit socks', { cat: SG, sec: DS.suit }),
  // Rig / BCD
  it('Backplate + wing', { cat: SG, con: 'Checked luggage', sec: DS.rig }),
  it('Harness + crotch strap', { cat: SG, sec: DS.rig }),
  it('Tank / cam bands', { cat: SG, sec: DS.rig }),
  it('DSMB (surface marker buoy)', { cat: SG, sec: DS.rig }),
  it('Spool / reel', { cat: SG, sec: DS.rig }),
  it('Weight pockets + weights', { cat: SG, con: 'Checked luggage', sec: DS.rig }),
  // Regulators
  it('Primary regulator (1st + 2nd stage)', { cat: SG, sec: DS.reg }),
  it('Backup regulator / long hose', { cat: SG, sec: DS.reg }),
  it('Drysuit inflation hose', { cat: SG, sec: DS.reg }),
  it('Deco / stage regulator', { cat: SG, sec: DS.reg }),
  it('SPG / pressure gauge', { cat: SG, sec: DS.reg }),
  // Lights
  it('Primary canister light', { cat: SG, sec: DS.light, charge: true, restricted: true }),
  it('Backup light 1', { cat: SG, sec: DS.light, restricted: true }),
  it('Backup light 2', { cat: SG, sec: DS.light, restricted: true }),
  it('Tank marker light', { cat: SG, sec: DS.light, restricted: true }),
  it('Video / spotting light', { cat: SG, sec: DS.light, charge: true, restricted: true }),
  // Mask & fins
  it('Mask', { cat: SG, sec: DS.mask }),
  it('Backup mask', { cat: SG, sec: DS.mask }),
  it('Fins', { cat: SG, sec: DS.mask }),
  it('Spring straps', { cat: SG, sec: DS.mask }),
  // Instruments & deco
  it('Dive computer', { cat: EL, sec: DS.instr, charge: true, restricted: true }),
  it('Backup dive computer', { cat: EL, sec: DS.instr, charge: true, restricted: true }),
  it('Compass', { cat: SG, sec: DS.instr }),
  it('Wetnotes + pencil', { cat: SG, sec: DS.instr }),
  it('Cutting tool / line cutter', { cat: SG, sec: DS.instr }),
  // Accessories
  it('Save-a-dive kit (o-rings, tools)', { cat: SG, sec: DS.acc }),
  it('Mask defog', { cat: TO, sec: DS.acc, liquid: true }),
  it('Boots', { cat: FW, sec: DS.acc }),
  it('Reel / wet gloves', { cat: SG, sec: DS.acc }),
  // Documents & certification
  it('Certification card', { cat: DOC, sec: DS.doc }),
  it('Dive logbook', { cat: DOC, sec: DS.doc }),
  it('DAN / dive insurance', { cat: DOC, sec: DS.doc }),
  it('Analyse gas & note MOD', { sv: '', cat: REM, sec: DS.doc, rem: true, ph: 'prep' }),
];

// ---------------------------------------------------------------- Containers
// The bags/duffels/backpacks themselves, as maintainable objects. Names match the
// built-in "Container" dropdown values so existing items resolve to these records.
// capacityL = litres, maxKg = the bag's own weight ceiling (drives airline warnings).
function cont(name, o = {}) {
  return newItem({
    name,
    capacityL: o.L || 0,
    maxKg: o.kg || 0,
    weight: o.empty || 0,      // empty weight in grams
    manufacturer: o.brand || '',
    color: o.color || '',
    storage: o.at || '',
  });
}
const CONTAINERS_SEED = [
  cont('Carry-on / hand luggage', { L: 40, kg: 8, empty: 2800, at: 'Loft / attic' }),
  cont('Checked luggage', { L: 90, kg: 23, empty: 4200, at: 'Loft / attic' }),
  cont('Bellroy backpack', { L: 24, kg: 8, empty: 1200, brand: 'Bellroy', at: 'Hall closet' }),
  cont('Day pack', { L: 20, kg: 8, empty: 600, at: 'Hall closet' }),
  cont('Hiking backpack', { L: 45, empty: 1800, at: 'Loft / attic' }),
  cont('Climbing backpack', { L: 40, empty: 1500, at: 'Loft / attic' }),
  cont('Duffel bag', { L: 60, empty: 1300, at: 'Loft / attic' }),
  cont('Swim bag', { L: 20, empty: 400, at: 'Bedroom wardrobe' }),
  cont('Triathlon bag', { L: 40, empty: 1000, at: 'Bedroom wardrobe' }),
  cont('Golf bag', { L: 35, empty: 3000, at: 'Garage' }),
  cont('Toiletry bag', { L: 5, empty: 300, at: 'Bathroom cabinet' }),
  cont('Tech pouch', { L: 3, empty: 250, at: 'Hall closet' }),
  cont('Electronics bag', { L: 5, empty: 500, brand: 'Targus', at: 'Hall closet' }),
  cont('Cool box', { L: 25, empty: 2500, at: 'Garage' }),
  cont('Handbag', { L: 8, empty: 500, at: 'Bedroom wardrobe' }),
  cont('RV storage box', { L: 50, empty: 1500, at: 'RV / camper' }),
];

// Give every template a well-organised section list out of the box. Diving ships
// with its own bespoke gear sections (set inline above); every other populated
// template is grouped by a friendly, consistent scheme derived from each item's
// category, and the empty activity scaffolds get a ready-to-fill skeleton. All of
// it is fully editable in the app (Sections button + each item's Section picker).
const SEC_ORDER = ['Clothing', 'Footwear', 'Gear & equipment', 'Tech & devices',
  'Toiletries & body care', 'Food & drink', 'Documents & money', 'Comfort & misc', 'Reminders'];
const CAT_SEC = {
  'Clothing': 'Clothing', 'Adventure clothing': 'Clothing', 'Footwear': 'Footwear',
  'Sport gear': 'Gear & equipment', 'Electronics': 'Tech & devices', 'Charging': 'Tech & devices',
  'Toiletries': 'Toiletries & body care', 'Pharmacy / meds': 'Toiletries & body care',
  'Food & drink': 'Food & drink', 'Documents & money': 'Documents & money',
  'Comfort & misc': 'Comfort & misc', 'Reminders': 'Reminders',
};
// Empty scaffolds: a starting skeleton so they're ready to fill (no items yet).
const SEC_SKELETONS = {
  'Freediving': ['Wetsuit & exposure', 'Gear & equipment', 'Safety', 'Tech & devices', 'Documents & certification'],
  'Strength': ['Clothing', 'Footwear', 'Equipment', 'Tech & devices'],
  'Yoga / Mobility': ['Clothing', 'Mat & props', 'Tech & devices'],
  'Breath work': ['Comfort & misc', 'Tech & devices'],
};
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const mkSecs = (listName, names) => names.map((n) => ({ id: `sec-${slug(listName)}-${slug(n)}`, name: n }));
function sectionize(lists) {
  for (const l of lists) {
    if (l.role === CONTAINER_ROLE) continue;            // the Containers catalogue has no sections
    if (l.name === 'Diving') continue;                 // already carries bespoke sections
    if (SEC_SKELETONS[l.name]) { l.sections = mkSecs(l.name, SEC_SKELETONS[l.name]); continue; }
    if (!l.items.length) continue;
    const used = new Set();
    for (const it of l.items) {
      const nm = CAT_SEC[it.category] || 'Comfort & misc';
      it.section = `sec-${slug(l.name)}-${slug(nm)}`;
      used.add(nm);
    }
    l.sections = mkSecs(l.name, SEC_ORDER.filter((n) => used.has(n)));
  }
  return lists;
}

export function seedLists() {
  const L = (name, group, items, extra) => newList({ name, group, builtin: true, items, ...extra });
  return sectionize(tagSeed([
    // Common base — always included on every trip, whatever the transport / activities.
    L('Travel', '', TRAVEL, { role: 'base' }),
    // Transport bases — auto-included by the trip's "Way of transport": Car brings a
    // few road extras, Plane the carry-on-rules stuff, RV the full motorhome kit.
    L('Car (base)', '', CAR, { role: 'transport', transport: 'Car' }),
    L('Plane (base)', '', PLANE, { role: 'transport', transport: 'Plane' }),
    L('RV Granden (base)', '', RVBASE, { role: 'transport', transport: 'RV' }),
    // GA — Goal Activity
    L('Golf', 'GA', GOLF),
    L('Hiking', 'GA', HIKE),
    L('Diving', 'GA', DIVE, { sections: DIVE_SECTIONS }),
    L('Freediving', 'GA', []),    // scaffold — to fill
    // WET — Workout, Exercise & Training
    L('Swim', 'WET', SWIM),
    L('Bike', 'WET', BIKE),
    L('Run', 'WET', RUN),
    L('Strength', 'WET', []),         // scaffold — to fill
    L('Yoga / Mobility', 'WET', []),  // scaffold — to fill
    L('Breath work', 'WET', []),      // scaffold — to fill
    // OE — Other Events: no packing lists for now (kept as an empty group)
    // Containers — the bags themselves (role 'container'; kept out of trips & pickers).
    L(CONTAINER_LIST_NAME, '', CONTAINERS_SEED, { role: CONTAINER_ROLE }),
  ]));
}

// (Start-from templates were removed in v30: the common base is always included,
// and the transport radio now auto-adds its own base list — see js/model.js
// listsForEvent — so a separate "start from" preset is no longer needed.)
